import "server-only";
import https from "node:https";
import * as XLSX from "xlsx";
import type { SepCredentials } from "./sep-secrets";

export class SepError extends Error {
  constructor(readonly code: string) { super(code); }
}
export type SepCell = { columnName: string; value?: unknown; valueDisplay?: unknown; valueDisplayLocal?: unknown };
export type SepRow = { tableRowCells: SepCell[] };
export type SepTable = {
  rowCount: number; tableRows: SepRow[];
  tableColumns: { columnName: string; viewDisabled?: boolean }[];
  exportExcelFromBackend?: boolean;
};
type Transport = (path: string, data: unknown, options?: { form?: boolean; binary?: boolean; get?: boolean }) => Promise<unknown>;

export function sepDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new SepError("INVALID_PERIOD");
  const [, year, month, day] = match;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new SepError("INVALID_PERIOD");
  return { time, displayed: `${day}.${month}.${year}` };
}
export function sepPeriod(from: string, to: string) {
  const start = sepDate(from), end = sepDate(to);
  if (start.time > end.time || end.time - start.time > 365 * 86400000) throw new SepError("INVALID_PERIOD");
  return { start, end, filters: [{ name: "IVS_FISCAL_DATE", value: `${start.displayed}-${end.displayed}`, valueList: null, exactFilter: false }] };
}
function tableResponse(value: unknown): SepTable {
  if (!Array.isArray(value) || value.length !== 1) throw new SepError("UNKNOWN_TABLE_FORMAT");
  const table = value[0] as SepTable;
  if (!Array.isArray(table.tableRows) || !Array.isArray(table.tableColumns) || !Number.isSafeInteger(Number(table.rowCount)) || Number(table.rowCount) < 0 || Number(table.rowCount) > 10000) throw new SepError("INVALID_ROW_COUNT");
  if (table.tableRows.some(row => !Array.isArray(row.tableRowCells))) throw new SepError("UNKNOWN_TABLE_FORMAT");
  return table;
}
function rowKey(row: SepRow) {
  const key = row.tableRowCells.find(cell => cell.columnName === "IVS_FIC")?.value;
  if (typeof key !== "string" || !key) throw new SepError("MISSING_INVOICE_ID");
  return key;
}
function shown(cell: SepCell | undefined) { return cell?.valueDisplayLocal ?? cell?.valueDisplay ?? cell?.value ?? ""; }

// This is the same read-only flow used by SEP's public application. No registration calls.
export async function exportSepExcel(transport: Transport, pib: string, jmbg: string, from: string, to: string) {
  if (!/^\d{8}$/.test(pib) || !/^\d{13}$/.test(jmbg)) throw new SepError("INVALID_IDENTIFIERS");
  const period = sepPeriod(from, to);
  if (await transport("/eficg/api/checkIfCertificateExists", {}, { form: true }) !== true) throw new SepError("CERTIFICATE_NOT_REGISTERED");
  if (await transport("/eficg/api/checkIfTaxpayerExists", { pib }, { form: true }) !== true) throw new SepError("TAXPAYER_NOT_REGISTERED");
  if (await transport("/eficg/api/checkIfAuthorizedRepresentative", { pib, JMBG: jmbg }, { form: true }) !== true) throw new SepError("NOT_AUTHORIZED");
  await transport("/kickstart/login", { username: pib, password: null });
  const payload = (page: number) => ({
    entityEnum: "INVOICES_FIS", masterEntityEnum: null, masterTablePkColumnValue: null,
    page, perPage: 10, sortParams: null, filterColumnDataList: period.filters,
    filterAllValue: null, exactFilter: null, redirectedEntityPk: null,
  });
  const table = tableResponse(await transport("/eficg/api/tables", payload(1)));
  const total = Number(table.rowCount), rows = [...table.tableRows];
  const seen = new Set(rows.map(rowKey));
  if (seen.size !== rows.length) throw new SepError("PAGINATION_INCONSISTENT");
  let page = 1;
  while (rows.length < total) {
    const next = tableResponse(await transport("/eficg/api/tables", payload(++page)));
    if (Number(next.rowCount) !== total) throw new SepError("TABLE_CHANGED_RETRY");
    if (!next.tableRows.length) throw new SepError("PAGINATION_INCONSISTENT");
    for (const row of next.tableRows) {
      const id = rowKey(row);
      if (seen.has(id)) throw new SepError("PAGINATION_INCONSISTENT");
      seen.add(id); rows.push(row);
    }
  }
  if (rows.length !== total) throw new SepError("ROW_COUNT_MISMATCH");
  for (const row of rows) {
    const date = String(shown(row.tableRowCells.find(cell => cell.columnName === "IVS_FISCAL_DATE"))).slice(0, 10);
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) throw new SepError("UNVERIFIED_FISCAL_DATE");
    const time = sepDate(`${date.slice(6)}-${date.slice(3, 5)}-${date.slice(0, 2)}`).time;
    if (time < period.start.time || time > period.end.time) throw new SepError("SEP_FILTER_NOT_APPLIED");
  }
  const dictionary = await transport("/kickstart/api/getI18n", null, { get: true }) as { locales?: { ME?: Record<string, string> } };
  const locale = dictionary?.locales?.ME ?? {};
  const columns = table.tableColumns.filter(column => !column.viewDisabled);
  if (!columns.length) throw new SepError("MISSING_EXPORT_COLUMNS");
  const label = (name: string) => locale[`INVOICES_FIS.${name}`] ?? name;
  let excel: Buffer;
  if (table.exportExcelFromBackend) {
    const response = await transport("/eficg/api/getExcel", {
      ...payload(1), page: null, perPage: null,
      visibleColumnNameTranslations: columns.map(column => ({ name: column.columnName, value: label(column.columnName), exactFilter: false })),
    }, { binary: true });
    if (!Buffer.isBuffer(response) || response[0] !== 0x50 || response[1] !== 0x4b) throw new SepError("INVALID_EXCEL_RESPONSE");
    excel = response;
    // Validate backend export count against the filtered table before returning it.
    const book = XLSX.read(excel, { type: "buffer" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const exported = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) : [];
    if (exported.length !== total + 1) throw new SepError("EXCEL_ROW_COUNT_MISMATCH");
  } else {
    const values = rows.map(row => columns.map(column => {
      const value = shown(row.tableRowCells.find(cell => cell.columnName === column.columnName));
      return typeof value === "string" ? locale[value] ?? value : value;
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns.map(column => label(column.columnName)), ...values]), "data");
    excel = XLSX.write(book, { bookType: "xlsx", type: "buffer" });
  }
  return { excel, count: total };
}

export async function downloadSepExcel(credentials: SepCredentials, pib: string, from: string, to: string) {
  sepPeriod(from, to);
  const pfx = Buffer.from(credentials.pfx, "base64");
  const agent = new https.Agent({ pfx, passphrase: credentials.password, keepAlive: true, maxSockets: 1 });
  let token = "";
  const cookies = new Map<string, string>();
  const deadline = Date.now() + 120000;
  const transport: Transport = (path, data, options = {}) => new Promise((resolve, reject) => {
    if (Date.now() >= deadline) { reject(new SepError("TIMEOUT")); return; }
    const body = options.get ? "" : options.form ? new URLSearchParams(data as Record<string, string>).toString() : JSON.stringify(data);
    const request = https.request({
      hostname: "sep.tax.gov.me", port: 443, path, method: options.get ? "GET" : "POST", agent,
      headers: {
        ...(path.startsWith("/kickstart/") ? { schema: "CPCM" } : { lang: "ME" }),
        Accept: "application/json", "Content-Type": options.form ? "application/x-www-form-urlencoded" : "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      },
    }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new SepError(`HTTP_${response.statusCode}`)); return; }
      if (!options.binary && !response.headers["content-type"]?.includes("json")) { response.resume(); reject(new SepError("EXPECTED_JSON")); return; }
      for (const cookie of response.headers["set-cookie"] ?? []) {
        const pair = cookie.split(";", 1)[0], split = pair.indexOf("=");
        if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) response.destroy(new SepError("RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      response.on("error", () => reject(new SepError("NETWORK_ERROR")));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        if (options.binary) { resolve(bytes); return; }
        try {
          const result = JSON.parse(bytes.toString("utf8"));
          if (path === "/kickstart/login") {
            if (!result?.user || typeof result.token !== "string" || !result.token) throw new SepError("LOGIN_FAILED");
            token = result.token;
          }
          resolve(result);
        } catch (error) { reject(error instanceof SepError ? error : new SepError("INVALID_JSON")); }
      });
    });
    const timer = setTimeout(() => request.destroy(new SepError("TIMEOUT")), Math.min(30000, deadline - Date.now()));
    request.on("close", () => clearTimeout(timer));
    request.on("error", error => reject(error instanceof SepError ? error : new SepError("NETWORK_ERROR")));
    request.end(body);
  });
  try {
    await transport("/kickstart/login", { username: null, password: null });
    return await exportSepExcel(transport, pib, credentials.jmbg, from, to);
  } finally { agent.destroy(); pfx.fill(0); token = ""; cookies.clear(); }
}
