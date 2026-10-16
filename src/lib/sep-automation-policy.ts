import * as XLSX from "xlsx";

export function sepAutomationDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (key: string) => parts.find(part => part.type === key)!.value;
  return { day: `${value("year")}-${value("month")}-${value("day")}`, due: Number(value("hour")) >= 4 };
}
export function sepAutomationPeriods(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("INVALID_DAY");
  const yesterday = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
  if (date.getUTCDate() === 1) return [{ from: `${yesterday.slice(0, 7)}-01`, to: yesterday }];
  return [{ from: `${day.slice(0, 7)}-01`, to: yesterday }];
}
function wallTime(value: unknown) {
  let y: number, m: number, d: number, h: number, min: number, sec: number;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) throw new Error("Neispravan datum u SEP redu.");
    ({ y, m, d, H: h, M: min } = parsed); sec = Math.round(parsed.S);
  } else {
    const raw = String(value ?? "").trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    const local = /^(\d{2})\.(\d{2})\.(\d{4})\.?\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
    if (iso) [, y, m, d, h, min, sec] = iso.map(Number);
    else if (local) { const [, dd, mm, yy, hh, mi, ss] = local; [y, m, d, h, min, sec] = [Number(yy), Number(mm), Number(dd), Number(hh), Number(mi), Number(ss ?? 0)]; }
    else throw new Error("Nedostaje ispravno SEP vrijeme fiskalizovanja.");
    if (iso && /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      const instant = new Date(raw);
      if (!Number.isFinite(instant.getTime())) throw new Error("Neispravan datum u SEP redu.");
      return instant.toISOString();
    }
  }
  sec = sec || 0;
  const wall = Date.UTC(y, m - 1, d, h, min, sec);
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const expected = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  const candidates = [60, 120].map(offset => new Date(wall - offset * 60000)).filter(date => formatter.format(date) === expected);
  if (candidates.length !== 1) throw new Error("SEP vrijeme je neispravno ili dvosmisleno pri promjeni sata.");
  return candidates[0].toISOString();
}
export function sepAutomationScheduledAt(day: string) {
  return new Date(wallTime(`${day} 04:00:00`));
}

export type SepAutomationInvoice = { link: string; iic: string; metadata: { link: string; buyerName?: string; buyerTin?: string; invoiceNumber?: string; total?: number } };
export function parseSepAutomationExcel(bytes: Buffer, pib: string, from: string, to: string) {
  const book = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("SEP Excel nema čitljiv list.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (rows.length > 10000) throw new Error("SEP Excel ima previše redova.");
  const invoices: SepAutomationInvoice[] = [], errors: string[] = [];
  const seen = new Set<string>(); let skipped = 0;
  for (const [index, row] of rows.entries()) {
    if (String(row.Status ?? "").trim().toUpperCase() !== "CORRECT") { skipped++; continue; }
    try {
      const iic = String(row["IKOF računa"] ?? "").trim().toUpperCase();
      if (!/^[0-9A-F]{32}$/.test(iic)) throw new Error("Nedostaje ispravan IKOF.");
      const crtd = wallTime(row["Datum fiskalizovanja"] || row["Datum izdavanja"]);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(crtd));
      if (day < from || day > to) throw new Error("Datum računa je izvan traženog perioda.");
      const bu = String(row["Kod poslovne jedinice"] ?? "").trim(), cr = String(row["ENU kod"] ?? "").trim();
      const ord = Number(row["Redni broj"]), total = Number(String(row["Ukupna cijena (€)"] ?? "").replace(",", "."));
      if (row["Ukupna cijena (€)"] === "" || !bu || !cr || !Number.isSafeInteger(ord) || ord < 1 || !Number.isFinite(total)) throw new Error("Nedostaju podaci za MAPR link.");
      if (seen.has(iic)) { skipped++; continue; } seen.add(iic);
      const params = new URLSearchParams({ iic, tin: pib, crtd, ord: String(ord), bu, cr, prc: total.toFixed(2) });
      const link = `https://mapr.tax.gov.me/ic/#/verify?${params}`;
      const digits = String(row["PIB kupca"] ?? "").replace(/\D/g, "");
      invoices.push({ link, iic, metadata: { link, buyerName: String(row["Ime kupca"] ?? "").trim(), buyerTin: digits.length === 7 ? `0${digits}` : digits, invoiceNumber: `${ord}/${day.slice(0, 4)}`, total } });
    } catch (error) { errors.push(`Red ${index + 2}: ${error instanceof Error ? error.message : "Neispravni podaci."}`); }
  }
  return { invoices, errors, skipped, total: rows.length };
}
