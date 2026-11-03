import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { auditLogInTransaction } from "@/lib/audit";
import { formatJournalCode } from "@/lib/journals";
import { closingComparison, importFail, importName, openingTotals, parsePrimatechClosing, parsePrimatechOpening, parsePrimatechPartners, primatechRows, type OpeningImportData } from "@/lib/primatech-opening";
import { buildEpsilonOpening } from "@/lib/epsilon-opening";

export type ImportActor = { userId: string; agencyId: string; companyId: string; yearId: string };
type Proof = { actor: ImportActor; expires: number; data: OpeningImportData };
export type ImportChoices = { accounts: Record<string, string>; partners: Record<string, string>; unitId: string; confirmed: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function openingImportActor(): Promise<ImportActor> {
  const user = await getCurrentUser(), context = await readWorkContext();
  if (!user || isDirectFiscalTenantUser(user) || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) importFail("Prijavite se i izaberite firmu i poslovnu godinu.");
  return { userId: user.id, agencyId: user.agencija_id, companyId: context.firmaId, yearId: context.poslovnaGodinaId };
}

async function access(tx: Prisma.TransactionClient, actor: ImportActor) {
  const user = await tx.korisnik.findFirst({ where: { id: actor.userId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false } } });
  if (!user) importFail("Korisnički pristup više nije dostupan.");
  const year = await tx.poslovnaGodina.findFirst({ where: { id: actor.yearId, firma_id: actor.companyId, firma: {
    agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
  } }, include: { firma: true } });
  if (!year) importFail("Nemate pristup firmi i poslovnoj godini.");
  if (user.rola !== "admin_agencije") for (const akcija of ["view", "create"]) {
    if (!await tx.korisnikPravo.findFirst({ where: { korisnik_id: user.id, agencija_id: actor.agencyId, firma_id: actor.companyId, modul: "nalozi", akcija, dozvoljeno: true } })) importFail("Potrebna su prava pregleda i kreiranja naloga.");
  }
  if (year.zakljucena) importFail("Poslovna godina je zaključana.");
  return year;
}

const partnerScope = (actor: ImportActor): Prisma.KomitentWhereInput => ({ aktivan: true, OR: [
  { scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: actor.agencyId },
  { scope: "COMPANY", agencija_id: actor.agencyId, firma_id: actor.companyId }
] });

async function accounts(tx: Prisma.TransactionClient, actor: ImportActor) {
  const [base, local] = await Promise.all([
    tx.konto.findMany(), tx.firmaKonto.findMany({ where: { firma_id: actor.companyId } })
  ]);
  return mergeCompanyAccountPlan(base, local).filter(a => a.aktivan && a.source !== "deactivated" && a.tip_konta === "analiticko" && a.sifra.length >= 4 &&
    !local.some(l => l.sifra === a.sifra && (!l.aktivan || l.override_type === "DEACTIVATED")));
}

export async function openingImportOptions() {
  const actor = await openingImportActor();
  return prisma.$transaction(async tx => {
    const year = await access(tx, actor);
    const existing = await tx.nalog.findFirst({ where: { firma_id: actor.companyId, poslovna_godina_id: actor.yearId, is_deleted: false, vrsta_naloga: { sifra: "OPENING_BALANCE" } }, select: { id: true } });
    const units = await tx.poslovnaJedinica.findMany({ where: { agencija_id: actor.agencyId, firma_id: actor.companyId, aktivna: true, is_deleted: false }, select: { id: true, sifra: true, naziv: true }, orderBy: { sifra: "asc" } });
    return { company: year.firma.naziv, companyId: actor.companyId, yearId: actor.yearId, year: year.godina, existingId: existing?.id ?? null,
      accounts: (await accounts(tx, actor)).map(a => ({ code: a.sifra, name: a.naziv, partnerRequired: a.analitika_obavezna, unitRequired: a.koristi_radnu_jedinicu })), units };
  });
}
export type OpeningImportOptions = Awaited<ReturnType<typeof openingImportOptions>>;

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) importFail("Nedostaje serverska postavka za potpis pregleda.");
  return createHmac("sha256", secret).update(`primatech-opening:v1:${payload}`).digest("base64url");
}
export function signOpeningImport(proof: Proof) {
  const payload = Buffer.from(JSON.stringify(proof)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function readOpeningImport(token: string, actor: ImportActor): Proof {
  if (typeof token !== "string" || token.length > 1500000) importFail("Pregled uvoza nije ispravan.");
  const [payload, signed, extra] = token.split(".");
  if (!payload || !signed || extra) importFail("Ponovo učitajte fajlove za pregled.");
  const expected = Buffer.from(signature(payload)), actual = Buffer.from(signed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) importFail("Pregled je izmijenjen. Ponovo učitajte fajlove.");
  let proof: Proof;
  try { proof = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { importFail("Pregled nije ispravan."); }
  if (proof.expires < Date.now() || Object.keys(actor).some(k => actor[k as keyof ImportActor] !== proof.actor[k as keyof ImportActor])) importFail("Pregled je istekao ili je promijenjena firma/godina. Ponovite pregled.");
  return proof;
}

export async function previewOpeningImport(form: FormData) {
  const actor = await openingImportActor();
  // Authorize before parsing untrusted uploads.
  const year = await prisma.$transaction(tx => access(tx, actor));
  if (form.get("companyId") !== actor.companyId || form.get("yearId") !== actor.yearId) importFail("Promijenjen je radni kontekst. Osvježite stranicu.");
  const files: OpeningImportData["files"] = [];
  let totalSize = 0;
  async function rows(key: string, required = false) {
    const file = form.get(key);
    if (!(file instanceof File) || !file.size) {
      if (required) importFail("Dodajte obavezni izvorni Excel izvještaj.");
      return null;
    }
    totalSize += file.size;
    if (file.size > 5 * 1024 * 1024 || totalSize > 10 * 1024 * 1024 || !/\.(xls|xlsx)$/i.test(file.name)) importFail("Dozvoljen je Excel do 5 MB po fajlu i 10 MB ukupno.");
    const buffer = Buffer.from(await file.arrayBuffer());
    files.push({ name: file.name.slice(0, 180), hash: createHash("sha256").update(buffer).digest("hex") });
    return primatechRows(buffer);
  }
  const format = String(form.get("format") ?? "PRIMATECH_V1");
  let data: OpeningImportData;
  if (format === "EPSILON_V1") {
    if (form.get("sourceConfirmed") !== "on") importFail("Potvrdite firmu i datum Epsilon izvještaja, jer ih fajlovi ne sadrže.");
    const basis = String(form.get("basis") ?? "");
    if (basis !== "OPENING" && basis !== "CLOSING") importFail("Izaberite koje Epsilon kolone prenosite.");
    data = buildEpsilonOpening({ ledger: (await rows("ledger", true))!, suppliers: await rows("suppliers"), customers: await rows("customers"),
      supplierAccount: String(form.get("supplierAccount") ?? ""), customerAccount: String(form.get("customerAccount") ?? ""),
      basis, reportDate: String(form.get("reportDate") ?? ""), company: year.firma.naziv, year: year.godina });
    data.files = files;
  } else if (format === "PRIMATECH_V1") {
    const opening = parsePrimatechOpening((await rows("opening", true))!);
    if (opening.date !== year.datum_od.toISOString().slice(0, 10) || opening.date !== `${year.godina}-01-01`) importFail(`Nalog mora imati datum 01.01.${year.godina}.`);
    const suppliers = await rows("suppliers"), customers = await rows("customers"), closing = await rows("closing");
    data = { ...opening, format: "PRIMATECH_V1", partners: [...(suppliers ? parsePrimatechPartners(suppliers) : []), ...(customers ? parsePrimatechPartners(customers) : [])], closing: closing ? parsePrimatechClosing(closing) : [], files };
  } else importFail("Izabrani program još nije podržan.");
  const sourceNames = [...new Set(data.lines.filter(l => l.partner).map(l => l.partner))];
  const partnerSuggestions = await prisma.$transaction(async tx => {
    await access(tx, actor);
    const result = [];
    // Exact PIB only, bounded by the partners actually present in this journal.
    for (const name of sourceNames) {
      const entries = data.partners.filter(p => importName(p.name) === importName(name));
      const pibs = [...new Set(entries.map(p => p.pib).filter((p): p is string => Boolean(p)))];
      const pib = pibs.length === 1 ? pibs[0] : null;
      const matches = pib ? await tx.komitent.findMany({ where: { ...partnerScope(actor), pib }, take: 2, select: { id: true, naziv: true, pib: true, scope: true } }) : [];
      const match = matches.length === 1 ? matches[0] : null;
      result.push({ name, pib, ambiguous: pibs.length > 1 || matches.length > 1, partner: match ? { ...match, label: `${match.naziv}${match.pib ? ` · ${match.pib}` : ""}` } : null });
    }
    return result;
  });
  const totals = openingTotals(data.lines);
  const warnings = [
    ...(importName(data.company) !== importName(year.firma.naziv) ? [`Naziv firme u fajlu „${data.company}” razlikuje se od izabrane firme „${year.firma.naziv}”. Provjerite da su podaci za ovu firmu.`] : []),
    ...(totals.difference ? ["Nalog nije uravnotežen. Iznosi ostaju izvorni; nacrt se mora ispraviti prije knjiženja."] : []),
    ...(data.format === "EPSILON_V1" ? [
      `Epsilon: prenose se ${data.epsilon!.basis === "OPENING" ? "kolone POČETNO STANJE (C/D)" : "završne kolone SALDO (I/J)"} iz izvještaja na ${data.epsilon!.reportDate}. Promet se ne uvozi.`,
      "Epsilon I.D. je interna šifra, nije PIB. Partnere povežite ručno; kupci/dobavljači zamjenjuju zbirni saldo konta i ne knjiže se drugi put.",
      ...data.epsilon!.blocked
    ] : data.closing.length ? ["Zaključni list se poredi po izvornim šiframa konta. Provjerite datum 31.12. prethodne godine i firmu: ovaj format ih ne sadrži. Promjene konta i razlike provjerite ručno."] : []),
    "Prenose se salda, bez razrade starih računa i bez ponovnog obračuna PDV-a. Partneri se ne kreiraju automatski."
  ];
  return { data, totals, warnings, comparison: data.closing.length ? closingComparison(data) : [], partnerSuggestions,
    token: signOpeningImport({ actor, data, expires: Date.now() + 30 * 60 * 1000 }) };
}
export type OpeningImportPreview = Awaited<ReturnType<typeof previewOpeningImport>>;

export async function commitOpeningImport(token: string, choices: ImportChoices) {
  const actor = await openingImportActor(), { data } = readOpeningImport(token, actor);
  if (!choices || choices.confirmed !== true || !choices.accounts || !choices.partners || typeof choices.unitId !== "string") importFail("Potvrdite pregled i povezivanje podataka.");
  if (data.epsilon?.blocked.length) importFail(data.epsilon.blocked.join(" "));
  return prisma.$transaction(async tx => {
    // Same company -> year -> opening-balance advisory lock as other creation paths.
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${actor.companyId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${actor.yearId}::uuid FOR UPDATE`;
    const year = await access(tx, actor);
    if (data.date !== year.datum_od.toISOString().slice(0, 10) || data.date !== `${year.godina}-01-01`) importFail("Datum početnog stanja ne odgovara godini.");
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${actor.companyId}), hashtext(${actor.yearId}))`);
    const periods = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM pdv_periodi WHERE firma_id=${actor.companyId}::uuid AND datum_od<=${year.datum_od}::date AND datum_do>=${year.datum_od}::date FOR UPDATE`;
    if (periods.some(p => p.status === "LOCKED")) importFail("PDV period je zaključan.");
    if (await tx.nalog.findFirst({ where: { firma_id: actor.companyId, poslovna_godina_id: actor.yearId, is_deleted: false, vrsta_naloga: { sifra: "OPENING_BALANCE" } } })) importFail("Za ovu firmu i godinu već postoji početno stanje. Novi uvoz nije dozvoljen.");
    const type = await tx.vrstaNaloga.findFirst({ where: { sifra: "OPENING_BALANCE", aktivan: true, OR: [{ sistemska: true }, { agencija_id: actor.agencyId, firma_id: null }, { agencija_id: actor.agencyId, firma_id: actor.companyId }] } });
    if (!type) importFail("Nedostaje aktivna vrsta naloga Početno stanje.");
    if (choices.unitId && (!uuid.test(choices.unitId) || !await tx.poslovnaJedinica.findFirst({ where: { id: choices.unitId, firma_id: actor.companyId, agencija_id: actor.agencyId, aktivna: true, is_deleted: false } }))) importFail("Poslovna jedinica nije dostupna.");
    const available = await accounts(tx, actor);
    const resolved = new Map<string, string>();
    const lines = [];
    for (const line of data.lines) {
      const code = choices.accounts[line.account];
      const selected = available.find(a => a.sifra === code);
      if (!selected) importFail(`Povežite konto ${line.account} sa aktivnim analitičkim kontom.`);
      if (data.format === "EPSILON_V1" && selected.analitika_obavezna && !data.epsilon?.expandedAccounts.includes(line.account)) importFail(`Konto ${line.account} zahtijeva izvornu razradu po partnerima. Zbirni saldo se ne može dodijeliti jednom proizvoljnom partneru.`);
      if (selected.koristi_radnu_jedinicu && !choices.unitId) importFail(`Konto ${code} zahtijeva poslovnu jedinicu.`);
      const partnerId = choices.partners[line.partner || `row:${line.row}`] || null;
      if ((line.partner || selected.analitika_obavezna) && !partnerId) importFail(`Izaberite partnera za stavku ${line.row}.`);
      if (partnerId && (!uuid.test(partnerId) || !await tx.komitent.findFirst({ where: { id: partnerId, ...partnerScope(actor) }, select: { id: true } }))) importFail(`Partner stavke ${line.row} nije dostupan.`);
      let accountId = resolved.get(code);
      if (!accountId) {
        const local = await tx.firmaKonto.upsert({ where: { firma_id_sifra: { firma_id: actor.companyId, sifra: code } }, update: {}, create: {
          firma_id: actor.companyId, konto_id: selected.baseAccountId, sifra: code, naziv: selected.naziv, tip_konta: selected.tip_konta,
          analitika_obavezna: selected.analitika_obavezna, sinteticki_konto: selected.sinteticki_konto, normalni_saldo: selected.normalni_saldo,
          koristi_radnu_jedinicu: selected.koristi_radnu_jedinicu, override_type: "BASE_LINK", aktivan: true
        } });
        accountId = local.id;
        resolved.set(code, accountId);
      }
      lines.push({ konto_id: accountId, komitent_id: partnerId, poslovna_jedinica_id: choices.unitId || null,
        duguje: (line.debit / 100).toFixed(2), potrazuje: (line.credit / 100).toFixed(2), opis: line.description,
        datum_dokumenta: year.datum_od, redni_broj: line.row, created_by: actor.userId, updated_by: actor.userId });
    }
    const last = await tx.nalog.findFirst({ where: { firma_id: actor.companyId, poslovna_godina_id: actor.yearId, vrsta_naloga_id: type.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({ data: {
      agencija_id: actor.agencyId, firma_id: actor.companyId, poslovna_godina_id: actor.yearId, vrsta_naloga_id: type.id,
      poslovna_jedinica_id: choices.unitId || null, broj: number, sifra: formatJournalCode(type.prefiks, year.godina, number), datum: year.datum_od,
      opis: data.format === "EPSILON_V1" ? `Početno stanje — Epsilon ${data.company}, ${data.epsilon!.reportDate}, ${data.epsilon!.basis === "OPENING" ? "početne kolone" : "završni saldo"}` : `Početno stanje — Primatech ${data.company}, izvorni nalog ${data.number}`,
      status: "DRAFT", source_type: "OPENING_BALANCE", source_module: "nalozi", kreirao_korisnik_id: actor.userId,
      created_by: actor.userId, updated_by: actor.userId, stavke: { create: lines }
    }, select: { id: true } });
    await auditLogInTransaction(tx, { korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: actor.companyId,
      modul: "agencija.nalozi", akcija: "import_opening_balance", tipEntiteta: "Nalog", entitetId: journal.id,
      novaVrijednost: { format: data.format ?? "PRIMATECH_V1", files: data.files, source: data, choices, totals: openingTotals(data.lines), comparison: closingComparison(data), status: "DRAFT" } });
    return journal;
  }, { timeout: 30000 });
}
