import * as XLSX from "xlsx";

export class OpeningImportError extends Error {}
export function importFail(message: string): never { throw new OpeningImportError(message); }
export const importName = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const text = (value: unknown) => String(value ?? "").trim();

// Primatech formatted money uses comma thousands and a decimal point. Never
// interpret these strings with the locale-dependent journal input parser.
export function primatechCents(value: unknown, fractional = false): number {
  if (value == null || value === "" || value === "-") return 0;
  let raw = text(value);
  if (/^\(.*\)$/.test(raw)) raw = `-${raw.slice(1, -1)}`;
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) importFail(`Neispravan iznos: ${raw}`);
  raw = raw.replaceAll(",", "");
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace(/^-/, "").split(".");
  if (!fractional && fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) importFail(`Iznos stavke ima više od dvije decimale: ${raw}`);
  let cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  if (fractional && Number(fraction[2] ?? 0) >= 5) cents++;
  if (cents > BigInt("99999999999999")) importFail("Iznos prelazi dozvoljeni opseg.");
  return Number(negative ? -cents : cents);
}

export function primatechCode(value: unknown) {
  const code = text(value);
  if (!/^\d{3,12}$/.test(code)) importFail(`Neispravna šifra konta: ${code}`);
  return code.padStart(4, "0");
}

function date(value: unknown): string {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const m = text(value).match(/^(\d{2})\.(\d{2})\.(\d{4})\.?$/);
  if (!m) importFail("Datum nije prepoznat u Primatech nalogu.");
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) importFail("Neispravan datum.");
  return iso;
}

export type OpeningImportLine = { row: number; account: string; accountName: string; partner: string; description: string; debit: number; credit: number };
export type OpeningImportData = {
  format?: "PRIMATECH_V1" | "EPSILON_V1";
  epsilon?: { basis: "OPENING" | "CLOSING"; reportDate: string; expandedAccounts: string[]; blocked: string[]; controls: { account: string; expected: number; actual: number }[] };
  company: string; date: string; number: string; lines: OpeningImportLine[];
  partners: { name: string; pib: string | null; city: string }[];
  closing: { account: string; name: string; cents: number }[];
  files: { name: string; hash: string }[];
};

export function primatechRows(buffer: Buffer): unknown[][] {
  try {
    if (buffer.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1" && buffer.subarray(0, 4).toString("hex") !== "504b0304") importFail("Dostavite originalni Excel .xls ili .xlsx fajl.");
    const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: false, sheetRows: 10002 });
    if (workbook.SheetNames.length !== 1) importFail("Očekuje se Excel izvještaj sa jednim radnim listom.");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet["!ref"] || XLSX.utils.decode_range(sheet["!ref"]).e.c > 40) importFail("Nepodržan raspored kolona.");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
    if (rows.length > 10000) importFail("Izvještaj ima više od 10.000 redova.");
    return rows;
  } catch (error) {
    if (error instanceof OpeningImportError) throw error;
    importFail("Excel nije moguće pročitati. Dostavite originalni .xls ili .xlsx izvoz iz izabranog programa.");
  }
}

export function parsePrimatechOpening(rows: unknown[][]): Pick<OpeningImportData, "company" | "date" | "number" | "lines"> {
  const header = rows.findIndex(r => text(r[0]) === "RBR" && text(r[4]) === "Konto/Naziv konta" && text(r[10]) === "Duguje" && text(r[12]) === "Potražuje");
  const meta = rows.find(r => text(r[0]) === "Vrsta naloga:");
  const numberRow = rows.find(r => text(r[0]) === "Broj naloga:");
  if (header < 0 || !meta || importName(meta[6]) !== "POCETNO STANJE" || !numberRow || !rows.some(r => text(r[0]) === "Nalog za knjiženje")) importFail("Fajl nije podržani Primatech nalog početnog stanja. Zbirni pregled i analitika ne idu u ovo polje.");
  const openingDate = date(meta[13]);
  const lines: OpeningImportLine[] = [];
  let foundFooter = false;
  for (const r of rows.slice(header + 1)) {
    if (text(r[0]) === "Broj stavki:") {
      if (Number(r[4]) !== lines.length) importFail("Broj učitanih stavki ne odgovara izvještaju.");
      foundFooter = true;
      break;
    }
    if (r.every(v => v == null || v === "")) continue;
    if (!Number.isInteger(r[0]) || Number(r[0]) !== lines.length + 1) importFail("Redni brojevi stavki nijesu potpuni ili su duplirani.");
    if (text(r[2])) importFail("Nalog sadrži oznake organizacionih jedinica. Njihov pojedinačni prenos još nije podržan.");
    if (date(r[7]) !== openingDate) importFail(`Stavka ${r[0]} nema datum početnog stanja.`);
    const debit = primatechCents(r[10]), credit = primatechCents(r[12]);
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) importFail(`Stavka ${r[0]} mora imati jedan pozitivan iznos.`);
    const description = text(r[8]);
    const partner = description.split(/\r?\n/).slice(1).join(" ").trim();
    lines.push({ row: Number(r[0]), account: primatechCode(r[3]), accountName: text(r[6]), partner, description, debit, credit });
  }
  if (!foundFooter || !lines.length || lines.length > 1000) importFail("Nalog mora imati od 1 do 1.000 stavki i završni red Broj stavki.");
  return { company: text(rows[0][0]), date: openingDate, number: text(numberRow[3]), lines };
}

export function parsePrimatechPartners(rows: unknown[][]): OpeningImportData["partners"] {
  const start = rows.findIndex(r => importName(r[0]) === "PIB" && importName(r[1]) === "NAZIV" && importName(r[2]) === "GRAD");
  if (start < 0) importFail("Zbirni partneri moraju imati kolone Pib, Naziv i Grad. Analitička kartica nije ovaj izvještaj.");
  const partners: OpeningImportData["partners"] = [];
  for (const r of rows.slice(start + 1)) {
    if (typeof r[1] === "number" || !text(r[1])) continue; // report total
    let pib = text(r[0]);
    if (/^\d{7}$/.test(pib)) pib = `0${pib}`;
    if (pib && !/^\d{8}$/.test(pib)) importFail(`Neispravan PIB uz partnera ${text(r[1])}.`);
    partners.push({ name: text(r[1]), pib: pib || null, city: text(r[2]) });
  }
  if (!partners.length) importFail("Zbirni pregled nema partnera.");
  return partners;
}

export function parsePrimatechClosing(rows: unknown[][]): OpeningImportData["closing"] {
  const start = rows.findIndex(r => text(r[0]) === "Oznaka" && text(r[1]) === "Naziv" && text(r[8]) === "Saldo");
  if (start < 0 || !text(rows[start][2]).startsWith("PSDuguje")) importFail("Nije prepoznat Primatech zaključni list sa kolonom Saldo.");
  return rows.slice(start + 1).filter(r => text(r[0])).map(r => ({ account: primatechCode(r[0]), name: text(r[1]), cents: primatechCents(r[8], true) }));
}

export function openingTotals(lines: OpeningImportLine[]) {
  const debit = lines.reduce((n, l) => n + l.debit, 0), credit = lines.reduce((n, l) => n + l.credit, 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) importFail("Zbir iznosa je prevelik.");
  return { debit, credit, difference: debit - credit };
}

export function closingComparison(data: OpeningImportData) {
  const closing = new Map<string, number>(), opening = new Map<string, number>();
  for (const r of data.closing) closing.set(r.account, (closing.get(r.account) ?? 0) + r.cents);
  for (const r of data.lines) opening.set(r.account, (opening.get(r.account) ?? 0) + r.debit - r.credit);
  return [...new Set([...closing.keys(), ...opening.keys()])].sort().map(account => ({ account,
    closing: closing.get(account) ?? 0, opening: opening.get(account) ?? 0
  })).filter(r => r.closing !== r.opening);
}
