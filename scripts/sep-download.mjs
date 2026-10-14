// Experimental read-only SEP client, based on public main.1958f5eb9b6dab4f335f.js.
// No registration, fiscalization or accounting writes. No persisted sessions.
import https from 'node:https';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createSecureContext } from 'node:tls';
import { readPassword } from './sep-probe.mjs';
import XLSX from 'xlsx';

function parseDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value ?? '');
  if (!match) throw new Error('DATE_FORMAT_DD_MM_YYYY');
  const [, day, month, year] = match;
  const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (new Date(stamp).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) throw new Error('INVALID_DATE');
  return stamp;
}

let stage = 'ucitavanje sertifikata';
async function main() {
  if (!process.argv[2]) throw new Error('MISSING_PFX_PATH');
  const from = process.argv[3];
  const to = process.argv[4];
  if (!from || !to) throw new Error('PROVIDE_FROM_AND_TO_DD_MM_YYYY');
  const start = parseDate(from);
  const end = parseDate(to);
  if (start > end) throw new Error('DATE_RANGE_REVERSED');
  const filters = [{ name: 'IVS_FISCAL_DATE', value: `${from}-${to}`, valueList: null, exactFilter: false }];
  const pfx = await readFile(process.argv[2]);
  let passphrase = '';
  let token = '';
  const cookies = new Map();
  let agent;
  async function post(path, data, form = false, binary = false, method = 'POST') {
    const body = method === 'GET' ? '' : form ? new URLSearchParams(data).toString() : JSON.stringify(data);
    return new Promise((resolveResponse, reject) => {
      const request = https.request({
        hostname: 'sep.tax.gov.me', port: 443, path, method, agent,
        headers: {
          ...(path.startsWith('/kickstart/') ? { schema: 'CPCM' } : { lang: 'ME' }),
          Accept: 'application/json',
          'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cookies.size ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        },
      }, (response) => {
        // No redirects: never forward the key, identifiers or token to another host.
        if (response.statusCode !== 200) {
          response.resume(); reject(new Error(`HTTP_${response.statusCode}`)); return;
        }
        if (!binary && !response.headers['content-type']?.includes('json')) {
          response.resume(); reject(new Error('EXPECTED_JSON')); return;
        }
        for (const cookie of response.headers['set-cookie'] ?? []) {
          const pair = cookie.split(';', 1)[0];
          const index = pair.indexOf('=');
          if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) response.destroy(new Error('RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          if (binary) { resolveResponse(Buffer.concat(chunks)); return; }
          try { resolveResponse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new Error('INVALID_JSON')); }
        });
      });
      request.setTimeout(30000, () => request.destroy(new Error('TIMEOUT')));
      request.on('error', reject);
      request.end(body);
    });
  }
  try {
    passphrase = await readPassword();
    createSecureContext({ pfx, passphrase });
    agent = new https.Agent({ pfx, passphrase, keepAlive: true, maxSockets: 1 });
    stage = 'prijava sertifikatom';
    const initial = await post('/kickstart/login', { username: null, password: null });
    if (!initial?.user || typeof initial.token !== 'string' || !initial.token) throw new Error('CERTIFICATE_LOGIN_FAILED');
    token = initial.token;
    console.log('SEP je vratio korisnika i sesiju za sertifikat.');
    stage = 'provjera registracije sertifikata';
    if (await post('/eficg/api/checkIfCertificateExists', {}, true) !== true) {
      throw new Error('CERTIFICATE_NOT_REGISTERED_USE_SEP_BROWSER');
    }
    console.log('Sertifikat je vec registrovan; ime oca nije potrebno u ovom toku.');
    stage = 'lokalni unos PIB-a i JMBG-a';
    async function readIdentifier(label, length) {
      for (;;) {
        const value = (await readPassword(`${label} (skriven unos): `)).trim();
        if (new RegExp(`^\\d{${length}}$`).test(value)) return value;
        console.log(`${label} mora imati tacno ${length} cifara, bez razmaka i crtica. Uneseno znakova: ${value.length}. Ponovi unos.`);
      }
    }
    const pib = await readIdentifier('PIB probne ovlascene firme', 8);
    const jmbg = await readIdentifier('Tvoj JMBG', 13);
    stage = 'provjera firme';
    if (await post('/eficg/api/checkIfTaxpayerExists', { pib }, true) !== true) throw new Error('TAXPAYER_NOT_REGISTERED');
    stage = 'provjera ovlascenja';
    if (await post('/eficg/api/checkIfAuthorizedRepresentative', { pib, JMBG: jmbg }, true) !== true) throw new Error('NOT_AUTHORIZED');
    stage = 'prijava za izabranu firmu';
    const company = await post('/kickstart/login', { username: pib, password: null });
    if (!company?.user || typeof company.token !== 'string' || !company.token) throw new Error('COMPANY_LOGIN_FAILED');
    token = company.token;
    console.log(`Prijava za ovlascenu firmu je prosla. Period fiskalizacije: ${from} - ${to}.`);
    stage = 'preuzimanje racuna';
    const data = await post('/eficg/api/tables', {
      entityEnum: 'INVOICES_FIS', masterEntityEnum: null, masterTablePkColumnValue: null,
      page: 1, perPage: 10, sortParams: null, filterColumnDataList: filters,
      filterAllValue: null, exactFilter: null, redirectedEntityPk: null,
    });
    if (!Array.isArray(data) || data.length !== 1 || !Array.isArray(data[0].tableRows)) throw new Error('UNKNOWN_TABLE_FORMAT');
    const table = data[0];
    const total = Number(table.rowCount);
    if (!Number.isSafeInteger(total) || total < 0 || total > 10000) throw new Error('INVALID_OR_EXCESSIVE_ROW_COUNT');
    console.log(`SEP je pronasao ${total} racuna u izabranom periodu.`);
    const rows = [...table.tableRows];
    const seen = new Set(rows.map(row => JSON.stringify(row)));
    let page = 1;
    while (rows.length < total) {
      const next = await post('/eficg/api/tables', {
        entityEnum: 'INVOICES_FIS', masterEntityEnum: null, masterTablePkColumnValue: null,
        page: ++page, perPage: 10, sortParams: null, filterColumnDataList: filters,
        filterAllValue: null, exactFilter: null, redirectedEntityPk: null,
      });
      if (!Array.isArray(next?.[0]?.tableRows) || Number(next[0].rowCount) !== total) throw new Error('TABLE_CHANGED_RETRY');
      const incoming = next[0].tableRows;
      if (!incoming.length || incoming.some(row => seen.has(JSON.stringify(row)))) throw new Error('PAGINATION_INCONSISTENT');
      for (const row of incoming) { rows.push(row); seen.add(JSON.stringify(row)); }
    }
    if (rows.length !== total) throw new Error('ROW_COUNT_MISMATCH');
    // Reject an ignored fiscal-date filter before generating a misleading export.
    for (const row of rows) {
      const cell = row.tableRowCells?.find(cell => cell.columnName === 'IVS_FISCAL_DATE');
      const shown = cell?.valueDisplayLocal ?? cell?.valueDisplay ?? cell?.value;
      const day = typeof shown === 'string' ? shown.slice(0, 10) : '';
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(day)) throw new Error('UNVERIFIED_FISCAL_DATE');
      const stamp = parseDate(day);
      if (stamp < start || stamp > end) throw new Error('SEP_FILTER_NOT_APPLIED');
    }
    const invoices = rows.map(row => {
      if (!Array.isArray(row.tableRowCells)) throw new Error('UNKNOWN_ROW_FORMAT');
      return row.tableRowCells.map(cell => ({
        columnName: cell.columnName, value: cell.value, valueDisplay: cell.valueDisplay,
        valueDisplayLocal: cell.valueDisplayLocal, valueDisplayEng: cell.valueDisplayEng,
      }));
    });
    stage = 'lokalno cuvanje pregleda';
    const folder = resolve(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'sep-probe');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const basename = `sep-invoices-${from}-${to}-${Date.now()}`;
    const output = join(folder, `${basename}.json`);
    await writeFile(output, JSON.stringify({
      source: 'SEP', pib, retrievedAt: new Date().toISOString(),
      period: { from, to, field: 'IVS_FISCAL_DATE' }, rowCount: total, invoices,
    }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Preuzeto racuna: ${total}. Fajl: ${output}`);
    stage = 'Excel izvoz';
    const columns = table.tableColumns?.filter(column => !column.viewDisabled) ?? [];
    if (!columns.length) throw new Error('MISSING_EXPORT_COLUMNS');
    // Preserve portal labels by using the same translation dictionary as its UI.
    const dictionary = await post('/kickstart/api/getI18n', null, false, false, 'GET');
    const locale = dictionary?.locales?.ME ?? {};
    const label = column => locale[`INVOICES_FIS.${column.columnName}`] ?? column.columnName;
    let excel;
    if (table.exportExcelFromBackend) {
      excel = await post('/eficg/api/getExcel', {
        entityEnum: 'INVOICES_FIS', masterEntityEnum: null, masterTablePkColumnValue: null,
        page: null, perPage: null, sortParams: null, filterColumnDataList: filters,
        filterAllValue: null,
        visibleColumnNameTranslations: columns.map(column => ({ name: column.columnName, value: label(column), exactFilter: false })),
      }, false, true);
      if (excel[0] !== 0x50 || excel[1] !== 0x4b) throw new Error('INVALID_EXCEL_RESPONSE');
    } else {
      // SEP also supports client-side XLSX generation from the full filtered table.
      const header = columns.map(label);
      const values = rows.map(row => columns.map(column => {
        const cell = row.tableRowCells.find(cell => cell.columnName === column.columnName);
        const value = cell?.valueDisplayLocal ?? cell?.valueDisplay ?? cell?.value ?? '';
        return typeof value === 'string' && locale[value] ? locale[value] : value;
      }));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([header, ...values]);
      XLSX.utils.book_append_sheet(workbook, sheet, 'data');
      excel = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    }
    const workbook = XLSX.read(excel, { type: 'buffer' });
    if (!workbook.SheetNames.length) throw new Error('EMPTY_EXCEL_WORKBOOK');
    const excelOutput = join(folder, `${basename}.xlsx`);
    await writeFile(excelOutput, excel, { flag: 'wx', mode: 0o600 });
    console.log(`Excel: ${excelOutput}`);
    console.log('Ovo je tabelarni pregled, ne kompletne stavke racuna. Nista nije upisano u knjigovodstvo.');
  } finally {
    agent?.destroy(); pfx.fill(0); passphrase = ''; token = ''; cookies.clear();
  }
}
main().catch(error => {
  const safeCode = /^[A-Z0-9_]+$/.test(error.message ?? '') ? error.message : error.code ?? 'REQUEST_FAILED';
  console.error(`SEP proba nije uspjela. Korak: ${stage}. Kod: ${safeCode}`);
  process.exitCode = 1;
});
