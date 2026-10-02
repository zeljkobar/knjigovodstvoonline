import type { Prisma } from "@prisma/client";

export const agencyProfileSelect = {
  id: true, naziv: true, pib: true, pdv_broj: true, adresa: true, grad: true,
  telefon: true, email: true, zastupnik_ime: true, zastupnik_funkcija: true, updated_at: true,
  bankovni_racuni: { where: { is_deleted: false }, orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
    select: { id: true, naziv_banke: true, broj_racuna: true, glavni: true } }
} satisfies Prisma.AgencijaSelect;
export type AgencyProfile = Prisma.AgencijaGetPayload<{ select: typeof agencyProfileSelect }>;
export function missingAgencyFields(agency: Pick<AgencyProfile, "naziv" | "pib" | "adresa" | "grad" | "zastupnik_ime" | "zastupnik_funkcija">) {
  return ([['naziv','naziv'],['pib','PIB'],['adresa','adresa'],['grad','sjedište'],['zastupnik_ime','ime zastupnika'],['zastupnik_funkcija','funkcija zastupnika']] as const)
    .filter(([field])=>!agency[field]?.trim()).map(([,label])=>label);
}
export function agencyContractSnapshot(agency: AgencyProfile) {
  const main = agency.bankovni_racuni.find(account => account.glavni);
  return { naziv: agency.naziv, pib: agency.pib, pdv_broj: agency.pdv_broj, adresa: agency.adresa,
    grad: agency.grad, telefon: agency.telefon, email: agency.email, zastupnik_ime: agency.zastupnik_ime,
    zastupnik_funkcija: agency.zastupnik_funkcija, banka: main?.naziv_banke ?? null, racun: main?.broj_racuna ?? null };
}
export const contractDirectorSelect = {
  where: { uloga: "IZVRSNI_DIREKTOR", aktivan: true, is_deleted: false },
  orderBy: [{ primarno: "desc" }, { created_at: "asc" }],
  take: 1,
  select: { ime_prezime: true }
} satisfies Prisma.Firma$odgovorna_licaArgs;
export function clientContractSnapshot(firm: {naziv:string;pib:string|null;pdv_broj:string|null;adresa:string|null;grad:string|null;opstina:string|null;telefon:string|null;email:string|null;odgovorna_lica?:{ime_prezime:string}[]}) {
  return {naziv:firm.naziv,pib:firm.pib,pdv_broj:firm.pdv_broj,adresa:firm.adresa,grad:firm.grad,opstina:firm.opstina,telefon:firm.telefon,email:firm.email,zastupnik_ime:firm.odgovorna_lica?.[0]?.ime_prezime ?? null,zastupnik_funkcija:firm.odgovorna_lica?.length ? "izvršni direktor" : null};
}
export function readContractSnapshot<T extends Record<string, string | null>>(value: Prisma.JsonValue | null, fallback: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  // Never fill a saved null with today's data: that would silently rewrite history.
  return Object.fromEntries(Object.keys(fallback).map(key => [key, typeof value[key] === "string" ? value[key] : null])) as T;
}
