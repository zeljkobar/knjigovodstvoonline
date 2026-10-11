import { Prisma } from "@prisma/client";
import { TravelError, type TravelData, type TravelPostingScheme } from "./travel-orders";

// Resolve codes against the firm's overrides first, then materialise the global account.
export async function travelPostingAccount(tx: Prisma.TransactionClient, firmaId: string, code: string) {
  if (!code || code.trim().length < 4) throw new TravelError("Podesite analitička konta šeme knjiženja putnih naloga.");
  let account = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: firmaId, sifra: code } } });
  if (!account) {
    const base = await tx.konto.findFirst({ where: { sifra: code, aktivan: true, tip_konta: "analiticko" } });
    if (!base) throw new TravelError(`Konto ${code} nije dostupan u kontnom planu firme.`);
    account = await tx.firmaKonto.create({ data: { firma_id: firmaId, konto_id: base.id, sifra: base.sifra, naziv: base.naziv, tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna, sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo, koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, override_type: "BASE_LINK", aktivan: true } });
  }
  if (!account.aktivan || account.override_type === "DEACTIVATED" || account.tip_konta !== "analiticko") throw new TravelError(`Konto ${code} nije aktivno analitičko konto.`);
  return account;
}
export async function travelJournalType(tx: Prisma.TransactionClient, id: string, agencyId: string, firmaId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TravelError("Izaberite vrstu naloga za knjiženje.");
  const type = await tx.vrstaNaloga.findFirst({ where: { id, aktivan: true, NOT: { sifra: "OPENING_BALANCE" }, OR: [{ sistemska: true }, { agencija_id: agencyId, firma_id: null }, { agencija_id: agencyId, firma_id: firmaId }] } });
  if (!type) throw new TravelError("Vrsta naloga nije dostupna.");
  return type;
}
export function travelPostingAmounts(data: TravelData) {
  const parts = { dnevnice: data.dnevniceUkupno, kilometraza: data.relacije.reduce((s, r) => s + r.iznos, 0), ostalo: data.troskovi.reduce((s, r) => s + r.iznos, 0) };
  const total = parts.dnevnice + parts.kilometraza + parts.ostalo;
  if (Object.values(parts).some(n => !Number.isSafeInteger(n) || n < 0) || !Number.isSafeInteger(total) || total <= 0 || total !== data.ukupno) throw new TravelError("Obračun nije ispravan ili nema troškova za knjiženje.");
  return { ...parts, obaveza: total };
}
export async function validateTravelScheme(tx: Prisma.TransactionClient, scheme: TravelPostingScheme, agencyId: string, firmaId: string) {
  for (const key of ["dnevnice", "kilometraza", "ostalo", "obaveza"] as const) if (scheme[key]) await travelPostingAccount(tx, firmaId, scheme[key]);
  if (scheme.vrstaNaloga) await travelJournalType(tx, scheme.vrstaNaloga, agencyId, firmaId);
}
export function travelCentsDecimal(cents: number) { return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`; }
