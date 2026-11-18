export type FiscalSearch = Record<string, string | string[] | undefined>;
export type FiscalQuery = Record<string, string | number | undefined>;
export const invoiceEnvironments = { Production: "Produkcija", Test: "Test", Unknown: "Nepoznato" } as const;
export const groupings = { Day: "Dan", Month: "Mjesec", Year: "Godina" } as const;
export const fiscalReviewRoutes = {
  home: "/admin/fiskalizacija", invoices: "/admin/fiskalizacija/racuni",
  turnover: "/admin/fiskalizacija/izvjestaji", documents: "/admin/fiskalizacija/izvjestaji/dokumenti",
  diagnostics: "/admin/fiskalizacija/dijagnostika"
} as const;

export function fiscalQueryString(values: FiscalQuery) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(name, String(value));
  }
  return query.toString();
}

export function fiscalReviewHref(path: string, values: FiscalQuery) {
  const query = fiscalQueryString(values);
  return query ? path + "?" + query : path;
}

export function isFiscalUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000";
}

export function fiscalPage(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : 1;
}

export function fiscalInput(value: unknown, maxLength = 100) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isPeriodDate(value: string) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value >= "0002-01-01" && value <= "9998-12-31" &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function defaultFiscalPeriod(now = new Date()) {
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const year = Number(fields.find(x => x.type === "year")?.value);
  const month = Number(fields.find(x => x.type === "month")?.value);
  return {
    fromDate: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    toDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
  };
}

export function fiscalEnum<T extends string>(value: unknown, options: Readonly<Record<T, string>>): T | undefined {
  return typeof value === "string" && Object.hasOwn(options, value) ? value as T : undefined;
}

export function fiscalReportSelection(query: FiscalSearch, now = new Date()) {
  const defaults = defaultFiscalPeriod(now);
  const companyId = fiscalInput(query.companyId);
  const fromDate = query.fromDate === undefined ? defaults.fromDate : fiscalInput(query.fromDate);
  const toDate = query.toDate === undefined ? defaults.toDate : fiscalInput(query.toDate);
  const environment = query.environment === undefined ? "Production" : fiscalEnum(query.environment, invoiceEnvironments);
  const groupBy = query.groupBy === undefined ? "Month" : fiscalEnum(query.groupBy, groupings);
  const values = { companyId, environment, groupBy, fromDate, toDate };
  if (!isPeriodDate(fromDate) || !isPeriodDate(toDate) || fromDate >= toDate ||
      Date.parse(toDate) - Date.parse(fromDate) > 3660 * 86_400_000)
    return { values, error: "Izaberi ispravan period do 3660 dana. Završni datum nije uključen." };
  if (!environment || !groupBy) return { values, error: "Izaberi okruženje i način grupisanja." };
  if (companyId && !isFiscalUuid(companyId)) return { values, error: "Firma nije ispravno izabrana." };
  if (!companyId) return { values };
  return { values, filter: { companyId, environment, groupBy, fromDate, toDate } };
}

export const fiscalMetrics = {
  DocumentCount: "Potvrđeni dokumenti", SaleInvoiceCount: "Prodajni računi", SalesPositive: "Pozitivni promet",
  SalesCorrections: "Korekcije prodaje", SalesNet: "Neto promet", Category: "Kategorija dokumenta",
  Payment: "Oznaka plaćanja", Status: "Status dokumenta", OpenWorkflow: "Otvoren postupak"
} as const;

export function fiscalDocumentSelection(query: FiscalSearch) {
  const metric = query.metric === undefined ? "DocumentCount" : fiscalEnum(query.metric, fiscalMetrics);
  if (!metric) return null;
  const bucketStartDate = fiscalInput(query.bucketStartDate);
  if (bucketStartDate && !isPeriodDate(bucketStartDate)) return null;
  const result: FiscalQuery = { metric, bucketStartDate };
  const required = metric === "Category" ? ["category"] : metric === "Payment" ? ["category", "paymentType"] :
    metric === "Status" ? ["status"] : metric === "OpenWorkflow" ? ["workflowKind"] : [];
  for (const name of required) {
    const value = fiscalInput(query[name]);
    if (!/^[a-z][a-z0-9]*$/i.test(value)) return null;
    result[name] = value;
  }
  const vatRate = fiscalInput(query.vatRate);
  if (vatRate) {
    if (!["SalesNet", "SalesPositive", "SalesCorrections"].includes(metric) ||
        !/^(?:[0-9]{1,2}(?:[.][0-9]{1,4})?|100(?:[.]0{1,4})?)$/.test(vatRate)) return null;
    result.vatRate = vatRate;
  }
  return result;
}

export function fiscalUtcRange(fromValue: unknown, toValue: unknown) {
  const fromDate = fiscalInput(fromValue);
  const toDate = fiscalInput(toValue);
  if (!fromDate && !toDate) return { fromDate, toDate };
  if (!isPeriodDate(fromDate) || !isPeriodDate(toDate) || fromDate >= toDate ||
      Date.parse(toDate) - Date.parse(fromDate) > 366 * 86_400_000)
    return { fromDate, toDate, error: "Unesi oba UTC datuma u rastućem rasponu do 366 dana." };
  return { fromDate, toDate, from: fromDate + "T00:00:00Z", to: toDate + "T00:00:00Z" };
}

export function officialFiscalQr(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !["mapr.tax.gov.me", "efitest.tax.gov.me"].includes(url.hostname) ||
        url.pathname !== "/ic/" || !url.hash.startsWith("#/verify?")) return null;
    return url.href;
  } catch {
    return null;
  }
}
