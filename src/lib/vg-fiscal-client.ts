import "server-only";
import * as XLSX from "xlsx";
import { PazarImportError, reportCents, type PazarDevice, type PazarReport } from "./pazar-import-policy";

const origin = "https://fis.fiskalizacija.me";
function decode(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, match => {
    const known: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (known[match]) return known[match];
    const n = match.startsWith("&#x") ? parseInt(match.slice(3), 16) : parseInt(match.slice(2), 10);
    return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}
const text = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
function attribute(attrs: string, name: string) {
  return decode(new RegExp(`\\b${name}=["']([^"']*)`, "i").exec(attrs)?.[1] ?? "");
}
export function vgDevices(html: string): PazarDevice[] {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)].find(m => attribute(m[1], "name") === "serial");
  const devices = select ? [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(m => ({ id: attribute(m[1], "value"), label: text(m[2]) })) : [];
  if (!devices.length || devices.length > 100 || devices.some(d => !/^[\w-]{1,100}$/.test(d.id) || !d.label)) throw new PazarImportError("VG nije vratio prepoznatljivu listu kasa. Provjerite pristup portalu.");
  return devices;
}
async function limitedBody(response: Response, limit: number) {
  if (Number(response.headers.get("content-length")) > limit) throw new PazarImportError("VG odgovor je prevelik.");
  const reader = response.body?.getReader(); if (!reader) throw new PazarImportError("VG odgovor je prazan.");
  const buffers: Buffer[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > limit) throw new PazarImportError("VG odgovor je prevelik."); buffers.push(Buffer.from(item.value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(buffers);
}
export class VgFiscalClient {
  private cookies = new Map<string, string>();
  private deadline = Date.now() + 90000;
  constructor(private transport: typeof fetch = fetch) {}
  private async request(path: string, options: RequestInit = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin || !["/me/user/login", "/me/receipt/list", "/me/receipt/export"].includes(url.pathname)) throw new PazarImportError("Neočekivana adresa VG portala.");
    const remaining = Math.min(30000, this.deadline - Date.now()); if (remaining <= 0) throw new PazarImportError("VG preuzimanje je isteklo. Pokušajte ponovo.");
    const headers = new Headers(options.headers);
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    try {
      const response = await this.transport(url.toString(), { ...options, headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(remaining) });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
      return response;
    } catch { throw new PazarImportError("VG portal trenutno nije dostupan ili je preuzimanje isteklo."); }
  }
  async login(username: string, password: string) {
    const page = await this.request("/me/user/login");
    const html = (await limitedBody(page, 2 * 1024 * 1024)).toString("utf8");
    const input = [...html.matchAll(/<input\b([^>]*)>/gi)].find(m => attribute(m[1], "name") === "csrft");
    const csrf = input ? attribute(input[1], "value") : "";
    if (!page.ok || !csrf) throw new PazarImportError("VG prijavna stranica nije dostupna u očekivanom obliku.");
    const response = await this.request("/me/user/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Referer: `${origin}/me/user/login` }, body: new URLSearchParams({ username, password, csrft: csrf }) });
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (response.status !== 302 || !location || new URL(location, origin).origin !== origin || !["/me/device/list", "/me/receipt/list"].includes(new URL(location, origin).pathname)) throw new PazarImportError("VG prijava nije uspjela. Provjerite korisničko ime i lozinku; dodatna potvrda prijave može zahtijevati ručni pristup.");
  }
  async devices() {
    const response = await this.request("/me/receipt/list");
    if (!response.ok) { await response.body?.cancel(); throw new PazarImportError("VG sesija je istekla ili lista kasa nije dostupna."); }
    return vgDevices((await limitedBody(response, 2 * 1024 * 1024)).toString("utf8"));
  }
  async report(device: PazarDevice, from: string, to: string) {
    const query = new URLSearchParams({ serial: device.id, issued_at_range: "custom", issued_at_from: from, issued_at_to: to });
    const page = await this.request(`/me/receipt/list?${query}`);
    if (!page.ok) throw new PazarImportError("VG lista računa nije dostupna.");
    const html = (await limitedBody(page, 2 * 1024 * 1024)).toString("utf8");
    const link = [...html.matchAll(/<a\b([^>]*)>/gi)].map(m => attribute(m[1], "href")).find(href => { try { const url = new URL(href, origin); return url.pathname === "/me/receipt/export" && url.searchParams.get("type") === "summaryPeriodical"; } catch { return false; } });
    if (!link) throw new PazarImportError("VG nije vratio periodični fiskalni izvještaj.");
    const target = new URL(link, origin);
    if (target.origin !== origin || target.searchParams.get("serial") !== device.id || target.searchParams.get("issued_at_from") !== from || target.searchParams.get("issued_at_to") !== to) throw new PazarImportError("VG izvoz ne odgovara izabranoj kasi i periodu.");
    const response = await this.request(target.toString());
    if (!response.ok) throw new PazarImportError("VG izvoz izvještaja nije uspio.");
    const bytes = await limitedBody(response, 8 * 1024 * 1024);
    if (bytes.subarray(0, 2).toString() !== "PK") throw new PazarImportError("VG nije vratio Excel izvještaj. Provjerite prijavu.");
    return { bytes, report: parseVgReport(bytes, device) };
  }
  close() { this.cookies.clear(); }
}
export function parseVgReport(bytes: Buffer, device: PazarDevice): PazarReport {
  let rows: unknown[][];
  try { const book = XLSX.read(bytes, { type: "buffer", sheetRows: 250 }); rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" }); }
  catch { throw new PazarImportError("VG Excel nije moguće pročitati."); }
  const label = (r: unknown[]) => String(r[0] ?? "").trim();
  if (!rows.some(r => label(r) === "PERIODIČNI FISKALNI IZVJEŠTAJ")) throw new PazarImportError("Fajl nije VG periodični fiskalni izvještaj.");
  const pib = rows.flat().map(v => /\bPIB\s*:?\s*(\d{8})\b/i.exec(String(v))?.[1]).find(Boolean) ?? "";
  const period = String(rows.find(r => label(r) === "Za period")?.[1] ?? "").match(/(\d{2})\.(\d{2})\.(\d{4})\.?\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!pib || !period) throw new PazarImportError("VG izvještaju nedostaje PIB ili period.");
  const taxes = rows.filter(r => /^Poreska stopa\s+[\d.,]+%$/.test(label(r))).map(r => {
    const base = reportCents(r[1]), vat = reportCents(r[2]);
    if (base + vat !== reportCents(r[3])) throw new PazarImportError("Poreski red VG izvještaja nije izbalansiran.");
    return { rate: /([\d.,]+)%/.exec(label(r))![1].replace(",", "."), base, vat };
  });
  if (!taxes.length) throw new PazarImportError("VG izvještaju nedostaje poreska razrada.");
  const totalRow = rows.find(r => /^Ukupno \(/.test(label(r)));
  if (!totalRow || reportCents(totalRow[1]) !== taxes.reduce((s,t) => s + t.base,0) || reportCents(totalRow[2]) !== taxes.reduce((s,t) => s + t.vat,0) || reportCents(totalRow[3]) !== taxes.reduce((s,t) => s + t.base + t.vat,0)) throw new PazarImportError("Ukupan promet VG izvještaja ne odgovara poreskoj razradi.");
  const exempt = rows.find(r => label(r) === "Oslobođeni promet");
  if (exempt && reportCents(exempt[3]) !== 0) { let zero = taxes.find(t => Number(t.rate) === 0); if (!zero) { zero = { rate: "0", base: 0, vat: 0 }; taxes.push(zero); } zero.base += reportCents(exempt[3]); }
  const amounts = new Map<string, number>();
  const mapping: Record<string, string> = { BANKNOTE: "CASH", CARD: "CARD", BUSINESSCARD: "CARD", ACCOUNT: "TRANSFER", SVOUCHER: "OTHER", COMPANY: "OTHER", ORDER: "OTHER", ADVANCE: "OTHER", OTHERCASH: "OTHER", FACTORING: "OTHER", OTHER: "OTHER" };
  let paymentsSection = false, paymentRows = 0;
  for (const row of rows) {
    const name = label(row);
    if (name === "Vrijednost prometa iskazana po načinu plaćanja") { paymentsSection = true; continue; }
    if (paymentsSection && name === "Kalkulacija gotovine") break;
    if (!paymentsSection) continue;
    const method = /^([A-Z]+)\s*\(/.exec(name)?.[1];
    if (method) { if (!mapping[method]) throw new PazarImportError("VG izvještaj sadrži nepoznat način naplate."); paymentRows++; amounts.set(mapping[method], (amounts.get(mapping[method]) ?? 0) + reportCents(row[1])); }
  }
  if (!paymentRows) throw new PazarImportError("VG izvještaju nedostaje razrada naplate.");
  const total = taxes.reduce((sum, t) => sum + t.base + t.vat, 0);
  return { pib, from: `${period[3]}-${period[2]}-${period[1]}`, to: `${period[6]}-${period[5]}-${period[4]}`, device, taxes, total, payments: [...amounts].map(([method, amount]) => ({ method, amount })) };
}
