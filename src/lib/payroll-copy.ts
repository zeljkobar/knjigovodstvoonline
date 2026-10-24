import "server-only";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { employeeSnapshot, payrollBlockingIssuesForLine } from "./payroll-calculation-input";
import { payrollLineResultData } from "./payroll-line-data";
import { calculatePayrollLine, effectiveSeniorityYears, payrollCategories } from "./payroll";
import { appendPayrollTax, payrollHistoryKey, payrollTaxHistory, postedMonthlyPayrollLines } from "./payroll-monthly-tax";
import { payrollCopyMonth, shiftPayrollCopyDate, type PayrollCopyMonth } from "./payroll-copy-period";

export type PayrollCopyActor = { userId: string; agencyId: string };
export type PayrollCopyRow = { companyId: string; name: string; pib: string | null; version: string; count: number; workers: number; net: number; reason: string | null };
export type PayrollCopyResult = { companyId: string; name: string; ok: boolean; message: string; calculations: Array<{ id: string; yearId: string; number: number }> };
export class PayrollCopyError extends Error {}
function fail(message: string): never { throw new PayrollCopyError(message); }
const readyStatuses = ["CALCULATED", "REVIEWED", "POSTED", "LOCKED"];
const category = payrollCategories.regularWork;
const permissions = ["view", "create", "update"];
const sourceWhere = (a: PayrollCopyActor, month: PayrollCopyMonth) => ({ agencija_id: a.agencyId, godina: month.year, mjesec: month.month, kategorija: category, status: { in: readyStatuses }, is_deleted: false });
const sourceInclude = { stavke: { orderBy: { redni_broj: "asc" as const } }, radnici: true };
type Source = Prisma.PlateObracunGetPayload<{ include: typeof sourceInclude }>;
function versionOf(rows: Source[]) {
  return createHash("sha256").update(JSON.stringify(rows.map(c => [c.id, c.updated_at.toISOString(), c.stavke.map(l => [l.id, l.updated_at.toISOString()]), c.radnici.map(w => [w.id, w.updated_at.toISOString()]).sort()]))).digest("hex");
}
async function actor(db: Prisma.TransactionClient, a: PayrollCopyActor) {
  const user = await db.korisnik.findFirst({ where: { id: a.userId, agencija_id: a.agencyId, aktivan: true, is_deleted: false, rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false } } });
  if (!user) fail("Nemate pristup kopiranju obračuna ove agencije.");
  return user;
}
async function companies(db: Prisma.TransactionClient, a: PayrollCopyActor) {
  const user = await actor(db, a);
  const firms = await db.firma.findMany({ where: { agencija_id: a.agencyId, aktivan: true, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }) }, select: { id: true, naziv: true, pib: true }, orderBy: [{ naziv: "asc" }, { id: "asc" }] });
  if (user.rola === "admin_agencije") return firms;
  const grants = await db.korisnikPravo.findMany({ where: { agencija_id: a.agencyId, korisnik_id: user.id, firma_id: { in: firms.map(f => f.id) }, modul: "plate", akcija: { in: permissions }, dozvoljeno: true } });
  return firms.filter(f => permissions.every(p => grants.some(g => g.firma_id === f.id && g.akcija === p)));
}
function months(source: string, target: string) {
  const from = payrollCopyMonth(source), to = payrollCopyMonth(target);
  if (!from || !to || from.key === to.key) fail("Izaberite ispravan izvorni i različit ciljni mjesec.");
  return { from, to };
}
export async function payrollCopyPreview(a: PayrollCopyActor, source: string, target: string): Promise<PayrollCopyRow[]> {
  const { from, to } = months(source, target);
  return prisma.$transaction(async db => {
    const firms = await companies(db, a);
    const ids = firms.map(f => f.id);
    const [sources, years, existing, lockedPeriods] = await Promise.all([
      db.plateObracun.findMany({ where: { ...sourceWhere(a, from), firma_id: { in: ids } }, include: sourceInclude, orderBy: [{ broj: "asc" }, { id: "asc" }] }),
      db.poslovnaGodina.findMany({ where: { firma_id: { in: ids }, godina: to.year } }),
      db.plateObracun.findMany({ where: { agencija_id: a.agencyId, firma_id: { in: ids }, godina: to.year, mjesec: to.month, kategorija: category, is_deleted: false }, select: { firma_id: true } }),
      db.pdvPeriod.findMany({ where: { firma_id: { in: ids }, datum_od: { lte: to.to }, datum_do: { gte: to.from }, status: "LOCKED" }, select: { firma_id: true } })
    ]);
    return firms.flatMap(f => {
      const rows = sources.filter(c => c.firma_id === f.id);
      if (!rows.length) return [];
      const year = years.find(y => y.firma_id === f.id);
      const reason = !year ? "Nije otvorena ciljna poslovna godina." : year.zakljucena ? "Ciljna poslovna godina je zaključana." : existing.some(e => e.firma_id === f.id) ? "Ciljni obračun već postoji." : lockedPeriods.some(p => p.firma_id === f.id) ? "Ciljni PDV period je zaključan." : rows.some(c => !c.stavke.length) ? "Izvorni obračun nema stavke." : null;
      return [{ companyId: f.id, name: f.naziv, pib: f.pib, version: versionOf(rows), count: rows.length, workers: new Set(rows.flatMap(c => c.stavke.map(l => l.radnik_id))).size, net: rows.flatMap(c => c.stavke).reduce((s, l) => s + l.neto_za_isplatu_cent, 0), reason }];
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function copyCompany(a: PayrollCopyActor, from: PayrollCopyMonth, to: PayrollCopyMonth, companyId: string, version: string) {
  return prisma.$transaction(async db => {
    // Same company/year lock order as payroll posting and year closing.
    await db.$queryRaw`SELECT id FROM korisnici WHERE id=${a.userId}::uuid FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM firme WHERE id=${companyId}::uuid FOR UPDATE`;
    const available = await companies(db, a);
    const firm = available.find(f => f.id === companyId);
    if (!firm) fail("Firma nije dostupna ili nemate prava za pregled, kreiranje i obračun plata.");
    const year = await db.poslovnaGodina.findFirst({ where: { firma_id: firm.id, godina: to.year } });
    if (!year) fail("Nije otvorena ciljna poslovna godina.");
    await db.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;
    const currentYear = await db.poslovnaGodina.findUniqueOrThrow({ where: { id: year.id } });
    if (currentYear.zakljucena || to.from < currentYear.datum_od || to.to > currentYear.datum_do) fail("Ciljna godina je zaključana ili period nije u poslovnoj godini.");
    const periods = await db.$queryRaw<Array<{ status: string }>>`SELECT status FROM pdv_periodi WHERE firma_id=${firm.id}::uuid AND datum_od<=${to.to}::date AND datum_do>=${to.from}::date FOR UPDATE`;
    if (periods.some(p => p.status === "LOCKED")) fail("Ciljni PDV period je zaključan.");
    if (await db.plateObracun.findFirst({ where: { agencija_id: a.agencyId, firma_id: firm.id, godina: to.year, mjesec: to.month, kategorija: category, is_deleted: false } })) fail("Ciljni obračun već postoji; nije napravljen duplikat.");
    await db.$queryRaw`SELECT id FROM plate_obracuni WHERE firma_id=${firm.id}::uuid AND godina=${from.year} AND mjesec=${from.month} ORDER BY id FOR UPDATE`;
    const sources = await db.plateObracun.findMany({ where: { ...sourceWhere(a, from), firma_id: firm.id }, include: sourceInclude, orderBy: [{ broj: "asc" }, { id: "asc" }] });
    if (!sources.length || versionOf(sources) !== version) fail("Izvorni obračuni su promijenjeni. Osvježite spisak i ponovo označite firmu.");
    await db.$queryRaw`SELECT id FROM plate_radnici WHERE firma_id=${firm.id}::uuid ORDER BY id FOR UPDATE`;
    const employees = await db.plateRadnik.findMany({ where: { agencija_id: a.agencyId, firma_id: firm.id, id: { in: sources.flatMap(c => c.stavke.map(l => l.radnik_id)) }, is_deleted: false, aktivan: true } });
    const units = await db.poslovnaJedinica.findMany({ where: { firma_id: firm.id, agencija_id: a.agencyId, aktivna: true, is_deleted: false }, select: { id: true } });
    const last = await db.plateObracun.findFirst({ where: { firma_id: firm.id, poslovna_godina_id: year.id, kategorija: category }, orderBy: { broj: "desc" }, select: { broj: true } });
    let number = last?.broj ?? 0;
    const created: Array<{ id: string; yearId: string; number: number }> = [];
    // Include preceding copied calculations when a month contains supplementary pay.
    let monthlyHistory: Awaited<ReturnType<typeof postedMonthlyPayrollLines>> = [];
    for (const source of sources) {
      if (!source.stavke.length || source.stavke.some(l => !readyStatuses.includes(l.status))) fail("Izvorne stavke nijesu potpuno obračunate.");
      if (source.poslovna_jedinica_id && !units.some(u => u.id === source.poslovna_jedinica_id)) fail("Poslovna jedinica izvornog obračuna više nije aktivna.");
      const calculationDate = shiftPayrollCopyDate(source.datum_obracuna, from, to);
      if (calculationDate < currentYear.datum_od || calculationDate > currentYear.datum_do) fail("Preneseni datum obračuna nije u ciljnoj poslovnoj godini.");
      const calculationPeriods = await db.$queryRaw<Array<{status:string}>>`SELECT status FROM pdv_periodi WHERE firma_id=${firm.id}::uuid AND datum_od<=${calculationDate}::date AND datum_do>=${calculationDate}::date FOR UPDATE`;
      if (calculationPeriods.some(p => p.status === "LOCKED")) fail("PDV period datuma obračuna je zaključan.");
      const copied = await db.plateObracun.create({ data: { agencija_id: a.agencyId, firma_id: firm.id, poslovna_godina_id: year.id, poslovna_jedinica_id: source.poslovna_jedinica_id, kategorija: category, broj: ++number, oznaka: source.oznaka, godina: to.year, mjesec: to.month, datum_od: to.from, datum_do: to.to, datum_obracuna: calculationDate, datum_isplate: source.datum_isplate ? shiftPayrollCopyDate(source.datum_isplate, from, to) : null, fond_sati: source.fond_sati, koristi_minuli_rad: source.koristi_minuli_rad, napomena: source.napomena, created_by: a.userId, updated_by: a.userId } });
      if (!created.length) monthlyHistory = await postedMonthlyPayrollLines(db, copied);
      const histories = new Map(employees.map(e => [e.id, payrollTaxHistory(monthlyHistory, e.id)]));
      const workerIds = new Map<string, string>();
      const newHistory: typeof monthlyHistory = [];
      for (const input of source.stavke) {
        const employee = employees.find(e => e.id === input.radnik_id);
        if (!employee || !employee.zaposlen) fail("Spisak zaposlenih je promijenjen. Ovu firmu obračunajte posebno.");
        const originalWorker = source.radnici.find(w => w.radnik_id === employee.id);
        const lineFrom = shiftPayrollCopyDate(input.datum_od, from, to), lineTo = shiftPayrollCopyDate(input.datum_do, from, to);
        const problems = payrollBlockingIssuesForLine({ employee, line: { ...input, datum_od: lineFrom, datum_do: lineTo }, calculationDate: to.to, calculationFrom: to.from, calculationTo: to.to, requiresEmployment: true });
        if (problems.length) fail(problems[0]);
        const activeOn = { aktivan: true, valid_from: { lte: calculationDate }, OR: [{ valid_to: null }, { valid_to: { gte: calculationDate } }] };
        const income = await db.plateSifraPrimanja.findFirst({ where: { id: input.sifra_primanja_id, AND: [activeOn, { OR: [{ agencija_id: a.agencyId, firma_id: firm.id }, { agencija_id: a.agencyId, firma_id: null }, { agencija_id: null, firma_id: null }] }] } });
        const type = await db.plateVrstaObracuna.findFirst({ where: { id: input.vrsta_obracuna_id, ...activeOn } });
        if (!income || !type) fail("Šifra primanja ili vrsta obračuna više ne važi. Ovu firmu obračunajte posebno.");
        const contributionFlags = [["koristi_zaposleni_pio", "EMPLOYEE_PIO"], ["koristi_zaposleni_zdravstvo", "EMPLOYEE_HEALTH"], ["koristi_zaposleni_nezaposleni", "EMPLOYEE_UNEMPLOYMENT"], ["koristi_poslodavac_pio", "EMPLOYER_PIO"], ["koristi_poslodavac_zdravstvo", "EMPLOYER_HEALTH"], ["koristi_poslodavac_nezaposleni", "EMPLOYER_UNEMPLOYMENT"], ["koristi_fond_rada", "LABOR_FUND"], ["koristi_sindikat", "UNION"], ["koristi_privredna_komora", "CHAMBER"]] as const;
        const needed = contributionFlags.filter(([flag]) => income[flag]).map(([, code]) => code);
        const rates = await db.plateDoprinosStopa.findMany({ where: { ...activeOn, sifra: { in: needed } }, select: { sifra: true } });
        if (needed.some(code => !rates.some(rate => rate.sifra === code))) fail("Nedostaju važeće stope doprinosa za ciljni datum.");
        if (income.koristi_porez && income.sifra.split(".")[0] === "001" && !await db.platePorezRazred.count({ where: { ...activeOn, sifra: "REGULAR_SALARY" } })) fail("Nedostaju važeći poreski razredi za ciljni datum.");
        const years = effectiveSeniorityYears({ manualYears: originalWorker?.minuli_rad_godina || employee.minuli_rad_godina, startDate: employee.datum_pocetka, referenceDate: to.to });
        let workerId = workerIds.get(employee.id);
        if (!workerId) {
          const worker = await db.plateObracunRadnik.create({ data: { agencija_id: a.agencyId, firma_id: firm.id, obracun_id: copied.id, radnik_id: employee.id, snapshot: employeeSnapshot(employee), minuli_rad_godina: years, minuli_rad_mjeseci: originalWorker?.minuli_rad_mjeseci ?? employee.minuli_rad_mjeseci, minuli_rad_dana: originalWorker?.minuli_rad_dana ?? employee.minuli_rad_dana, fond_sati: source.fond_sati, ukupno_sati: originalWorker?.ukupno_sati ?? input.ukupno_sati, status: "CALCULATED", created_by: a.userId, updated_by: a.userId } });
          workerId = worker.id; workerIds.set(employee.id, worker.id);
        }
        const history = histories.get(employee.id)!;
        const result = await calculatePayrollLine({ monthlyTaxHistory: history, calculationDate, incomeType: income, calculationType: type, netAmountCents: input.input_neto_cent, grossAmountCents: input.input_bruto_cent, fixedPartCents: input.fiksni_dio_cent, complexityCoefficient: Number(input.koeficijent_slozenosti ?? 0), usesSeniority: input.koristi_minuli_rad, seniorityCoefficient: Number(input.koeficijent_minuli_rad), seniorityYears: years, seniorityMonths: originalWorker?.minuli_rad_mjeseci ?? employee.minuli_rad_mjeseci, seniorityDays: originalWorker?.minuli_rad_dana ?? employee.minuli_rad_dana, workingHours: input.ukupno_sati, workingHoursFund: input.fond_sati, municipality: employee.poreska_opstina ?? employee.opstina }, db);
        result.details.monthlyHistoryKey = payrollHistoryKey(monthlyHistory, employee.id);
        appendPayrollTax(history, result);
        const line = await db.plateObracunStavka.create({ data: { agencija_id: a.agencyId, firma_id: firm.id, obracun_id: copied.id, obracun_radnik_id: workerId, radnik_id: employee.id, redni_broj: input.redni_broj, sifra_primanja_id: income.id, ioppd_sifra_id: income.ioppd_sifra_id, vrsta_obracuna_id: type.id, sifra_primanja: income.sifra, naziv_primanja: income.naziv, datum_od: lineFrom, datum_do: lineTo, fond_sati: input.fond_sati, ukupno_sati: input.ukupno_sati, procenat: input.procenat, input_neto_cent: input.input_neto_cent, input_bruto_cent: input.input_bruto_cent, fiksni_dio_cent: input.fiksni_dio_cent, koeficijent_slozenosti: input.koeficijent_slozenosti, koristi_minuli_rad: input.koristi_minuli_rad, ...payrollLineResultData(result), status: "CALCULATED", created_by: a.userId, updated_by: a.userId } });
        newHistory.push(line);
      }
      monthlyHistory.push(...newHistory);
      await db.plateObracun.update({ where: { id: copied.id }, data: { status: "CALCULATED", calculated_at: new Date(), calculated_by: a.userId } });
      await auditLogInTransaction(db, { korisnikId: a.userId, agencijaId: a.agencyId, firmaId: firm.id, modul: "plate", akcija: "copy_calculated_payroll", tipEntiteta: "PlateObracun", entitetId: copied.id, novaVrijednost: { sourceId: source.id, sourceMonth: from.key, targetMonth: to.key, status: "CALCULATED", workers: workerIds.size, lines: source.stavke.length } });
      created.push({ id: copied.id, yearId: year.id, number: copied.broj });
    }
    return created;
  }, { timeout: 60000 });
}

export async function copyPayrollMonths(a: PayrollCopyActor, source: string, target: string, selected: Array<{ companyId: string; version: string }>): Promise<PayrollCopyResult[]> {
  const { from, to } = months(source, target);
  await actor(prisma, a);
  if (!selected.length || selected.length > 500 || new Set(selected.map(s => s.companyId)).size !== selected.length || selected.some(s => !/^[a-f0-9-]{36}$/i.test(s.companyId) || !/^[a-f0-9]{64}$/.test(s.version))) fail("Označite firme iz prikazanog spiska.");
  const visible = await companies(prisma, a);
  const results: PayrollCopyResult[] = [];
  for (const selection of selected) {
    const firm = visible.find(f => f.id === selection.companyId);
    if (!firm) { results.push({ companyId: selection.companyId, name: "Nedostupna firma", ok: false, message: "Firma nije dostupna ili nemate potrebna prava.", calculations: [] }); continue; }
    try {
      const calculations = await copyCompany(a, from, to, firm.id, selection.version);
      results.push({ companyId: firm.id, name: firm.naziv, ok: true, message: "Obračuni su kopirani i obračunati.", calculations });
    } catch (error) {
      const message = error instanceof PayrollCopyError ? error.message : error instanceof Error && error.message.startsWith("PAYROLL_UNSUPPORTED_BASIS") ? "Osnova zahtijeva nepodržan obračun. Ovu firmu obradite posebno." : "Kopiranje nije završeno. Za ovu firmu nije sačuvana djelimična kopija.";
      results.push({ companyId: firm.id, name: firm.naziv, ok: false, message, calculations: [] });
    }
  }
  return results;
}
