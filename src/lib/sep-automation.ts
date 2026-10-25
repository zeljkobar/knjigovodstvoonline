import "server-only";
import type { SepAutomatikaPodesavanje } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { decryptSepCredentials } from "./sep-secrets";
import { downloadSepExcel, SepError } from "./sep-client";
import { parseSepAutomationExcel, sepAutomationDay, sepAutomationPeriods, sepAutomationScheduledAt } from "./sep-automation-policy";
import { invoiceExecutionUser, type InvoiceExecution } from "./invoice-execution";
import { importInvoiceLinks, InvoiceImportError } from "./invoice-import-service";
import { postInvoiceBookInContext } from "./invoice-book-posting";
import { hasPermission } from "./permissions";

class AutomationError extends Error {}
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const monthEnd = (from: string) => new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0));

export async function withSepAutomationLock(work: (alive: () => Promise<void>) => Promise<void>) {
  // The lock covers the whole queue, across every agency and every Node/PM2 process.
  // Only the lock transaction is long-lived; invoices/results commit independently.
  return prisma.$transaction(async lease => {
    const [lock] = await lease.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('sep-automation-global-v1', 0)) AS acquired`;
    if (!lock.acquired) return false;
    const alive = async () => { await lease.$queryRaw`SELECT 1`; };
    await work(alive);
    return true;
  }, { timeout: 6 * 60 * 60 * 1000, maxWait: 1000 });
}

async function ensureBook(execution: InvoiceExecution, typeId: string, from: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${execution.companyId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${execution.yearId}::uuid FOR UPDATE`;
    const year = await tx.poslovnaGodina.findFirst({ where: { id: execution.yearId, firma_id: execution.companyId, zakljucena: false } });
    const date = monthEnd(from), month = Number(from.slice(5, 7));
    if (!year || date < year.datum_od || date > year.datum_do) throw new AutomationError("Nema otvorene poslovne godine za period.");
    const type = await tx.racunVrsta.findFirst({ where: { id: typeId, firma_id: execution.companyId, agencija_id: execution.agencyId, dokument_tip: "KIF", aktivna: true } });
    if (!type) throw new AutomationError("Izabrana KIF vrsta nije aktivna.");
    const periods = await tx.$queryRaw<{status: string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${execution.companyId}::uuid AND datum_od<=${date}::date AND datum_do>=${date}::date FOR UPDATE`;
    if (periods.some(period => period.status === "LOCKED")) throw new AutomationError("PDV period je zaključan. Za dodavanje računa prvo ga otključajte.");
    const scope = { agencija_id: execution.agencyId, firma_id: execution.companyId, poslovna_godina_id: execution.yearId };
    const books = await tx.kifBook.findMany({ where: { ...scope, racun_vrsta_id: typeId, mjesec: month, is_deleted: false } });
    if (books.length > 1) throw new AutomationError("Postoji više KIF knjiga izabrane vrste za isti mjesec. Potrebna je ručna provjera.");
    if (books[0]) {
      if (books[0].status !== "OPEN") throw new AutomationError("KIF knjiga nije otvorena za unos.");
      return books[0];
    }
    const last = await tx.kifBook.findFirst({ where: scope, orderBy: { redni_broj: "desc" }, select: { redni_broj: true } });
    const number = (last?.redni_broj ?? 0) + 1;
    const book = await tx.kifBook.create({ data: { ...scope, racun_vrsta_id: typeId, redni_broj: number, mjesec: month, kif_date: date,
      internal_kif_number: `KIF-${year.godina}-${String(number).padStart(4, "0")}`, created_by: execution.userId, updated_by: execution.userId } });
    await auditLogInTransaction(tx, { korisnikId: execution.userId, agencijaId: execution.agencyId, firmaId: execution.companyId, modul: "sep", akcija: "AUTO_CREATE_KIF", tipEntiteta: "KifBook", entitetId: book.id, novaVrijednost: { mjesec: month, godina: year.godina, racun_vrsta_id: typeId } });
    return book;
  });
}

export async function processSepAutomationCompany(config: SepAutomatikaPodesavanje, day: string, alive: () => Promise<void> = async () => {}) {
  const deadline = Date.now() + 20 * 60 * 1000;
  const result = { preuzeto: 0, uvezeno: 0, duplikati: 0, preskoceno: 0, proknjizeno: 0, greske: [] as string[], periodi: [] as string[] };
  let credentials: ReturnType<typeof decryptSepCredentials> | undefined;
  let ownerId: string | undefined;
  const guard = async () => {
    await alive();
    if (Date.now() > deadline) throw new AutomationError("Dostignuto je ograničenje od 20 minuta za firmu. Preostali računi nastavljaju se narednom obradom.");
    const active = await prisma.sepAutomatikaPodesavanje.count({ where: { id: config.id, agencija_id: config.agencija_id, firma_id: config.firma_id, aktivna: true, revizija: config.revizija } });
    if (!active) throw new AutomationError("Postavke automatike su promijenjene ili isključene. Obrada je zaustavljena.");
  };
  await guard();
  const run = await prisma.sepAutomatikaObrada.upsert({ where: { firma_id_dan: { firma_id: config.firma_id, dan: dayDate(day) } },
    create: { agencija_id: config.agencija_id, firma_id: config.firma_id, dan: dayDate(day), status: "RUNNING", pokusaji: 1, pocetak: new Date() },
    update: { status: "RUNNING", pokusaji: { increment: 1 }, pocetak: new Date(), kraj: null } });
  try {
    const firm = await prisma.firma.findFirst({ where: { id: config.firma_id, agencija_id: config.agencija_id, aktivan: true, is_deleted: false } });
    if (!firm || !/^\d{8}$/.test(firm.pib ?? "")) throw new AutomationError("Firma nije aktivna ili nema ispravan PIB.");
    const certificate = await prisma.agencijaSepSertifikat.findFirst({ where: { id: config.sertifikat_id, agencija_id: config.agencija_id, is_deleted: false } });
    if (!certificate?.sifrovani_podaci) throw new AutomationError("SEP sertifikat nije dostupan. Provjerite podešavanja.");
    ownerId = certificate.korisnik_id;
    const base = { userId: ownerId, agencyId: config.agencija_id, companyId: config.firma_id };
    const authorize = async (execution: InvoiceExecution) => {
      await guard();
      const user = await invoiceExecutionUser(execution);
      if (user.rola !== "admin_agencije") throw new AutomationError("Vlasnik sertifikata nije aktivan administrator agencije.");
      for (const [modul, akcija] of [["sep", "export"], ["izlazni_racuni", "create"], ["izlazni_racuni", "post"], ["nalozi", "post"]] as const) {
        if (!await hasPermission(user, { firmaId: firm.id, modul, akcija })) throw new AutomationError("Nedostaju prava za automatski uvoz i knjiženje.");
      }
      if (!await prisma.agencijaSepSertifikat.count({ where: { id: certificate.id, agencija_id: config.agencija_id, korisnik_id: ownerId, updated_at: certificate.updated_at, is_deleted: false } })) throw new AutomationError("Sertifikat je promijenjen tokom obrade. Ponovite obradu.");
    };
    credentials = decryptSepCredentials(certificate.sifrovani_podaci, `${config.agencija_id}:${ownerId}`);
    for (const period of sepAutomationPeriods(day)) {
      result.periodi.push(`${period.from} — ${period.to}`);
      try {
        const year = await prisma.poslovnaGodina.findFirst({ where: { firma_id: firm.id, datum_od: { lte: dayDate(period.from) }, datum_do: { gte: dayDate(period.to) } } });
        if (!year || year.zakljucena) throw new AutomationError("Nema otvorene poslovne godine za period.");
        const execution = { ...base, yearId: year.id };
        await authorize(execution);
        const downloaded = await downloadSepExcel(credentials, firm.pib!, period.from, period.to);
        let parsed: ReturnType<typeof parseSepAutomationExcel>;
        try { parsed = parseSepAutomationExcel(downloaded.excel, firm.pib!, period.from, period.to); }
        finally { downloaded.excel.fill(0); }
        await authorize(execution);
        result.preuzeto += parsed.total; result.preskoceno += parsed.skipped;
        result.greske.push(...parsed.errors.slice(0, 100));
        const existing = await prisma.kifEntry.findMany({ where: { agencija_id: config.agencija_id, firma_id: firm.id, is_deleted: false, fiscal_iic: { in: parsed.invoices.map(invoice => invoice.iic) } }, select: { fiscal_iic: true, total_gross: true } });
        const known = new Set(existing.map(entry => entry.fiscal_iic));
        const knownAmounts = new Map(existing.map(entry => [entry.fiscal_iic, Math.round(Number(entry.total_gross.toString()) * 100)]));
        for (const invoice of parsed.invoices) {
          if (known.has(invoice.iic) && knownAmounts.get(invoice.iic) !== Math.round((invoice.metadata.total ?? 0) * 100) && result.greske.length < 100) result.greske.push(`${invoice.iic}: SEP i KIF imaju različit ukupan iznos. Potrebna je ručna provjera.`);
        }
        const newInvoices = parsed.invoices.filter(invoice => !known.has(invoice.iic));
        result.duplikati += parsed.invoices.length - newInvoices.length;
        // Also finish only this automation's committed-but-unposted rows after a crash.
        const pendingBefore = await prisma.kifEntry.count({ where: { agencija_id: config.agencija_id, firma_id: firm.id, poslovna_godina_id: year.id, sep_automation: true, posting_status: "UNPOSTED", is_deleted: false, kif_book: { mjesec: Number(period.from.slice(5, 7)), racun_vrsta_id: config.racun_vrsta_id } } });
        if (!newInvoices.length && !pendingBefore) {
          const linked = await prisma.kifEntry.findFirst({ where: { agencija_id: config.agencija_id, firma_id: firm.id, poslovna_godina_id: year.id, sep_automation: true, is_deleted: false, journal_id: { not: null }, kif_book: { mjesec: Number(period.from.slice(5, 7)), racun_vrsta_id: config.racun_vrsta_id } }, select: { journal_id: true } });
          if (linked?.journal_id && !await prisma.nalog.count({ where: { id: linked.journal_id, agencija_id: config.agencija_id, firma_id: firm.id, status: "POSTED", is_deleted: false } })) throw new AutomationError("Povezani nalog nije proknjižen. Ručno provjerite nalog prije nastavka automatike.");
          continue;
        }
        await authorize(execution);
        const book = await ensureBook(execution, config.racun_vrsta_id, period.from);
        for (const invoice of newInvoices) {
          await authorize(execution);
          const imported = await importInvoiceLinks({ documentType: "KIF", bookId: book.id, links: [invoice.link], metadata: [invoice.metadata], automation: true }, execution, () => authorize(execution));
          result.uvezeno += imported.summary.success; result.duplikati += imported.summary.duplicate;
          for (const error of imported.results.filter(item => item.status === "error")) {
            if (result.greske.length < 100) result.greske.push(`${invoice.iic}: ${error.message}`);
          }
        }
        await authorize(execution);
        const pending = await prisma.kifEntry.findMany({ where: { agencija_id: config.agencija_id, firma_id: firm.id, poslovna_godina_id: year.id, kif_book_id: book.id, sep_automation: true, posting_status: "UNPOSTED", journal_id: null, is_deleted: false }, select: { id: true } });
        if (pending.length) {
          const posted = await postInvoiceBookInContext({ documentType: "KIF", bookId: book.id, finalize: true, entryIds: pending.map(entry => entry.id), beforeWrite: () => authorize(execution) }, execution);
          if (!posted.ok) throw new AutomationError(posted.reason === "knjizenje_rucni_nacrt" ? "Postojeći nalog je ručno ostavljen u nacrtu. Provjerite ga i proknjižite prije nastavka automatike." : posted.reason === "knjizenje_ino_konto" ? "U KIF šemi nije podešeno konto ino kupca. Dopunite ga u Računi / Podešavanja." : `Knjiženje nije završeno (${posted.reason}). Provjerite KIF šemu, konta i zaključavanja.`);
          result.proknjizeno += pending.length;
        }
      } catch (error) {
        if (result.greske.length < 100) result.greske.push(error instanceof AutomationError || error instanceof InvoiceImportError ? error.message : error instanceof SepError ? `SEP preuzimanje nije uspjelo (${error.code}).` : "Obrada perioda nije završena. Provjerite SEP pristup, šemu i prava pa ponovite.");
      }
    }
  } catch (error) {
    result.greske.push(error instanceof AutomationError ? error.message : "Obrada firme nije završena. Provjerite SEP sertifikat, godinu i prava.");
  } finally {
    if (credentials) { credentials.pfx = ""; credentials.password = ""; credentials.jmbg = ""; }
  }
  // If the global lock connection was lost, leave RUNNING for recovery; never overlap a new owner.
  await alive();
  await prisma.$transaction(async tx => {
    await tx.sepAutomatikaObrada.update({ where: { id: run.id }, data: { status: result.greske.length ? "REVIEW" : "DONE", kraj: new Date(), rezultat: result } });
    await auditLogInTransaction(tx, { korisnikId: ownerId, agencijaId: config.agencija_id, firmaId: config.firma_id, modul: "sep", akcija: "AUTO_SEP_RUN", tipEntiteta: "SepAutomatikaObrada", entitetId: run.id, novaVrijednost: { dan: day, ...result }, upisiAktivnost: false });
  });
  return result;
}

export async function runDailySepAutomation(now = new Date()) {
  const { day, due } = sepAutomationDay(now);
  if (!due || process.env.SEP_AUTOMATION_ENABLED === "false") return;
  return withSepAutomationLock(async alive => {
    const stop = Date.now() + 5 * 60 * 60 * 1000;
    const configs = await prisma.sepAutomatikaPodesavanje.findMany({ where: { aktivna: true, firma: { aktivan: true, is_deleted: false }, agencija: { aktivan: true, is_deleted: false, is_fiscal_direct_container: false } }, orderBy: [{ agencija_id: "asc" }, { firma_id: "asc" }] });
    for (const config of configs) {
      await alive();
      if (Date.now() > stop) break;
      const first = `${day.slice(0, 7)}-01`;
      // If the server was offline on the first, recover that scheduled run first.
      if (day !== first && config.updated_at <= sepAutomationScheduledAt(first)) await prisma.sepAutomatikaObrada.createMany({ data: { agencija_id: config.agencija_id, firma_id: config.firma_id, dan: dayDate(first) }, skipDuplicates: true });
      // A firm enabled after today's 04:00 starts next night, unless explicitly queued by its admin.
      if (config.updated_at <= sepAutomationScheduledAt(day)) await prisma.sepAutomatikaObrada.createMany({ data: { agencija_id: config.agencija_id, firma_id: config.firma_id, dan: dayDate(day) }, skipDuplicates: true });
      const jobs = await prisma.sepAutomatikaObrada.findMany({ where: { firma_id: config.firma_id, agencija_id: config.agencija_id, dan: { lte: dayDate(day) }, status: { in: ["PENDING", "RUNNING"] } }, orderBy: { dan: "asc" } });
      for (const job of jobs) {
        await alive();
        if (Date.now() > stop) break;
        try { await processSepAutomationCompany(config, job.dan.toISOString().slice(0, 10), alive); }
        catch { await alive(); console.error("SEP automatika: obrada firme prekinuta; nezavršeni posao ostaje za nastavak."); }
      }
    }
  });
}

export function startSepAutomation() {
  const state = globalThis as typeof globalThis & { sepAutomationTimer?: ReturnType<typeof setInterval>; sepAutomationBusy?: boolean };
  if (state.sepAutomationTimer) return;
  const tick = async () => {
    if (state.sepAutomationBusy) return;
    state.sepAutomationBusy = true;
    try { await runDailySepAutomation(); } catch { console.error("SEP automatika trenutno nije dostupna; slijedi ponovni pokušaj."); }
    finally { state.sepAutomationBusy = false; }
  };
  state.sepAutomationTimer = setInterval(() => { void tick(); }, 60000);
  state.sepAutomationTimer.unref();
  void tick();
}
