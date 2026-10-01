import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "./prisma";
import { clientScope, requireClientContext } from "./client-portal";
import { clientPartnerTypes, isClientPartnerType } from "./client-partner-policy";
import { invoicePostingDefaultScope, invoicePostingDocumentTypes } from "./account-plan";
import { decimalToScaled } from "./inventory-calculation";

export async function loadClientPartnerCard(tip: string, partner: string) {
  if (!isClientPartnerType(tip) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(partner)) notFound();
  const context = await requireClientContext(["izvjestaji", "nalozi"]);
  const config = clientPartnerTypes[tip];
  const account = await prisma.firmaPodrazumijevanoKonto.findFirst({
    where: { firma_id: context.firma.id, namjena: config.purpose,
      dokument_tip: invoicePostingDocumentTypes.general, podvrsta: invoicePostingDefaultScope.subtype,
      pdv_stopa_sifra: invoicePostingDefaultScope.vatRate }, select: { sifra_konta: true }
  });
  const lines = account ? await prisma.stavkaNaloga.findMany({
    where: { komitent_id: partner, firma_konto: { firma_id: context.firma.id, sifra: account.sifra_konta },
      nalog: { ...clientScope(context), status: "POSTED", is_deleted: false } },
    select: { id: true, duguje: true, potrazuje: true, opis: true, dodatni_opis: true, broj_dokumenta: true,
      datum_dokumenta: true, datum_valute: true, komitent: { select: { naziv: true, pib: true } },
      nalog: { select: { datum: true } } },
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
