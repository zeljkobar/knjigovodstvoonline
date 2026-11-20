import { prisma } from "./prisma";
import { fiscalReviewApi, type FiscalActor } from "./fiscal-admin-api";
import { auditLogInTransaction } from "./audit";
import { isFiscalUuid } from "./fiscal-review-filters";
import { reconciliationCents } from "./fiscal-reconciliation";
import type { FiscalInvoiceDetail } from "./fiscal-review-models";

export class FiscalEnvironmentRepairError extends Error {}

async function readLocal(id: string, db = prisma) {
  return db.fiskalniIzlazniRacun.findFirst({ where: { id, is_deleted: false, fiskalizacija_rezim: "SUMMA" },
    include: { firma: { select: { is_deleted: true, aktivan: true, fiscalCompanyLink: true } }, poslovna_godina: { select: { zakljucena: true } }, pos_kif_membership: true } });
}
type Local = NonNullable<Awaited<ReturnType<typeof readLocal>>>;

export function environmentRepairReasons(local: Local, remote: FiscalInvoiceDetail) {
  const reasons: string[] = [];
  const link = local.firma.fiscalCompanyLink;
  if (local.firma.is_deleted || !link || link.agencija_id !== local.agencija_id || link.fiscal_api_company_id !== remote.companyId || remote.id !== local.fiscal_api_invoice_id) reasons.push("Identitet firme ili veza sa API računom nijesu potvrđeni.");
  if (local.firma.aktivan === false || link?.is_suspended) reasons.push("Firma ili fiskalna veza nije aktivna.");
  if (!["Test", "Production"].includes(remote.environment)) reasons.push("API nije potvrdio okruženje.");
  if (local.fiscal_environment !== null) reasons.push("Lokalno okruženje je već upisano; ova akcija ga ne prepisuje.");
  if (local.fiscal_status !== "Fiscalized" || remote.status !== "Fiscalized" || !local.jikr || local.jikr !== remote.jikr || !local.iic || local.iic !== remote.iic) reasons.push("Potvrđeni status, IKOF i JIKR moraju već biti jednaki.");
  if (!["INVOICE", "POS_RECEIPT"].includes(local.document_type) || local.vrsta_racuna !== "NORMAL" || local.original_invoice_id || local.avansni_racun_id || remote.invoiceType !== "Normal" || remote.category !== "StandardSale" || remote.isInformational || remote.originalInvoiceId) reasons.push("Ova akcija podržava samo običnu prodaju bez avansa i korekcija.");
  if (local.valuta !== "EUR" || remote.currency !== "EUR") reasons.push("Valuta mora biti EUR.");
  try {
    for (const [value, api] of [[local.ukupno_osnovica, remote.totalNetAmount], [local.ukupno_izlazni_pdv, remote.totalVatAmount], [local.ukupno_sa_pdv, remote.totalGrossAmount]] as const) {
      if (!Number.isFinite(api) || reconciliationCents(value.toString()) !== reconciliationCents(String(api))) { reasons.push("Iznosi računa se razlikuju ili nijesu potvrđeni."); break; }
    }
  } catch { reasons.push("Iznosi nijesu pogodni za bezbjedno poređenje."); }
  if (!local.issued_at || local.issued_at.getTime() !== Date.parse(remote.issueDateTime)) reasons.push("Vrijeme izdavanja se razlikuje ili nije evidentirano.");
  if (!local.official_invoice_number || local.official_invoice_number !== remote.officialInvoiceNumber) reasons.push("Zvanični broj računa mora već biti jednak.");
  if (local.nalog_id || local.kif_entry_id || local.pos_kif_membership || local.status === "POSTED" || !["WAITING_KIF", "NOT_REQUIRED"].includes(local.kif_status)) reasons.push("Dokument ima računovodstvenu vezu ili nezavršen računovodstveni postupak.");
  if (local.poslovna_godina.zakljucena) reasons.push("Poslovna godina je zaključana.");
  return reasons;
}

export async function prepareFiscalEnvironmentRepair(actor: FiscalActor, invoiceId: string) {
  if (!isFiscalUuid(invoiceId)) throw new FiscalEnvironmentRepairError("Neispravan identifikator računa.");
  const local = await readLocal(invoiceId);
  if (!local?.fiscal_api_invoice_id || !isFiscalUuid(local.fiscal_api_invoice_id)) throw new FiscalEnvironmentRepairError("Lokalni račun nema potvrđenu API vezu.");
  const remote = (await fiscalReviewApi.invoice(actor, local.fiscal_api_invoice_id)).data;
  const reasons = environmentRepairReasons(local, remote);
  const locked = await prisma.pdvPeriod.findFirst({ where: { agencija_id: local.agencija_id, firma_id: local.firma_id, poslovna_godina_id: local.poslovna_godina_id,
    status: "LOCKED", OR: [{ datum_od: { lte: local.datum_racuna }, datum_do: { gte: local.datum_racuna } }, { datum_od: { lte: local.datum_prometa }, datum_do: { gte: local.datum_prometa } }] }, select: { id: true } });
  if (locked) reasons.push("PDV period je zaključan.");
  return { local, remote, reasons };
}

/** Single metadata field only. Never calls fiscalize/recovery or updates financial rows. */
export async function applyFiscalEnvironmentRepair(actor: FiscalActor, invoiceId: string, expectedVersion: string) {
  const plan = await prepareFiscalEnvironmentRepair(actor, invoiceId);
  if (plan.reasons.length) throw new FiscalEnvironmentRepairError(plan.reasons.join(" "));
  if (plan.local.updated_at.toISOString() !== expectedVersion) throw new FiscalEnvironmentRepairError("Račun je promijenjen. Ponovo otvorite pregled.");
  return prisma.$transaction(async tx => {
    // Same year/invoice locks used by financial workflows; serializable prevents phantom period changes.
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id = ${plan.local.poslovna_godina_id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM firme WHERE id = ${plan.local.firma_id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM fiscal_company_links WHERE firma_id = ${plan.local.firma_id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM fiskalni_izlazni_racuni WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const current = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: invoiceId, agencija_id: plan.local.agencija_id, firma_id: plan.local.firma_id, is_deleted: false, fiskalizacija_rezim: "SUMMA" },
      include: { firma: { select: { is_deleted: true, aktivan: true, fiscalCompanyLink: true } }, poslovna_godina: { select: { zakljucena: true } }, pos_kif_membership: true } });
    if (!current || current.updated_at.toISOString() !== expectedVersion) throw new FiscalEnvironmentRepairError("Račun je promijenjen. Ponovo otvorite pregled.");
    await tx.$queryRaw`SELECT id FROM pdv_periodi WHERE firma_id = ${current.firma_id}::uuid AND poslovna_godina_id = ${current.poslovna_godina_id}::uuid FOR UPDATE`;
    const reasons = environmentRepairReasons(current, plan.remote);
    const locked = await tx.pdvPeriod.findFirst({ where: { agencija_id: current.agencija_id, firma_id: current.firma_id, poslovna_godina_id: current.poslovna_godina_id, status: "LOCKED",
      OR: [{ datum_od: { lte: current.datum_racuna }, datum_do: { gte: current.datum_racuna } }, { datum_od: { lte: current.datum_prometa }, datum_do: { gte: current.datum_prometa } }] }, select: { id: true } });
    if (reasons.length || locked) throw new FiscalEnvironmentRepairError("Uslovi usklađivanja su se promijenili ili je period zaključan.");
    await tx.fiskalniIzlazniRacun.update({ where: { id: current.id }, data: { fiscal_environment: plan.remote.environment, updated_by: actor.id } });
    await auditLogInTransaction(tx, { korisnikId: actor.id, agencijaId: current.agencija_id, firmaId: current.firma_id,
      modul: "fiskalizacija", akcija: "reconcile_missing_environment", tipEntiteta: "FiskalniIzlazniRacun", entitetId: current.id,
      staraVrijednost: { fiscal_environment: null }, novaVrijednost: { fiscal_environment: plan.remote.environment, fiscal_api_invoice_id: current.fiscal_api_invoice_id, jikr: plan.remote.jikr } });
    return current.id;
  }, { isolationLevel: "Serializable" });
}
