import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentUser, isDirectFiscalTenantUser } from "./auth";
import { auditLogInTransaction } from "./audit";
import { defaultTaxAccountRules, parseTaxAccountRules, calculateTaxAccountInputs } from "./corporate-tax-accounts";
import { fixedAssetDecimalToCents } from "./fixed-assets";
import { standardJournalTypes } from "./journals";
import { taxFail } from "./corporate-tax";

async function admin(tx: Prisma.TransactionClient) {
  const user = await getCurrentUser();
  if (!user || isDirectFiscalTenantUser(user) || user.rola !== "admin_agencije" || !user.agencija_id) taxFail("Podešavanja može mijenjati samo administrator agencije.");
  const active = await tx.korisnik.findFirst({ where: { id: user.id, agencija_id: user.agencija_id, rola: "admin_agencije", aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false } } });
  if (!active) taxFail("Korisnik više nema pristup agenciji.");
  return { id: user.id, agencyId: user.agencija_id };
}
export async function loadTaxAccountSettings() {
  return prisma.$transaction(async tx => {
    const user = await admin(tx);
    const agency = await tx.agencija.findUniqueOrThrow({ where: { id: user.agencyId } });
    return { agencyId: agency.id, agencyName: agency.naziv, revision: agency.porez_dobit_konta_verzija,
      rules: agency.porez_dobit_konta ? parseTaxAccountRules(agency.porez_dobit_konta) : defaultTaxAccountRules() };
  });
}
export async function saveTaxAccountSettings(input: { agencyId: string; revision: number; rules: unknown }) {
  const rules = parseTaxAccountRules(input.rules);
  return prisma.$transaction(async tx => {
    const user = await admin(tx);
    if (input.agencyId !== user.agencyId) taxFail("Agencija je promijenjena. Osvježite stranicu.");
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) taxFail("Neispravna verzija podešavanja.");
    await tx.$queryRaw`SELECT id FROM agencije WHERE id=${user.agencyId}::uuid FOR UPDATE`;
    const old = await tx.agencija.findUniqueOrThrow({ where: { id: user.agencyId } });
    if (old.porez_dobit_konta_verzija !== input.revision) taxFail("Podešavanja su izmijenjena u drugom prozoru. Osvježite stranicu.");
    await tx.agencija.update({ where: { id: user.agencyId }, data: { porez_dobit_konta: rules as unknown as Prisma.InputJsonValue, porez_dobit_konta_verzija: { increment: 1 } } });
    await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: user.agencyId, modul: "zavrsni_racun", akcija: "save_corporate_tax_accounts", tipEntiteta: "Agencija", entitetId: user.agencyId,
      staraVrijednost: { revision: old.porez_dobit_konta_verzija, rules: old.porez_dobit_konta }, novaVrijednost: { revision: input.revision + 1, rules } });
  });
}
// Internal reader: caller has already checked agency/company/year and report view rights.
export async function taxAccountPrefill(tx: Prisma.TransactionClient, agencyId: string, companyId: string, yearId: string) {
  const agency = await tx.agencija.findUniqueOrThrow({ where: { id: agencyId }, select: { porez_dobit_konta: true, porez_dobit_konta_verzija: true } });
  const rules = agency.porez_dobit_konta ? parseTaxAccountRules(agency.porez_dobit_konta) : defaultTaxAccountRules();
  if (!rules.some(rule => rule.accounts)) return { ...calculateTaxAccountInputs(rules, []), revision: agency.porez_dobit_konta_verzija };
  const totals = await tx.stavkaNaloga.groupBy({ by: ["konto_id"], where: { nalog: { firma: { agencija_id: agencyId, is_deleted: false }, firma_id: companyId, poslovna_godina_id: yearId, status: "POSTED", is_deleted: false,
    vrsta_naloga: { sifra: { notIn: [standardJournalTypes[0][0], standardJournalTypes[8][0]] } } } }, _sum: { duguje: true, potrazuje: true } });
  const accounts = await tx.firmaKonto.findMany({ where: { firma_id: companyId, id: { in: totals.map(row => row.konto_id) } }, select: { id: true, sifra: true } });
  const rows = totals.map(row => {
    const debit = fixedAssetDecimalToCents(row._sum.duguje ?? "0"), credit = fixedAssetDecimalToCents(row._sum.potrazuje ?? "0");
    const code = accounts.find(account => account.id === row.konto_id)?.sifra;
    if (debit === null || credit === null || !code) taxFail("Nije moguće pročitati promet konta.");
    return { code, debit, credit };
  });
  return { ...calculateTaxAccountInputs(rules, rows), revision: agency.porez_dobit_konta_verzija };
}
