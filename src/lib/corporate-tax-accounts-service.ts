import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentUser, isDirectFiscalTenantUser } from "./auth";
import { auditLogInTransaction } from "./audit";
import { defaultTaxAccountRules, parseTaxAccountRules, calculateTaxAccountInputs, taxAccountMatches, taxLiabilityRuleKey, type TaxLiabilityJournal } from "./corporate-tax-accounts";
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
      rules: agency.porez_dobit_konta ? parseTaxAccountRules(agency.porez_dobit_konta, true) : defaultTaxAccountRules() };
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
export async function taxAccountPrefill(tx: Prisma.TransactionClient, agencyId: string, companyId: string, yearId: string, period: { from: Date; to: Date }) {
  const agency = await tx.agencija.findUniqueOrThrow({ where: { id: agencyId }, select: { porez_dobit_konta: true, porez_dobit_konta_verzija: true } });
  const rules = agency.porez_dobit_konta ? parseTaxAccountRules(agency.porez_dobit_konta, true) : defaultTaxAccountRules();
  if (!rules.some(rule => rule.accounts)) return { ...calculateTaxAccountInputs(rules, []), revision: agency.porez_dobit_konta_verzija };
  const scope: Prisma.NalogWhereInput = { firma: { agencija_id: agencyId, is_deleted: false }, firma_id: companyId, poslovna_godina_id: yearId,
    OR: [{ agencija_id: agencyId }, { agencija_id: null }], status: "POSTED", is_deleted: false, datum: { gte: period.from, lte: period.to } };
  const totals = await tx.stavkaNaloga.groupBy({ by: ["konto_id"], where: { nalog: { ...scope,
    vrsta_naloga: { sifra: { notIn: [standardJournalTypes[0][0], standardJournalTypes[8][0]] } } } }, _sum: { duguje: true, potrazuje: true } });
  const accounts = await tx.firmaKonto.findMany({ where: { firma_id: companyId, id: { in: totals.map(row => row.konto_id) } }, select: { id: true, sifra: true } });
  const rows = totals.map(row => {
    const debit = fixedAssetDecimalToCents(row._sum.duguje ?? "0"), credit = fixedAssetDecimalToCents(row._sum.potrazuje ?? "0");
    const code = accounts.find(account => account.id === row.konto_id)?.sifra;
    if (debit === null || credit === null || !code) taxFail("Nije moguće pročitati promet konta.");
    return { code, debit, credit };
  });
  const liabilityRule = rules.find(rule => rule.key === taxLiabilityRuleKey)!;
  let liabilityJournals: TaxLiabilityJournal[] = [];
  if (liabilityRule.accounts) {
    const companyAccounts = await tx.firmaKonto.findMany({ where: { firma_id: companyId }, select: { id: true, sifra: true } });
    const ids = companyAccounts.filter(account => taxAccountMatches(liabilityRule, account.sifra)).map(account => account.id);
    if (ids.length) {
      const journals = await tx.nalog.findMany({ where: { ...scope, vrsta_naloga: { sifra: { not: "FINAL_ACCOUNT" } }, stavke: { some: { konto_id: { in: ids } } } },
        select: { broj: true, sifra: true, source_type: true, vrsta_naloga: { select: { sifra: true, prefiks: true } },
          stavke: { select: { duguje: true, potrazuje: true, firma_konto: { select: { sifra: true, firma_id: true } } } } } });
      liabilityJournals = journals.map(journal => ({
        kind: journal.vrsta_naloga.sifra === "OPENING_BALANCE" ? "OPENING_BALANCE"
          : ["BANK_STATEMENT", "CASH_REGISTER"].includes(journal.source_type) ? journal.source_type : journal.vrsta_naloga.sifra,
        reference: journal.sifra ?? `${journal.vrsta_naloga.prefiks}-${journal.broj}`,
        lines: journal.stavke.map(line => {
          const debit = fixedAssetDecimalToCents(line.duguje), credit = fixedAssetDecimalToCents(line.potrazuje);
          if (debit === null || credit === null || line.firma_konto.firma_id !== companyId) taxFail("Nije moguće pročitati obaveze za pozicije 16 i 37.");
          return { code: line.firma_konto.sifra, debit, credit };
        })
      }));
    }
  }
  return { ...calculateTaxAccountInputs(rules, rows, liabilityJournals), revision: agency.porez_dobit_konta_verzija };
}
