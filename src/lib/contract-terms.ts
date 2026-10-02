import { parseMoneyToCents } from "./payroll";

// Signing date and service start can differ (including retroactive service start).
export function parseContractTerms(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  let valid = true;
  function date(key: string) {
    const raw = text(key);
    if (!raw) return null;
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
      valid = false;
      return null;
    }
    return parsed;
  }
  function integer(key: string, min: number, max: number) {
    const raw = text(key);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
      valid = false;
      return null;
    }
    return parsed;
  }
  function money(key: string, signed = false) {
    const input = text(key);
    const negative = signed && input.startsWith("-");
    const raw = negative ? input.slice(1) : input;
    if (!raw) return null;
    const cents = parseMoneyToCents(raw);
    if (!/^(?:\d+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+,\d{1,2})$/.test(raw) || cents === null || !Number.isSafeInteger(cents) || cents > 99999999999999) {
      valid = false;
      return null;
    }
    return `${negative && cents !== 0 ? "-" : ""}${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  }
  const mode = text("rok_placanja_tip") || "dani";
  if (mode !== "dan_u_mjesecu" && mode !== "dani") valid = false;
  const data = {
    datum_zakljucenja: date("datum_zakljucenja"),
    datum_pocetka: date("datum_pocetka"),
    datum_prestanka: date("datum_prestanka"),
    dan_placanja: mode === "dan_u_mjesecu" ? integer("dan_placanja", 1, 31) : null,
    rok_placanja_dana: mode === "dani" ? integer("rok_placanja_dana", 0, 365) : null,
    dan_fakturisanja: integer("dan_fakturisanja", 1, 31),
    nadlezni_sud: text("nadlezni_sud") || null,
    mjesecna_cijena: money("mjesecna_cijena"),
    dugovanje: money("dugovanje", true)
  };
  if (data.nadlezni_sud && (data.nadlezni_sud.length > 200 || /[\u0000-\u001f]/.test(data.nadlezni_sud))) valid = false;
  if (data.datum_pocetka && data.datum_prestanka && data.datum_prestanka < data.datum_pocetka) valid = false;
  return valid ? data : null;
}
