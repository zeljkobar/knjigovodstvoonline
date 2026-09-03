import template from "./financial-report-xml-template.json";

export type XmlReportRow = {
  aop: string | null;
  tekucaGodina: number;
  prethodnaGodina?: number;
  prethodnaGodinaKraj?: number;
  prethodnaGodinaPocetak?: number;
};
export type XmlReports = {
  BilanStanja: XmlReportRow[];
  BilanUspjeha: XmlReportRow[];
  StatistickiAneks: XmlReportRow[];
};
export const xmlHeaderFields = [
  "Godina", "DatumOd", "DatumDo", "NazivObveznika", "SjedisteObveznika",
  "SifraDjelatnosti", "MaticniBroj", "LiceKojeSastavljaIskaz_Naziv",
  "LiceKojeSastavljaIskaz_JMBG", "LiceKojeSastavljaIskaz_Email",
  "OdgovornoLice_Ime", "OdgovornoLice_Prezime", "OdgovornoLice_JMBG",
  "FinansijskiIzvestajSastavljenNaDan", "FinansijskiIzvestajPodnesenNaDan"
] as const;
export type XmlHeader = Record<(typeof xmlHeaderFields)[number], string>;

export class FinancialXmlError extends Error {}

export function xmlText(value: string): string {
  for (const character of value) {
    const cp = character.codePointAt(0)!;
    if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 32 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff))) {
      throw new FinancialXmlError("Tekst sadrži znak koji XML ne podržava.");
    }
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function xmlDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new FinancialXmlError("Datum nije ispravan.");
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new FinancialXmlError("Datum nije ispravan.");
  }
  // ISO 8601; XSD defines dates as strings. Portal acceptance requires manual QA.
  return iso;
}

function amount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value))) {
    throw new FinancialXmlError("Obrazac sadrži neispravan ili prevelik iznos.");
  }
  // Same whole-EUR rounding as the existing report screen and print, no thousands separator.
  return String(Math.round(value));
}

export function buildFinancialReportXml(header: XmlHeader, reports: XmlReports): string {
  for (const field of xmlHeaderFields) {
    if (typeof header[field] !== "string" || header[field].length > 500) {
      throw new FinancialXmlError("Podaci zaglavlja nijesu ispravni.");
    }
    xmlText(header[field]);
  }
  for (const field of ["Godina", "DatumOd", "DatumDo", "NazivObveznika", "SjedisteObveznika", "MaticniBroj", "SifraDjelatnosti"] as const) {
    if (!header[field].trim()) throw new FinancialXmlError(`Popunite polje ${field}.`);
  }
  if (!/^\d{4}$/.test(header.Godina)) throw new FinancialXmlError("Godina nije ispravna.");
  for (const field of ["DatumOd", "DatumDo", "FinansijskiIzvestajSastavljenNaDan", "FinansijskiIzvestajPodnesenNaDan"] as const) {
    if (header[field]) xmlDate(header[field]);
  }
  if (header.DatumOd > header.DatumDo || !header.DatumOd.startsWith(header.Godina) || !header.DatumDo.startsWith(header.Godina)) {
    throw new FinancialXmlError("Period mora pripadati izabranoj godini.");
  }
  for (const field of ["LiceKojeSastavljaIskaz_JMBG", "OdgovornoLice_JMBG"] as const) {
    if (header[field] && !/^\d{13}$/.test(header[field])) throw new FinancialXmlError("JMBG mora imati 13 cifara ili biti prazan.");
  }
  if (header.LiceKojeSastavljaIskaz_Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(header.LiceKojeSastavljaIskaz_Email)) {
    throw new FinancialXmlError("E-mail sastavljača nije ispravan.");
  }

  const tag = (key: string, value: string) => `<${key}>${xmlText(value)}</${key}>`;
  const parts = ['<?xml version="1.0" encoding="utf-8"?>', "<FinansijskiIskazi>", "<Zaglavlje>",
    ...xmlHeaderFields.map((key) => tag(key, header[key])), "</Zaglavlje>"];
  for (const [section, rows] of Object.entries(template)) {
    const source = reports[section as keyof XmlReports];
    const byAop = new Map<string, XmlReportRow>();
    const expected = new Set(rows.map((row) => (row as Record<string, string>).RedniBroj).filter(Boolean));
    if (source) {
      for (const row of source) {
        if (!row.aop) continue;
        const aop = row.aop.replace(/^A/, "");
        if (!expected.has(aop) || byAop.has(aop)) throw new FinancialXmlError(`${section}: nepoznat ili dupliran AOP ${aop}.`);
        byAop.set(aop, row);
      }
      for (const aop of expected) {
        if (!byAop.has(aop)) throw new FinancialXmlError(`${section}: nedostaje AOP ${aop}. Provjerite šablon obrasca.`);
      }
    }
    parts.push(`<${section}>`);
    for (const original of rows) {
      const row: Record<string, string> = { ...original };
      // Unused forms and heading rows use zeros, including amortization rates.
      for (const field of Object.keys(row)) if (field.startsWith("Iznos")) row[field] = "0";
      const values = source && row.RedniBroj ? byAop.get(row.RedniBroj) : undefined;
      if (values) {
        row.Iznos1 = amount(values.tekucaGodina);
        row.Iznos2 = amount(section === "BilanStanja" ? values.prethodnaGodinaKraj : values.prethodnaGodina);
        if (section === "BilanStanja") row.Iznos3 = amount(values.prethodnaGodinaPocetak);
      }
      parts.push("<Stavka>", ...Object.entries(row).map(([key, value]) => tag(key, value)), "</Stavka>");
    }
    parts.push(`</${section}>`);
  }
  parts.push("</FinansijskiIskazi>");
  return parts.join("\n");
}
