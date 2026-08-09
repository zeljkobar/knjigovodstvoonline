import { Prisma } from "@prisma/client";
import { accountOverrideTypes } from "@/lib/account-plan";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";
import { formatJournalCode, journalStatuses, standardJournalTypes } from "@/lib/journals";
import { outgoingInvoicePostingFields, outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import { prisma } from "@/lib/prisma";

async function resolveAccount(tx: Prisma.TransactionClient, firmaId: string, code: string) {
  const existing = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: firmaId, sifra: code } } });
  if (existing) return existing.aktivan && existing.override_type !== accountOverrideTypes.deactivated && existing.tip_konta === "analiticko" ? existing : null;
  const base = await tx.konto.findFirst({ where: { sifra: code, aktivan: true, tip_konta: "analiticko" } });
  if (!base) return null;
  return tx.firmaKonto.create({ data: { firma_id: firmaId, konto_id: base.id, sifra: base.sifra, naziv: base.naziv, tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna, sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo, koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, override_type: accountOverrideTypes.baseLink, aktivan: true } });
}

export async function finalizePosTransferAccounting(input: {
  invoiceId: string;
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  year: number;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-transfer-accounting:${input.invoiceId}`}))`;
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: input.invoiceId, agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, sales_channel: "POS", nacin_placanja: "BANK_TRANSFER", fiscal_status: "Fiscalized", is_deleted: false },
      include: { stavke: { include: { artikal: { select: { usluga: true, prati_zalihe: true } } } } }
    });
    if (!invoice) return { ok: false as const, reason: "racun" };
    if (invoice.nalog_id) {
      if (invoice.status !== "WAITING_KIF" || invoice.kif_status !== "WAITING_KIF") await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { status: "WAITING_KIF", kif_status: "WAITING_KIF", updated_by: input.userId } });
      return { ok: true as const, journalId: invoice.nalog_id, alreadyCompleted: true };
    }
    const year = await tx.poslovnaGodina.findFirst({ where: { id: input.poslovnaGodinaId, firma_id: input.firmaId }, select: { zakljucena: true } });
    if (!year || year.zakljucena) return { ok: false as const, reason: "godina" };
    const period = await tx.pdvPeriod.findFirst({ where: { firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, mjesec: invoice.datum_racuna.getUTCMonth() + 1 }, select: { status: true } });
    if (period?.status === "LOCKED") return { ok: false as const, reason: "pdv_period" };

    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: input.firmaId, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype, pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate } }),
      tx.vrstaNaloga.findFirst({ where: { sifra: standardJournalTypes[2][0], aktivan: true, OR: [{ sistemska: true }, { agencija_id: input.agencijaId }, { firma_id: input.firmaId }] }, select: { id: true, prefiks: true } })
    ]);
    if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
    const correction = invoice.document_type === "POS_RETURN";
    const absolute = (value: bigint) => value < BigInt(0) ? -value : value;
    const cogs = absolute(invoice.stavke.filter((line) => !line.artikal.usluga && line.artikal.prati_zalihe).reduce((sum, line) => sum + (line.nabavna_vrijednost ? decimalToScaled(line.nabavna_vrijednost, 2) : BigInt(0)), BigInt(0)));
    const amounts = new Map<string, bigint>([["INVOICE_CUSTOMER", absolute(decimalToScaled(invoice.ukupno_sa_pdv, 2))], ["INVOICE_REVENUE", absolute(decimalToScaled(invoice.ukupno_osnovica, 2))], ["INVOICE_OUTPUT_VAT", absolute(decimalToScaled(invoice.ukupno_izlazni_pdv, 2))], ["INVOICE_COGS", cogs], ["INVOICE_INVENTORY", cogs]]);
    const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
    const journalLines: Array<{ amount: bigint; direction: "D" | "P"; code: string }> = [];
    for (const field of outgoingInvoicePostingFields) {
      const amount = amounts.get(field.purpose) ?? BigInt(0);
      if (!amount) continue;
      const setting = settingMap.get(field.purpose);
      if (!setting?.sifra_konta) return { ok: false as const, reason: "podesavanja" };
      const configuredDirection = setting.smjer === "P" ? "P" : "D";
      journalLines.push({ amount, direction: correction ? (configuredDirection === "D" ? "P" : "D") : configuredDirection, code: setting.sifra_konta });
    }
    const debit = journalLines.filter((line) => line.direction === "D").reduce((sum, line) => sum + line.amount, BigInt(0));
    const credit = journalLines.filter((line) => line.direction === "P").reduce((sum, line) => sum + line.amount, BigInt(0));
    if (debit !== credit) return { ok: false as const, reason: "balans" };
    const resolvedLines: Array<(typeof journalLines)[number] & { account: NonNullable<Awaited<ReturnType<typeof resolveAccount>>> }> = [];
    for (const line of journalLines) {
      const account = await resolveAccount(tx, input.firmaId, line.code);
      if (!account) return { ok: false as const, reason: "konto" };
      resolvedLines.push({ ...line, account });
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${input.firmaId}:${input.poslovnaGodinaId}:${journalType.id}`}))`;
    const last = await tx.nalog.findFirst({ where: { firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, vrsta_naloga_id: journalType.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const description = correction ? `POS storno virman ${invoice.interni_broj}` : `POS virman ${invoice.interni_broj}`;
    const journal = await tx.nalog.create({ data: { agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, vrsta_naloga_id: journalType.id, broj: number, sifra: formatJournalCode(journalType.prefiks, input.year, number), datum: invoice.datum_racuna, opis: description, status: journalStatuses.draft, source_type: "OUTGOING_INVOICE", source_module: "agencija.pos", izvorni_dokument_id: invoice.id, kreirao_korisnik_id: input.userId, created_by: input.userId, updated_by: input.userId } });
    let order = 1;
    for (const line of resolvedLines) {
      await tx.stavkaNaloga.create({ data: { nalog_id: journal.id, konto_id: line.account.id, komitent_id: line.account.analitika_obavezna ? invoice.kupac_id : null, duguje: line.direction === "D" ? scaledToDecimal(line.amount, 2) : "0.00", potrazuje: line.direction === "P" ? scaledToDecimal(line.amount, 2) : "0.00", opis: description, broj_dokumenta: invoice.broj_racuna, datum_dokumenta: invoice.datum_racuna, datum_valute: invoice.datum_valute, redni_broj: order++, created_by: input.userId, updated_by: input.userId } });
    }
    await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { status: "WAITING_KIF", kif_status: "WAITING_KIF", nalog_id: journal.id, posted_at: new Date(), posted_by: input.userId, updated_by: input.userId } });
    return { ok: true as const, journalId: journal.id, alreadyCompleted: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
