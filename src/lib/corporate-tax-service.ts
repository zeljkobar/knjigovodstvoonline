import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentUser, isDirectFiscalTenantUser } from "./auth";
import { readWorkContext } from "./work-context";
import { auditLogInTransaction } from "./audit";
import { calculateIncomeStatement } from "./financial-reports";
import { taxAccountPrefill } from "./corporate-tax-accounts-service";
import { assertCorporateTaxYear, buildCorporateTaxXml, calculateCorporateTax, corporateTaxAccountingDepreciation, corporateTaxDepreciationFromSnapshot, corporateTaxResultFromStatement, corporateTaxRules, parseCorporateTaxInput, taxFail, type CorporateTaxInput } from "./corporate-tax";

type Actor = { userId: string; agencyId: string; companyId: string; yearId: string };
type Snapshot = { schema: 1; rules: string; inputs: CorporateTaxInput; amended: boolean };

async function actor(): Promise<Actor> {
  const user = await getCurrentUser(), context = await readWorkContext();
  if (!user || isDirectFiscalTenantUser(user) || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) taxFail("Prijavite se i izaberite firmu i poslovnu godinu.");
  return { userId: user.id, agencyId: user.agencija_id, companyId: context.firmaId, yearId: context.poslovnaGodinaId };
}

async function permission(tx: Prisma.TransactionClient, a: Actor, role: string, action: string, module = "zavrsni_racun") {
  return role === "admin_agencije" || Boolean(await tx.korisnikPravo.findFirst({ where: {
    korisnik_id: a.userId, agencija_id: a.agencyId, firma_id: a.companyId, modul: module, akcija: action, dozvoljeno: true
  } }));
}
async function context(tx: Prisma.TransactionClient, a: Actor, mode: "view" | "save" | "export") {
  const user = await tx.korisnik.findFirst({ where: { id: a.userId, agencija_id: a.agencyId, aktivan: true, is_deleted: false,
    rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false } } });
  if (!user) taxFail("Korisnik više nema pristup.");
  const year = await tx.poslovnaGodina.findFirst({ where: { id: a.yearId, firma_id: a.companyId, firma: {
    agencija_id: a.agencyId, aktivan: true, is_deleted: false,
    ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: a.userId, is_deleted: false } } })
  } }, include: { firma: { select: { id: true, naziv: true, pib: true, adresa: true, grad: true } } } });
  if (!year || !await permission(tx, a, user.rola, "view")) taxFail("Nemate pravo pregleda završnog računa ove firme.");
  assertCorporateTaxYear(year.godina);
  const saveAction = year.porez_dobit_podaci ? "update" : "create";
  const canSave = await permission(tx, a, user.rola, saveAction), canExport = await permission(tx, a, user.rola, "export"), canUpdate = await permission(tx, a, user.rola, "update");
  if (mode === "save" && (!canSave || year.zakljucena)) taxFail(year.zakljucena ? "Poslovna godina je zaključana." : "Nemate pravo čuvanja prijave.");
  if (mode === "export" && !canExport) taxFail("Nemate pravo izvoza završnog računa.");
  return { year, canSave: canSave && !year.zakljucena, canExport, canUpdate, role: user.rola };
}
function snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) taxFail("Sačuvajte prijavu prije izvoza.");
  const s = value as Snapshot;
  if (s.schema !== 1 || s.rules !== corporateTaxRules || typeof s.amended !== "boolean" || !s.inputs || typeof s.inputs !== "object" || Array.isArray(s.inputs)) taxFail("Sačuvana verzija obrasca nije podržana.");
  calculateCorporateTax(s.inputs);
  return s;
}
export async function loadCorporateTax() {
  const a = await actor();
  const data = await prisma.$transaction(async tx => {
    const { year, canSave, canExport, canUpdate, role } = await context(tx, a, "view");
    const saved = year.porez_dobit_podaci ? snapshot(year.porez_dobit_podaci) : null;
    const accountPrefill = await taxAccountPrefill(tx, a.agencyId, a.companyId, a.yearId, { from: year.datum_od, to: year.datum_do });
    const canReadTaxDepreciation = await permission(tx, a, role, "view", "osnovna_sredstva");
    const taxBatch = canReadTaxDepreciation ? await tx.osPoreskiObracun.findFirst({
      where: { agencija_id: a.agencyId, firma_id: a.companyId, poslovna_godina_id: a.yearId, status: "CONFIRMED" },
      orderBy: { revizija: "desc" }, select: { snapshot: true, revizija: true }
    }) : null;
    const taxDepreciation = taxBatch ? corporateTaxDepreciationFromSnapshot(taxBatch.snapshot, year.datum_od.toISOString().slice(0, 10), year.datum_do.toISOString().slice(0, 10)) : null;
    return { companyId: a.companyId, yearId: a.yearId, company: year.firma, year: year.godina,
      dateFrom: year.datum_od.toISOString().slice(0, 10), dateTo: year.datum_do.toISOString().slice(0, 10),
      revision: year.porez_dobit_verzija, inputs: saved?.inputs ?? {}, amended: saved?.amended ?? false,
      saved: Boolean(saved), canSave, canExport, canUpdate, locked: year.zakljucena,
      accountPrefill, taxDepreciation, taxDepreciationRevision: taxBatch?.revizija ?? null,
      taxDepreciationStatus: !canReadTaxDepreciation ? "forbidden" : !taxBatch ? "missing" : taxDepreciation === null ? "invalid" : "confirmed" };
  });
  const report = await calculateIncomeStatement({ agencijaId: a.agencyId, firmaId: a.companyId, poslovnaGodinaId: a.yearId });
  const statementResult = corporateTaxResultFromStatement(report.rows);
  const accountingDepreciation = corporateTaxAccountingDepreciation(report.rows);
  const depreciationInputs: CorporateTaxInput = {
    ...(accountingDepreciation !== null ? { x05: accountingDepreciation } : {}),
    ...(data.taxDepreciation !== null ? { x06: data.taxDepreciation } : {})
  };
  const inputs: CorporateTaxInput = data.saved ? data.inputs : { ...statementResult, ...depreciationInputs, ...data.accountPrefill.inputs };
  return { ...data, statementResult, accountingDepreciation, depreciationInputs, inputs };
}
export type CorporateTaxData = Awaited<ReturnType<typeof loadCorporateTax>>;

type Expected = { companyId: string; yearId: string; revision: number };
function expected(a: Actor, input: Expected) {
  if (!input || input.companyId !== a.companyId || input.yearId !== a.yearId) taxFail("Promijenjen je radni kontekst. Osvježite stranicu.");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) taxFail("Neispravna verzija prijave.");
}
export async function saveCorporateTax(input: Expected & { fields: unknown; amended: boolean }) {
  const a = await actor(); expected(a, input);
  if (typeof input.amended !== "boolean") taxFail("Neispravna vrsta prijave.");
  const inputs = parseCorporateTaxInput(input.fields), calculated = calculateCorporateTax(inputs);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${a.companyId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${a.yearId}::uuid FOR UPDATE`;
    const { year } = await context(tx, a, "save");
    if (year.porez_dobit_verzija !== input.revision) taxFail("Prijava je izmijenjena u drugom prozoru. Osvježite stranicu prije čuvanja.");
    const next: Snapshot = { schema: 1, rules: corporateTaxRules, inputs, amended: input.amended };
    const revision = year.porez_dobit_verzija + 1;
    await tx.poslovnaGodina.update({ where: { id: a.yearId }, data: { porez_dobit_podaci: next as unknown as Prisma.InputJsonValue, porez_dobit_verzija: revision } });
    await auditLogInTransaction(tx, { korisnikId: a.userId, agencijaId: a.agencyId, firmaId: a.companyId,
      modul: "zavrsni_racun", akcija: "save_corporate_tax", tipEntiteta: "PoslovnaGodina", entitetId: a.yearId,
      staraVrijednost: { revision: year.porez_dobit_verzija, data: year.porez_dobit_podaci }, novaVrijednost: { revision, data: next, totalCents: calculated.x59 } });
    return { revision };
  });
}
export async function exportCorporateTax(input: Expected) {
  const a = await actor(); expected(a, input);
  return prisma.$transaction(async tx => {
    const { year } = await context(tx, a, "export");
    if (year.porez_dobit_verzija !== input.revision) taxFail("Sačuvana prijava je izmijenjena. Osvježite stranicu prije izvoza.");
    const data = snapshot(year.porez_dobit_podaci);
    const xml = buildCorporateTaxXml(data.inputs, year.datum_od.toISOString().slice(0, 10), year.datum_do.toISOString().slice(0, 10));
    await auditLogInTransaction(tx, { korisnikId: a.userId, agencijaId: a.agencyId, firmaId: a.companyId,
      modul: "zavrsni_racun", akcija: "export_corporate_tax_xml", tipEntiteta: "PoslovnaGodina", entitetId: a.yearId,
      novaVrijednost: { revision: year.porez_dobit_verzija, rules: corporateTaxRules, year: year.godina, format: "PD_PG1_PG2" } });
    return { xml, fileName: `PD_${year.godina}_${(year.firma.pib ?? "firma").replace(/[^0-9a-zA-Z_-]/g, "")}.xml` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
