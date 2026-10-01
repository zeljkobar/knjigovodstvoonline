import "server-only";
import { prisma } from "@/lib/prisma";
import { getCompanyMailConfigs } from "@/lib/company-mail-settings";
import { completedMailKeys } from "@/lib/mail-import-completion";
import { listCompanyInbox } from "@/lib/imap-mail";
import { importBankStatementMailMessage, postSelectedBankStatements } from "@/lib/bank-statement-service";
import { bankAutomationDay } from "@/lib/bank-automation-clock";

export async function runDailyBankAutomation(now = new Date()) {
  const { day, due } = bankAutomationDay(now);
  const agencyId = process.env.IMAP_AGENCY_ID;
  if (!due || !agencyId || process.env.BANK_AUTOMATION_ENABLED !== "true") return;
  const user = await prisma.korisnik.findFirst({ where: { agencija_id: agencyId, rola: "admin_agencije", aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false } }, orderBy: { id: "asc" } });
  if (!user) return;
  const configs = await getCompanyMailConfigs(agencyId);
  for (const config of configs) {
    if (!config.folder && !(config.includeInbox && config.rules.length)) continue;
    // A transaction-scoped advisory lock coordinates multiple Node/PM2 processes.
    // Business operations commit independently, so a crash retries only unfinished work.
    await prisma.$transaction(async lock => {
      const key = `bank-auto:${agencyId}:${config.firmaId}`;
      const [lease] = await lock.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
      if (!lease.acquired) return;
      const prior = await prisma.auditLog.findFirst({ where: { agencija_id: agencyId, firma_id: config.firmaId, akcija: "AUTO_BANK_RUN", nova_vrijednost: { path: ["day"], equals: day } } });
      if (prior) return;
      const deadline = Date.now() + 20 * 60 * 1000;
      let imported = 0, posted = 0, review = 0;
      const errors: string[] = [];
      try {
        const date = new Date(`${day}T00:00:00Z`);
        const year = await prisma.poslovnaGodina.findFirst({ where: { firma_id: config.firmaId, datum_od: { lte: date }, datum_do: { gte: date }, zakljucena: false } });
        if (!year) throw new Error("Nema otvorene poslovne godine za današnji datum.");
        const scope = { agencija_id: agencyId, firma_id: config.firmaId, poslovna_godina_id: year.id };
        const execution = { userId: user.id, agencyId, companyId: config.firmaId, yearId: year.id };
        const completed = await completedMailKeys(scope);
        const { references } = await listCompanyInbox(config, 1, completed);
        for (const ref of references) {
          if (Date.now() > deadline) throw new Error("Dostignuto ograničenje trajanja obrade.");
          const results = await importBankStatementMailMessage({ ...ref, firmaId: config.firmaId, yearId: year.id }, execution);
          imported += results.filter(r => r.status === "IMPORTED").length;
          review += results.filter(r => ["ERROR", "REVIEW"].includes(r.status)).length;
        }
        // Only email-origin statements; do not pick up unrelated manual drafts.
        const ready = await prisma.bankStatement.findMany({ where: { ...scope, status: "READY", journal_id: null, is_deleted: false, mail_obrade: { some: { ...scope, status: { in: ["IMPORTED", "DUPLICATE"] } } } }, orderBy: [{ statement_date: "asc" }, { statement_number: "asc" }], select: { id: true, statement_number: true } });
        for (const statement of ready) {
          if (Date.now() > deadline) throw new Error("Dostignuto ograničenje trajanja obrade.");
          try {
            const form = new FormData(); form.append("statement_id", statement.id);
            posted += (await postSelectedBankStatements(form, execution))?.length ?? 0;
          } catch (error) {
            errors.push(`Izvod ${statement.statement_number}: ${error instanceof Error && !error.message.includes("prisma") ? error.message.slice(0, 200) : "Knjiženje nije uspjelo."}`);
          }
        }
      } catch {
        errors.push("Obrada firme nije završena. Provjerite otvorenu godinu, mail podešavanja i vezu sa serverom.");
      }
      await prisma.auditLog.create({ data: { korisnik_id: user.id, agencija_id: agencyId, firma_id: config.firmaId, modul: "agencija.izvodi", akcija: "AUTO_BANK_RUN", tip_entiteta: "Firma", entitet_id: config.firmaId, nova_vrijednost: { day, imported, posted, review, errors, status: errors.length || review ? "REVIEW" : "DONE" }, napomena: "Dnevna obrada u 10:00 Europe/Podgorica" } });
    }, { timeout: 30 * 60 * 1000, maxWait: 10000 }).catch(() => { console.error("Automatska obrada izvoda: obrada firme je prekinuta; slijedi ponovni pokušaj."); });
  }
}

export function startBankAutomation() {
  const state = globalThis as typeof globalThis & { bankAutomationTimer?: ReturnType<typeof setInterval>; bankAutomationBusy?: boolean };
  if (state.bankAutomationTimer) return;
  const tick = async () => {
    if (state.bankAutomationBusy) return;
    state.bankAutomationBusy = true;
    try { await runDailyBankAutomation(); } catch { console.error("Automatska obrada izvoda trenutno nije dostupna."); }
    finally { state.bankAutomationBusy = false; }
  };
  state.bankAutomationTimer = setInterval(() => { void tick(); }, 60000);
  state.bankAutomationTimer.unref();
  void tick();
}
