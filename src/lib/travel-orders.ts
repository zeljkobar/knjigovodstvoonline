export class TravelError extends Error {}
export type TravelLeg = { od: string; do: string; prevoz: string; km: number; cijena: number; iznos: number; odDrzava?: string; doDrzava?: string; stopa10000?: number };
export type TravelExpense = { opis: string; iznos: number };
export type TravelPostingScheme = { dnevnice: string; kilometraza: string; ostalo: string; obaveza: string; vrstaNaloga: string };
export const travelPostingFields = [["dnevnice", "Dnevnice — duguje"], ["kilometraza", "Sopstveno vozilo — duguje"], ["ostalo", "Ostali troškovi — duguje"], ["obaveza", "Obaveza prema zaposlenom — potražuje"]] as const;
export type TravelSettings = { knjizenje?: TravelPostingScheme; dnevnica: number; kilometar: number; polaSati: number; punaSati: number; teret: string; mjesto: string; gorivo?: number; dnevniceDrzava?: Record<string, number> };
export const travelDefaults: TravelSettings = { dnevnica: 0, kilometar: 0, polaSati: 8, punaSati: 12, teret: "MATERIJALNIH TROŠKOVA", mjesto: "" };
export type TravelData = {
  firma: string; radnikId: string; radnik: string; pozicija: string; svrha: string; odrediste: string;
  polazak: string; povratak: string; registracija: string; odlazakPrevoz: string; povratakPrevoz: string;
  mjesto: string; teret: string; izvjestaj: string; prilozi: number; akontacija: number;
  dnevnica: number; brojDnevnica: number; rucneDnevnice?: boolean; sati: number; dnevniceUkupno: number;
  relacije: TravelLeg[]; troskovi: TravelExpense[]; ukupno: number; razlika: number;
  drzava?: string; gorivo?: number; obracunVerzija?: number;
  polaSati: number; punaSati: number;
};
export function city(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("sr-Latn"); }
export function routeKey(a: string, b: string, aCountry = "", bCountry = "") { return [aCountry ? `${aCountry}:${city(a)}` : city(a), bCountry ? `${bCountry}:${city(b)}` : city(b)].sort().join("|"); }
export const travelVehicles = ["SOPSTVENO VOZILO", "SLUŽBENO VOZILO"] as const;
export function travelVehicle(value: string) {
  if (!travelVehicles.includes(value as typeof travelVehicles[number])) throw new TravelError("Izaberite sopstveno ili službeno vozilo.");
  return value;
}
// Integer units of 0.0001 EUR/km retain quarter-cent precision until the final amount.
export function fuelRate(fuelCents: number, vehicle: string) {
  travelVehicle(vehicle);
  if (!Number.isSafeInteger(fuelCents) || fuelCents < 0 || fuelCents > 10000) throw new TravelError("Cijena goriva mora biti između 0 i 100 EUR/l.");
  return vehicle === "SOPSTVENO VOZILO" ? fuelCents * 25 : 0;
}
export function travelRate(r: TravelLeg) { return r.stopa10000 === undefined ? travelAmount(r.cijena) : (r.stopa10000 / 10000).toLocaleString("sr-Latn-ME", {minimumFractionDigits:2, maximumFractionDigits:4}); }
// Strict decimal parsing keeps currency arithmetic in integer cents.
export function travelMoney(value: string) {
  const s = value.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw new TravelError("Unesite iznos sa najviše dvije decimale.");
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function travelNumber(value: string, max: number, precision = 2) {
  if (!new RegExp(`^\\d{1,7}(\\.\\d{1,${precision}})?$`).test(value.replace(",", "."))) throw new TravelError("Neispravan broj.");
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new TravelError("Broj je van dozvoljenog raspona.");
  return n;
}
export function travelDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new TravelError("Neispravan datum.");
  return new Date(`${value}T00:00:00Z`);
}
// Convert a local wall clock to Europe/Podgorica, including daylight saving.
export function travelInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new TravelError("Unesite datum i vrijeme.");
  travelDate(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14)) > 59) throw new TravelError("Neispravno vrijeme.");
  const target = Date.parse(`${value}:00Z`);
  const format = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const local = format.format(new Date(instant)).replace(" ", "T");
    if (local === value) return instant;
    instant += target - Date.parse(`${local}:00Z`);
  }
  throw new TravelError("Vrijeme ne postoji zbog pomjeranja sata.");
}
export function travelDuration(start: string, end: string) {
  const minutes = (travelInstant(end) - travelInstant(start)) / 60000;
  if (minutes < 0 || minutes > 366 * 24 * 60) throw new TravelError("Povratak mora biti poslije polaska, u rasponu do godinu dana.");
  return minutes;
}
export function dailyCount(minutes: number, half: number, full: number) {
  const hours = minutes / 60, remaining = hours % 24;
  return Math.floor(hours / 24) + (remaining > full ? 1 : remaining > half ? 0.5 : 0);
}
export function calculateTravel(d: Pick<TravelData, "brojDnevnica" | "dnevnica" | "relacije" | "troskovi" | "akontacija">) {
  const dnevniceUkupno = Math.round(d.brojDnevnica * d.dnevnica);
  const relacije = d.relacije.map(r => ({ ...r, iznos: Math.round(Math.round(r.km * 100) * (r.stopa10000 ?? r.cijena * 100) / 10000) }));
  const ukupno = dnevniceUkupno + relacije.reduce((s, r) => s + r.iznos, 0) + d.troskovi.reduce((s, r) => s + r.iznos, 0);
  if (!Number.isSafeInteger(ukupno) || ukupno > 2_000_000_000) throw new TravelError("Ukupni iznos je previsok.");
  return { relacije, dnevniceUkupno, ukupno, razlika: ukupno - d.akontacija };
}
export const travelAmount = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
