import { effectiveDefaultAccount } from "@/lib/posting-template";
import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "./prisma";
import { clientScope, requireClientContext } from "./client-portal";
import { clientPartnerTypes, isClientPartnerType } from "./client-partner-policy";
import { invoicePostingDefaultScope, invoicePostingDocumentTypes } from "./account-plan";
import { decimalToScaled } from "./inventory-calculation";

export async function loadClientPartnerCard(tip: string, partner: string, yearId?: string) {
  if (!isClientPartnerType(tip) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(partner)) notFound();
  const activeContext = await requireClientContext(["izvjestaji", "nalozi"]);
  const year = yearId === undefined ? activeContext.year : activeContext.years.find(item => item.id === yearId);
  if (!year) notFound();
  const context = { ...activeContext, year };
  const config = clientPartnerTypes[tip];
  const account = await effectiveDefaultAccount(prisma, {
    where: { firma_id: context.firma.id, namjena: config.purpose,
      dokument_tip: invoicePostingDocumentTypes.general, podvrsta: invoicePostingDefaultScope.subtype,
      pdv_stopa_sifra: invoicePostingDefaultScope.vatRate }, select: { sifra_konta: true }
  });
  const lines = account ? await prisma.stavkaNaloga.findMany({
    where: { komitent_id: partner, firma_konto: { firma_id: context.firma.id, sifra: account.sifra_konta },
      nalog: { ...clientScope(context), status: "POSTED", is_deleted: false } },
    select: { id: true, duguje: true, potrazuje: true, opis: true, dodatni_opis: true, broj_dokumenta: true,
      datum_dokumenta: true, datum_valute: true, komitent: { select: { naziv: true, pib: true } },
      nalog: { select: {
        datum: true,
        source_type: true,
        vrsta_naloga: { select: { sifra: true } },
        bankStatements: {
          where: { ...clientScope(context), is_deleted: false },
          select: { statement_number: true }, take: 2
        }
      } } },
    orderBy: [{ nalog: { datum: "asc" } }, { created_at: "asc" }, { id: "asc" }]
  }) : [];
  // Partner metadata is returned only through a scoped, posted journal line.
  if (account && !lines.length) notFound();
  return { context, config, configured: Boolean(account), partner: lines[0]?.komitent, lines };
}
export function clientCents(value: { toString(): string }) { return decimalToScaled(value, 2); }
export function clientDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export type ClientPartnerCardQuery = { partner?: string; datum_od?: string; datum_do?: string };

export async function loadClientPartnerCardReport(tip: string, query: ClientPartnerCardQuery, yearId?: string) {
  const data = await loadClientPartnerCard(tip, query.partner ?? "", yearId);
  const from = clientDate(query.datum_od);
  const to = clientDate(query.datum_do);
  const invalidPeriod = Boolean(from && to && from > to);
  let opening = BigInt(0);
  let debit = BigInt(0);
  let credit = BigInt(0);
  const rows = [];
  for (const line of data.lines) {
    const date = line.nalog.datum;
    const lineDebit = clientCents(line.duguje);
    const lineCredit = clientCents(line.potrazuje);
    if (from && date < from) {
      opening += lineDebit - lineCredit;
    } else if (!to || date <= to) {
      debit += lineDebit;
      credit += lineCredit;
      rows.push({ ...line, debit: lineDebit, credit: lineCredit, balance: opening + debit - credit });
    }
  }
  return { ...data, from, to, invalidPeriod, opening, debit, credit, balance: opening + debit - credit, rows };
}
