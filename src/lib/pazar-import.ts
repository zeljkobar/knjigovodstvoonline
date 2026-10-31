import "server-only";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { loadPosReport } from "./pos-reports";
import { fiscalPortalContext, fiscalPortalDevices, savedFiscalPortal, withVgPortal, type FiscalPortalContext } from "./fiscal-portals";
import { PazarImportError, importedCashRegister, pazarImportPeriod, pazarInput, validatePazarReport, type PazarDevice, type PazarReport } from "./pazar-import-policy";
import { signPazarImport, verifyPazarImport, type PazarImportProof } from "./fiscal-portal-secrets";
import { auditLogInTransaction } from "./audit";

export function pazarBusinessInstant(day: string) {
  const utc = new Date(`${day}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Podgorica", timeZoneName: "shortOffset" }).formatToParts(utc).find(p => p.type === "timeZoneName")!.value;
  const hours = Number(/GMT\+(\d+)/.exec(offset)?.[1] ?? 0);
  return new Date(utc.getTime() - hours * 3600000);
}
export async function pazarBookContext(ctx: FiscalPortalContext, bookId: string, from: string, to: string, db: Prisma.TransactionClient = prisma) {
  const [book, year] = await Promise.all([
    db.kifBook.findFirst({ where: { id: bookId, agencija_id: ctx.agencyId, firma_id: ctx.firm.id, poslovna_godina_id: ctx.yearId ?? "00000000-0000-0000-0000-000000000000", status: "OPEN", is_deleted: false }, select: { id: true, mjesec: true, kif_date: true } }),
    db.poslovnaGodina.findFirst({ where: { id: ctx.yearId ?? "00000000-0000-0000-0000-000000000000", firma_id: ctx.firm.id, zakljucena: false } })
  ]);
  if (!book || !year) throw new PazarImportError("KIF knjiga ili poslovna godina nije otvorena za unos.");
  const period = pazarImportPeriod(from, to, year.godina, book.mjesec);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (to > today) throw new PazarImportError("Period izvještaja ne može završavati u budućnosti. Za tekući mjesec izaberite datume do danas.");
  if (period.start < year.datum_od || period.end > year.datum_do) throw new PazarImportError("Period je van poslovne godine.");
  if (await db.pdvPeriod.count({ where: { firma_id: ctx.firm.id, status: "LOCKED", OR: [{ datum_od: { lte: period.end }, datum_do: { gte: period.start } }, { datum_od: { lte: book.kif_date }, datum_do: { gte: book.kif_date } }] } })) throw new PazarImportError("PDV period je zaključan.");
  return { book, year, period };
}
export async function pazarImportOverlap(db: Prisma.TransactionClient, agencyId: string, firmId: string, provider: string, device: PazarDevice, from: string, to: string, exceptId?: string) {
  const cash = importedCashRegister(provider, device);
  return db.kifEntry.findFirst({ where: {
    agencija_id: agencyId, firma_id: firmId, entry_kind: "PAZAR", is_deleted: false, ...(exceptId ? { id: { not: exceptId } } : {}),
    pazar_period_from: { lte: new Date(`${to}T00:00:00Z`) }, pazar_period_to: { gte: new Date(`${from}T00:00:00Z`) },
    OR: [{ pazar_source_provider: provider, pazar_source_device: device.id }, { pazar_source_provider: null, OR: [{ pazar_cash_register: null }, { pazar_cash_register: cash }, { pazar_cash_register: device.label.replace(/\s+/g, " ").toUpperCase() }] }]
  }, select: { id: true } });
}
export async function summaPazarReport(ctx: Pick<FiscalPortalContext, "agencyId" | "firm" | "yearId">, device: PazarDevice, from: string, to: string, db: Prisma.TransactionClient = prisma) {
  const tomorrow = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const pos = await loadPosReport({ agencijaId: ctx.agencyId, firmaId: ctx.firm.id, yearId: ctx.yearId!, registerId: device.id, start: pazarBusinessInstant(from), end: new Date(pazarBusinessInstant(tomorrow).getTime() - 1) }, db);
  // A report must never import POS turnover that already went through another KIF flow.
  if (pos.invoices.some(i => i.kif_entry_id || i.nalog_id || i.kif_status === "TRANSFERRED")) throw new PazarImportError("Dio POS računa već je prenesen u KIF. Ovaj izvještaj se ne može ponovo uvesti kao pazar.");
  const report: PazarReport = { pib: ctx.firm.pib ?? "", from, to, device, total: Number(pos.totals.gross), taxes: pos.taxes.map(t => ({ rate: t.rate, base: Number(t.base), vat: Number(t.vat) })), payments: pos.payments.map(p => ({ method: p.method === "BANK_TRANSFER" ? "TRANSFER" : p.method, amount: Number(p.amount) })) };
  if (report.payments.some(p => !["CASH", "CARD", "TRANSFER", "OTHER"].includes(p.method))) throw new PazarImportError("POS izvještaj sadrži nepodržan način naplate.");
  const digest = createHash("sha256").update(JSON.stringify({ report, sources: pos.invoices.map(i => [i.id, i.updated_at.toISOString()]) })).digest("hex");
  return { report, digest };
}
export function summaPazarExcel(report: PazarReport, companyName: string) {
  const rows: unknown[][] = [[companyName], [`PIB ${report.pib}`], ["PERIODIČNI POS IZVJEŠTAJ — SUMMA FISKAL"], ["Za period", `${report.from} — ${report.to}`], ["Kasa", report.device.label], [], ["Poreska stopa", "Osnovica EUR", "PDV EUR", "Promet EUR"]];
  for (const tax of report.taxes) rows.push([`${tax.rate}%`, tax.base / 100, tax.vat / 100, (tax.base + tax.vat) / 100]);
  rows.push(["Ukupno", report.taxes.reduce((s, t) => s + t.base, 0) / 100, report.taxes.reduce((s, t) => s + t.vat, 0) / 100, report.total / 100], [], ["Način naplate", "Iznos EUR"]);
  const labels: Record<string, string> = { CASH: "Gotovina", CARD: "Kartice", TRANSFER: "Virman", OTHER: "Ostalo" };
  for (const payment of report.payments) rows.push([labels[payment.method] ?? payment.method, payment.amount / 100]);
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(rows); for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!") && cell.t === "n") cell.z = "#,##0.00"; sheet["!cols"] = [{ wch: 46 }, { wch: 25 }, { wch: 20 }, { wch: 20 }]; XLSX.utils.book_append_sheet(book, sheet, "Pazar");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
export async function previewPazarImport(input: { bookId: string; companyId: string; deviceId: string; from: string; to: string }) {
  const ctx = await fiscalPortalContext("create", input.companyId), config = await savedFiscalPortal(ctx);
  const initialBook = await pazarBookContext(ctx, input.bookId, input.from, input.to);
  const devices = await fiscalPortalDevices(ctx, config), device = devices.find(d => d.id === input.deviceId);
  if (!device) throw new PazarImportError("Izabrana kasa nije dostupna za ovu firmu.");
  if (await pazarImportOverlap(prisma, ctx.agencyId, ctx.firm.id, config.provider, device, input.from, input.to)) throw new PazarImportError("Za ovu kasu već postoji pazar koji se preklapa sa izabranim periodom.");
  let report: PazarReport, bytes: Buffer, digest: string;
  if (config.provider === "VG_EFISKAL") {
    const downloaded = await withVgPortal(ctx, config, client => client.report(device, input.from, input.to));
    report = downloaded.report; bytes = downloaded.bytes; digest = createHash("sha256").update(bytes).digest("hex");
  } else { const summa = await summaPazarReport(ctx, device, input.from, input.to); report = summa.report; digest = summa.digest; bytes = summaPazarExcel(report, ctx.firm.naziv); }
  try {
    validatePazarReport(report, { pib: ctx.firm.pib ?? "", from: input.from, to: input.to });
    // Re-authorise after the remote call. Neither credentials nor report files enter audit/DB.
    const current = await fiscalPortalContext("create", input.companyId);
    if (current.user.id !== ctx.user.id || current.yearId !== ctx.yearId) throw new PazarImportError("Radni kontekst je promijenjen. Ponovite preuzimanje.");
    const latest = await savedFiscalPortal(current);
    if (latest.id !== config.id || latest.updated_at.getTime() !== config.updated_at.getTime()) throw new PazarImportError("Podešavanja provajdera su promijenjena. Ponovite preuzimanje.");
    const { year, period } = await pazarBookContext(current, input.bookId, input.from, input.to);
    const rates = await prisma.pdvStopa.findMany({ where: { agencija_id: ctx.agencyId, aktivna: true }, select: { id: true, procenat: true } });
    const taxLines: Array<{ vatRateId: string; taxBase: string; vatAmount: string }> = [];
    for (const tax of report.taxes.filter(t => t.base || t.vat)) {
      const matching = rates.filter(r => Number(r.procenat.toString()) === Number(tax.rate));
      if (matching.length !== 1) throw new PazarImportError(`Podesite jednu aktivnu PDV stopu ${tax.rate}% za uvoz izvještaja.`);
      taxLines.push({ vatRateId: matching[0].id, taxBase: pazarInput(tax.base), vatAmount: pazarInput(tax.vat) });
    }
    const cashRegister = importedCashRegister(config.provider, device);
    const proof: PazarImportProof = { agencyId: ctx.agencyId, companyId: ctx.firm.id, companyPib: ctx.firm.pib ?? "", yearId: year.id, bookId: input.bookId, userId: ctx.user.id, configId: config.id, configVersion: config.updated_at.toISOString(), provider: config.provider, deviceId: device.id, cashRegister, from: input.from, to: input.to, digest, expires: Date.now() + 2 * 60 * 60 * 1000 };
    await prisma.$transaction(tx => auditLogInTransaction(tx, { korisnikId: ctx.user.id, agencijaId: ctx.agencyId, firmaId: ctx.firm.id, modul: "izlazni_racuni", akcija: "PAZAR_REPORT_DOWNLOAD", tipEntiteta: "KifBook", entitetId: input.bookId, novaVrijednost: { provider: config.provider, device: device.id, from: input.from, to: input.to, digest } }));
    return { token: signPazarImport(proof), form: { periodType: period.type, periodFrom: input.from, periodTo: input.to, cashRegister, reportNumber: `${config.provider === "VG_EFISKAL" ? "VG" : "SUMMA"} ${input.from}–${input.to} · ${device.label}`, total: pazarInput(report.total), taxLines, payments: report.payments.map(p => ({ method: p.method, amount: pazarInput(p.amount) })) }, file: { name: `pazar-${config.provider.toLowerCase()}-${input.from}-${input.to}-${device.id}.xlsx`, base64: bytes.toString("base64") }, provider: config.provider, month: initialBook.book.mjesec };
  } finally { bytes.fill(0); }
}
export async function checkPazarImportProof(tx: Prisma.TransactionClient, token: string, expected: { agencyId: string; companyId: string; yearId: string; bookId: string; userId: string; from: string; to: string; cashRegister: string | null }) {
  const proof = verifyPazarImport(token);
  const currentFirm = await tx.firma.findFirst({ where: { id: expected.companyId, agencija_id: expected.agencyId, aktivan: true, is_deleted: false }, select: { pib: true } });
  if (!currentFirm || proof.companyPib !== currentFirm.pib) throw new PazarImportError("PIB firme je promijenjen. Ponovo preuzmite izvještaj.");
  for (const field of ["agencyId", "companyId", "yearId", "bookId", "userId", "from", "to", "cashRegister"] as const) if (proof[field] !== expected[field]) throw new PazarImportError("Podaci uvoza ne odgovaraju formi. Ponovo preuzmite izvještaj.");
  const config = await tx.firmaFiskalniPortal.findFirst({ where: { id: proof.configId, agencija_id: expected.agencyId, firma_id: expected.companyId, provider: proof.provider, aktivan: true, is_deleted: false, updated_at: new Date(proof.configVersion) } });
  if (!config) throw new PazarImportError("Podešavanja provajdera su promijenjena. Ponovo preuzmite izvještaj.");
  if (await pazarImportOverlap(tx, expected.agencyId, expected.companyId, proof.provider, { id: proof.deviceId, label: "" }, proof.from, proof.to)) throw new PazarImportError("Za ovu kasu i period već postoji pazar.");
  if (proof.provider === "SUMMA_FISKAL") {
    const ctx = { agencyId: expected.agencyId, firm: { id: expected.companyId, pib: currentFirm.pib, naziv: "" }, yearId: expected.yearId };
    const device = await tx.posRegister.findFirst({ where: { id: proof.deviceId, agencija_id: expected.agencyId, firma_id: expected.companyId, is_deleted: false } });
    if (!device) throw new PazarImportError("POS kasa više nije dostupna.");
    const source = await summaPazarReport(ctx, { id: device.id, label: `${device.sifra} | ${device.naziv}` }, proof.from, proof.to, tx);
    if (source.digest !== proof.digest) throw new PazarImportError("POS promet se promijenio nakon preuzimanja. Ponovo uvezite izvještaj.");
  }
  return proof;
}
