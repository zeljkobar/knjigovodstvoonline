import "server-only";
import { SepError, type SepEnvironment, type SepTransport } from "./sep-transport";
import { isValidFiscalTcrCode } from "./fiscal-production-enu";
import { SUMMA_FISCAL_SOFTWARE } from "./fiscal-setup";

export type SepIdentity = { name?: string; shortName?: string; address?: string; town?: string; vat?: boolean };
export type SepUnit = { code: string; name: string; address?: string; town?: string };
export type SepOperator = { code: string; firstName?: string; lastName?: string };
export type SepSoftware = { name?: string; version?: string; code?: string; producer?: string; maintainer?: string; certified?: boolean };
export type SepDevice = { code: string; label: string; unitCode: string; software: SepSoftware };
export type SepFiscalSnapshot = {
  identity: SepIdentity; units: SepUnit[]; operators: SepOperator[]; devices: SepDevice[]; warnings: string[];
};
export type SepFiscalResult = { data: SepFiscalSnapshot } | { error: string };
export type SepFiscalResults = { test: SepFiscalResult; production: SepFiscalResult };

type ObjectData = Record<string, unknown>;
type Locale = ObjectData;
type TableRow = { id: string | undefined; cells: ObjectData[] };
const asObject = (value: unknown): ObjectData => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectData : {};
const clean = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 250) || undefined : undefined;
const normalized = (value: unknown) => (clean(value) ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
const idValue = (value: unknown) => /^[1-9]\d{0,15}$/.test(String(value)) ? String(value) : undefined;
const codeValue = (value: unknown) => typeof value === "string" && isValidFiscalTcrCode(value) ? value : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function rowData(value: unknown): TableRow {
  const item = asObject(value);
  if (!Array.isArray(item.tableRowCells)) throw new SepError("UNKNOWN_TABLE_FORMAT");
  return { id: idValue(item.origId), cells: item.tableRowCells.map(asObject) };
}

function readCells(row: TableRow, locale: Locale, ...entities: string[]) {
  const find = (...names: string[]) => {
    const keys = new Set(names.map(normalized));
    return row.cells.find(cell => keys.has(normalized(cell.columnName))) ?? row.cells.find(cell => {
      const field = clean(cell.columnName);
      return field && [...entities.map(entity => locale[`${entity}.${field}`]), locale[field]].some(label => keys.has(normalized(label)));
    });
  };
  const shown = (...names: string[]) => {
    const cell = find(...names);
    for (const value of [cell?.valueDisplayLocal, cell?.valueDisplay, cell?.value]) {
      const resolved = clean(typeof value === "string" ? locale[value] ?? value : value);
      if (resolved && !["-", "—"].includes(resolved)) return resolved;
    }
  };
  const bool = (...names: string[]) => {
    const raw = find(...names)?.value;
    if (typeof raw === "boolean") return raw;
    const val = normalized(shown(...names));
    return ["da", "true", "yes"].includes(val) ? true : ["ne", "false", "no"].includes(val) ? false : undefined;
  };
  const code = (...names: string[]) => codeValue(shown(...names)) ?? codeValue(find(...names)?.value);
  return { find, shown, bool, code };
}

function sepDateText(value?: string) {
  if (!value) return undefined;
  const date = /^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/.exec(value);
  return date ? `${date[3]}-${date[2].padStart(2, "0")}-${date[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
}

function current(r: ReturnType<typeof readCells>) {
  const state = normalized(r.shown("Status"));
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Podgorica" }).format();
  const from = sepDateText(r.shown("Važi od"));
  const to = sepDateText(r.shown("Važi do"));
  return !["zatvorena", "zatvoren", "neaktivna", "neaktivan", "inactive", "closed"].includes(state) &&
    r.bool("Aktivan", "Aktivna") !== false && (!from || from <= today) && (!to || to >= today);
}

async function getRow(transport: SepTransport, entity: string, id: string) {
  const raw = await transport("/eficg/api/tableRows", { entityEnum: entity, itemId: id, redirectedEntityPk: "null" }, { form: true });
  return rowData(raw);
}

async function getList(transport: SepTransport, entity: string, max: number, parent?: { entity: string; id: string }) {
  const paginated: TableRow[] = [];
  for (let page = 1; paginated.length < max; page++) {
    const raw = await transport("/eficg/api/tables", {
      entityEnum: entity, masterEntityEnum: parent?.entity ?? null, masterTablePkColumnValue: parent?.id ?? null,
      page, perPage: 10, sortParams: null, filterColumnDataList: null, filterAllValue: null, exactFilter: null, redirectedEntityPk: null,
    });
    if (!Array.isArray(raw) || raw.length !== 1) throw new SepError("UNKNOWN_TABLE_FORMAT");
    const table = asObject(raw[0]);
    const total = Number(table.rowCount);
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(table.tableRows)) throw new SepError("UNKNOWN_TABLE_FORMAT");
    const rows = table.tableRows.map(rowData);
    if (!rows.length && paginated.length < total) throw new SepError("UNKNOWN_TABLE_FORMAT");
    paginated.push(...rows);
    if (paginated.length >= Math.min(total, max)) return { rows: paginated.slice(0, max), limited: total > max };
  }
  return { rows: paginated, limited: true };
}

async function getOperatorEntity(transport: SepTransport, locale: Locale) {
  try {
    const modules = list(await transport("/eficg/api/moduls", null));
    for (const item of modules) for (const entry of [item, ...list(asObject(item).modulEntities)]) {
      const code = clean(asObject(entry).code);
      if (code && /^[A-Z_]+$/.test(code) && /(?:^|_)OPERATORS?$/.test(code)) return code;
      if (code && /^[A-Z_]+$/.test(code) &&
        [locale[code], locale[`ENTITY.${code}`], locale[`ENTITIES.${code}`]].some(label => normalized(label) === "operateri")) return code;
    }
  } catch { /* Try the standard entity when the menu is unavailable. */ }
  return "OPERATORS";
}

function ownSoftware(name: unknown) {
  return ["summafiscalapi", "summasummarumfiscalapi"].includes(normalized(name));
}

type DeviceUnits = { byId: Map<string, string>; codes: Set<string> };

function deviceUnit(row: TableRow, fields: ReturnType<typeof readCells>) {
  const link = row.cells.find(cell => cell.linkEntityName === "BUSINESS_UNITS");
  return {
    id: idValue(link?.value) ?? idValue(fields.find("Poslovna jedinica", "Business unit", "BU_ID")?.value),
    code: fields.code("Kod poslovne jedinice", "BU_CODE") ?? fields.code("Poslovna jedinica"),
  };
}

async function readDevice(
  transport: SepTransport, row: TableRow, locale: Locale, environment: SepEnvironment, units: DeviceUnits, parentCode?: string,
) {
  const entity = "CASH_REGISTERS";
  const columns = readCells(row, locale, ...(parentCode ? ["CASH_REGISTERS_TAB", entity] : [entity]));
  let detail = row;
  let fields = columns;
  if (row.id) {
    try {
      detail = await getRow(transport, entity, row.id);
      fields = readCells(detail, locale, entity);
    } catch { /* The list may already contain the needed fields. */ }
  }
  const code = fields.code("Kod", "TCR_CODE") ?? columns.code("Kod", "TCR_CODE");
  const label = fields.shown("Interna oznaka ENU", "Interna oznaka ENU-a", "ENU interna oznaka") ??
    columns.shown("Interna oznaka ENU", "Interna oznaka ENU-a", "ENU interna oznaka");
  const name = fields.shown("Softver", "Naziv softvera") ?? columns.shown("Softver", "Naziv softvera");
  const softwareFields = ["Kod softvera", "Kod verzije softvera", "SOFTWARE_CODE", "SW_CODE"];
  const softwareCode = fields.code(...softwareFields) ?? columns.code(...softwareFields);
  const otherEnvironment = environment === "test" ? "production" : "test";
  const isOwnSoftware = softwareCode === SUMMA_FISCAL_SOFTWARE[environment].softwareCode ||
    (softwareCode !== SUMMA_FISCAL_SOFTWARE[otherEnvironment].softwareCode && ownSoftware(name));
  if (!code || !label || !isOwnSoftware || !current(fields) || !current(columns)) return null;

  const detailUnit = deviceUnit(detail, fields);
  const listUnit = deviceUnit(row, columns);
  const unitId = detailUnit.id ?? listUnit.id;
  const reportedCode = detailUnit.code ?? listUnit.code;
  const linkedUnitCode = unitId ? units.byId.get(unitId) : undefined;
  if ((detailUnit.id && listUnit.id && detailUnit.id !== listUnit.id) ||
      (detailUnit.code && listUnit.code && detailUnit.code !== listUnit.code) ||
      (linkedUnitCode && reportedCode && linkedUnitCode !== reportedCode) ||
      (parentCode && ((linkedUnitCode && parentCode !== linkedUnitCode) || (reportedCode && parentCode !== reportedCode)))) return null;
  const unitCode = parentCode ?? (unitId && units.byId.size === units.codes.size
    ? linkedUnitCode
    : linkedUnitCode ?? reportedCode);
  if (!unitCode || !units.codes.has(unitCode)) return null;
  const linkedCode = async (entityName: string, ...names: string[]) => {
    const link = fields.find(...names);
    const id = idValue(link?.value);
    if (link?.linkEntityName !== entityName || !id) return undefined;
    try { return readCells(await getRow(transport, entityName, id), locale, entityName).code("Kod"); }
    catch { return undefined; }
  };
  const [producer, maintainer] = await Promise.all([
    fields.code("Kod proizvođača") ?? linkedCode("SPECIAL_CATALOGUE_PRODUCERS", "Proizvođač", "Proizvođač softvera"),
    fields.code("Kod održavaoca") ?? linkedCode("SPECIAL_CATALOGUE_MAINTAINERS", "Održavalac", "Održavaoc", "Održavalac softvera"),
  ]);
  return { code, label, unitCode, software: {
    name, version: fields.shown("Verzija softvera") ?? columns.shown("Verzija softvera"), code: softwareCode,
    producer, maintainer, certified: fields.bool("Sertifikovano", "Certifikovano", "Softver je sertifikovan"),
  } } satisfies SepDevice;
}

export async function readSepFiscalSnapshot(transport: SepTransport, pib: string, environment: SepEnvironment): Promise<SepFiscalSnapshot> {
  if (!/^\d{8}$/.test(pib)) throw new SepError("INVALID_IDENTIFIERS");
  const login = asObject(await transport("/kickstart/login", { username: null, password: null }));
  // SEP picks the taxpayer from the certificate. Verify the taxpayer record, not the login name.
  const companyId = idValue(asObject(login.user).ptyId);
  if (!companyId) throw new SepError("COMPANY_CONTEXT_REQUIRED");
  const [identityRow, dictionary] = await Promise.all([
    getRow(transport, "TAXPAYERS", companyId),
    transport("/kickstart/api/getI18n", null, { get: true }).catch(() => null),
  ]);
  const locale = asObject(asObject(asObject(dictionary).locales).ME);
  const company = readCells(identityRow, locale, "TAXPAYERS");
  const actualPib = company.shown("PTY_TIN", "PIB") ?? company.shown("PTY_PIB");
  if (actualPib !== pib) throw new SepError("COMPANY_CONTEXT_REQUIRED");

  const warnings: string[] = [];
  if (!Object.keys(locale).length) warnings.push("SEP nije vratio nazive svih polja. Dio podataka možda nije prepoznat.");
  const [unitResponse, operatorResponse] = await Promise.allSettled([
    getList(transport, "BUSINESS_UNITS", 20),
    getOperatorEntity(transport, locale).then(async entity => ({ entity, ...await getList(transport, entity, 30) })),
  ]);
  const unitRows = unitResponse.status === "fulfilled" ? unitResponse.value.rows : [];
  const operatorRows = operatorResponse.status === "fulfilled" ? operatorResponse.value.rows : [];
  if (unitResponse.status === "rejected") warnings.push("SEP nije vratio poslovne jedinice.");
  else if (unitResponse.value.limited) warnings.push("Prikazano je prvih 20 poslovnih jedinica.");
  if (operatorResponse.status === "rejected") warnings.push("SEP nije vratio operatere.");
  else if (operatorResponse.value.limited) warnings.push("Prikazano je prvih 30 operatera.");

  const units: SepUnit[] = [];
  const deviceUnits: DeviceUnits = { byId: new Map(), codes: new Set() };
  const deviceLists: Array<Promise<{ unitCode: string; rows: TableRow[]; limited: boolean }>> = [];
  for (const row of unitRows) {
    const r = readCells(row, locale, "BUSINESS_UNITS");
    const code = r.code("Kod", "Kod poslovne jedinice", "BU_CODE");
    const name = r.shown("Naziv", "Naziv poslovne jedinice", "BU_NAME");
    if (!code || !name || !current(r)) continue;
    units.push({ code, name, address: r.shown("Adresa", "Ulica poslovne jedinice", "Ulica"), town: r.shown("Grad", "Naselje", "Opština") });
    deviceUnits.codes.add(code);
    if (row.id) deviceUnits.byId.set(row.id, code);
    // Tab requests carry the parent unit ID, as in the SEP detail screen.
    if (row.id) deviceLists.push(getList(transport, "CASH_REGISTERS_TAB", 10, { entity: "BUSINESS_UNITS", id: row.id })
      .then(result => ({ ...result, unitCode: code })));
  }
  const operators = operatorRows.flatMap(row => {
    const r = readCells(row, locale, operatorResponse.status === "fulfilled" ? operatorResponse.value.entity : "OPERATORS");
    const code = r.code("Kod", "Kod operatera", "OP_CODE");
    return code && current(r) ? [{ code, firstName: r.shown("Ime", "Ime operatera"), lastName: r.shown("Prezime", "Prezime operatera") }] : [];
  });
  const fetchedLists = await Promise.allSettled(deviceLists);
  const deviceRows = fetchedLists.flatMap(result => result.status === "fulfilled"
    ? result.value.rows.map(row => ({ row, unitCode: result.value.unitCode })) : []);
  if (fetchedLists.some(result => result.status === "rejected")) warnings.push("SEP nije vratio ENU uređaje za sve jedinice.");
  if (deviceRows.length > 40 || fetchedLists.some(result => result.status === "fulfilled" && result.value.limited)) warnings.push("Pregled ENU uređaja je ograničen na prvih 10 po jedinici i 40 ukupno.");
  const results = await Promise.all(deviceRows.slice(0, 40).map(({ row, unitCode }) =>
    readDevice(transport, row, locale, environment, deviceUnits, unitCode)));
  const matched = new Map<string, SepDevice>();
  for (const device of results) if (device) matched.set(device.code, device);

  let sawDeviceRows = deviceRows.length > 0;
  let readDeviceList = fetchedLists.some(result => result.status === "fulfilled");
  // The top-level list is also available under Moji podaci → ENU.
  if (!matched.size && units.length) {
    try {
      const registry = await getList(transport, "CASH_REGISTERS", 40);
      readDeviceList = true;
      sawDeviceRows ||= registry.rows.length > 0;
      if (registry.limited) warnings.push("Pregled opšteg spiska ENU uređaja je ograničen na prvih 40.");
      const fallback = await Promise.all(registry.rows.map(row => readDevice(transport, row, locale, environment, deviceUnits)));
      for (const device of fallback) if (device) matched.set(device.code, device);
    } catch {
      warnings.push("SEP nije vratio opšti spisak ENU uređaja.");
    }
  }
  const devices = [...matched.values()];
  if (!devices.length) {
    if (!units.length) warnings.push("Bez aktivne poslovne jedinice nije moguće povezati ENU. Kodove možete unijeti ručno.");
    else if (sawDeviceRows) warnings.push("SEP je vratio ENU uređaje, ali nijedan nije prepoznat kao važeći za Summa Fiscal i povezan s učitanom jedinicom. Kodove možete unijeti ručno.");
    else if (readDeviceList) warnings.push("SEP je vratio prazan spisak ENU uređaja. Kodove možete unijeti ručno.");
  }
  else if (devices.some(({ software }) => !software.code || !software.version || !software.producer || !software.maintainer || software.certified === undefined)) {
    warnings.push("SEP nije prikazao sve podatke o softveru za neke ENU uređaje.");
  }

  return { identity: {
    name: company.shown("Naziv", "Puni naziv", "Naziv poreskog obveznika", "PTY_NAME"),
    shortName: company.shown("Skraćeni naziv", "PTY_SHORT_NAME"),
    address: company.shown("Adresa", "Ulica", "Adresa poreskog obveznika"),
    town: company.shown("Naselje", "Grad", "Opština"),
    vat: company.bool("PDV obveznik"),
  }, units, operators, devices, warnings };
}
