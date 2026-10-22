import "server-only";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

/** Only settings may cross this boundary, never documents, account IDs or access rights. */
export async function companyPostingTemplate(db: Db, companyId: string) {
  const company = await db.firma.findFirst({
    where: { id: companyId, aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false } },
    select: { agencija_id: true, agencija: { select: { knjizenjeTemplate: { select: { firma: { select: { id: true, naziv: true, agencija_id: true, aktivan: true, is_deleted: true } } } } } } }
  });
  const source = company?.agencija?.knjizenjeTemplate?.firma;
  return source && source.id !== companyId && source.agencija_id === company?.agencija_id && source.aktivan && !source.is_deleted ? source : null;
}

const defaultKey = (row: { namjena: string; dokument_tip: string; podvrsta: string; pdv_stopa_sifra: string }) =>
  JSON.stringify([row.namjena, row.dokument_tip, row.podvrsta, row.pdv_stopa_sifra]);

/** Local rows (including deliberately empty/disabled choices) win by their full business key. */
export async function effectiveDefaultAccounts<T extends Prisma.FirmaPodrazumijevanoKontoFindManyArgs>(db: Db, args: Prisma.SelectSubset<T, Prisma.FirmaPodrazumijevanoKontoFindManyArgs>): Promise<Prisma.FirmaPodrazumijevanoKontoGetPayload<T>[]> {
  const local = await db.firmaPodrazumijevanoKonto.findMany(args);
  const companyId = args.where?.firma_id;
  if (typeof companyId !== "string") return local;
  const source = await companyPostingTemplate(db, companyId);
  if (!source) return local;
  // Full keys must be read even when a caller selects just account code/name.
  const baseArgs: Prisma.FirmaPodrazumijevanoKontoFindManyArgs = args;
  const query: Prisma.FirmaPodrazumijevanoKontoFindManyArgs = { ...baseArgs, select: baseArgs.select ? { ...baseArgs.select, namjena: true, dokument_tip: true, podvrsta: true, pdv_stopa_sifra: true, komitent_id: true } : undefined };
  const [own, inherited] = await Promise.all([
    db.firmaPodrazumijevanoKonto.findMany(query),
    db.firmaPodrazumijevanoKonto.findMany({ ...query, where: { ...baseArgs.where, firma_id: source.id } })
  ]);
  const rows = new Map(own.map(row => [defaultKey(row), row]));
  for (const row of inherited) {
    if (rows.has(defaultKey(row))) continue;
    if (row.komitent_id && !await db.komitent.findFirst({ where: { id: row.komitent_id, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: source.agencija_id }, { scope: "COMPANY", agencija_id: source.agencija_id, firma_id: companyId }] }, select: { id: true } })) continue;
    rows.set(defaultKey(row), { ...row, firma_id: companyId });
  }
  return [...rows.values()] as unknown as Prisma.FirmaPodrazumijevanoKontoGetPayload<T>[];
}
export async function effectiveDefaultAccount<T extends Prisma.FirmaPodrazumijevanoKontoFindManyArgs>(db: Db, args: Prisma.SelectSubset<T, Prisma.FirmaPodrazumijevanoKontoFindManyArgs>) {
  return (await effectiveDefaultAccounts(db, args))[0] ?? null;
}

export async function templateJournalType(db: Db, id: string | null, agencyId: string, companyId: string) {
  if (!id) return null;
  const type = await db.vrstaNaloga.findFirst({ where: { id, aktivan: true } });
  if (!type) return null;
  if ((type.firma_id === companyId && type.agencija_id === agencyId) || (!type.firma_id && (type.agencija_id === agencyId || (!type.agencija_id && type.sistemska)))) return type;
  // A company-specific type cannot be used on another company. Match a permitted
  // equivalent by prefix; do not silently bind a foreign company's ID.
  if (type.agencija_id !== agencyId || !type.prefiks) return null;
  return db.vrstaNaloga.findFirst({ where: { aktivan: true, prefiks: type.prefiks, OR: [{ firma_id: companyId, agencija_id: agencyId }, { firma_id: null, agencija_id: agencyId }, { firma_id: null, agencija_id: null, sistemska: true }] }, orderBy: { sifra: "asc" } });
}

/** Resolve inherited account codes in the TARGET chart; never return a template account ID. */
export async function templateAccount(db: Db, companyId: string, code?: string | null, materialize = false) {
  if (!code) return null;
  const own = await db.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: companyId, sifra: code } } });
  if (own) return own; // Deactivated local account must fail existing posting controls.
  const firm = await db.firma.findUnique({ where: { id: companyId }, select: { agencija_id: true } });
  if (!firm) return null;
  const agency = await db.agencijaKonto.findFirst({ where: { agencija_id: firm.agencija_id, sifra: code } });
  const base = agency ?? await db.konto.findUnique({ where: { sifra: code } });
  if (!base?.aktivan || base.tip_konta !== "analiticko" || code.length < 4) return null;
  if (!materialize) return { ...base, id: base.id, firma_id: companyId, override_type: "BASE_LINK", konto_id: null, agencija_konto_id: null, napomena: null };
  return db.firmaKonto.upsert({ where: { firma_id_sifra: { firma_id: companyId, sifra: code } }, update: {}, create: {
    firma_id: companyId, konto_id: agency ? null : base.id, agencija_konto_id: agency?.id ?? null,
    sifra: base.sifra, naziv: base.naziv, tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna,
    sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo, koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, override_type: agency ? "CUSTOM" : "BASE_LINK"
  } });
}

export async function effectiveInvoiceType(db: Db, companyId: string, typeId: string) {
  const own = await db.racunVrsta.findFirst({ where: { id: typeId, firma_id: companyId }, include: { kontiranjePravila: { orderBy: { redosljed: "asc" } } } });
  if (!own) return null;
  const source = await companyPostingTemplate(db, companyId);
  const inherited = source ? await db.racunVrsta.findFirst({ where: { firma_id: source.id, agencija_id: own.agencija_id, dokument_tip: own.dokument_tip, sifra: own.sifra, aktivna: true }, include: { kontiranjePravila: { orderBy: { redosljed: "asc" } } } }) : null;
  const rules = new Map(own.kontiranjePravila.map(row => [row.polje_sifra, row]));
  for (const row of inherited?.kontiranjePravila ?? []) if (!rules.has(row.polje_sifra)) rules.set(row.polje_sifra, row);
  const kind = own.vrsta_naloga_id ? null : await templateJournalType(db, inherited?.vrsta_naloga_id ?? null, own.agencija_id, companyId);
  return { ...own, vrsta_naloga_id: own.vrsta_naloga_id ?? kind?.id ?? null,
    kontiranjePravila: [...rules.values()].filter(row => row.aktivno), inherited: Boolean(inherited), templateName: source?.naziv ?? null };
}

export async function effectivePayrollSettings(db: Db, companyId: string, yearId: string, category: string, materialize = false) {
  const include = { vrsta_naloga: true, pravila: { include: { duguje_konto: true, potrazuje_konto: true }, orderBy: { redosljed: "asc" as const } } };
  const own = await db.plateKontiranjePodesavanje.findUnique({ where: { firma_id_poslovna_godina_id_kategorija: { firma_id: companyId, poslovna_godina_id: yearId, kategorija: category } }, include });
  const source = await companyPostingTemplate(db, companyId);
  const year = source ? await db.poslovnaGodina.findFirst({ where: { id: yearId, firma_id: companyId }, select: { godina: true } }) : null;
  const inherited = source && year ? (
    await db.plateKontiranjePodesavanje.findFirst({ where: { firma_id: source.id, agencija_id: source.agencija_id, kategorija: category, poslovna_godina: { godina: year.godina } }, include })
    ?? await db.plateKontiranjePodesavanje.findFirst({ where: { firma_id: source.id, agencija_id: source.agencija_id, kategorija: category }, include, orderBy: { poslovna_godina: { godina: "desc" } } })
  ) : null;
  if (!inherited) return own ? { ...own, inherited: false, pravila: own.pravila.map(rule => ({ ...rule, inherited: false })) } : null;
  const rules = new Map((own?.pravila ?? []).map(row => [row.komponenta, { ...row, inherited: false }]));
  for (const rule of inherited.pravila) {
    if (rules.has(rule.komponenta)) continue;
    const debit = await templateAccount(db, companyId, rule.duguje_konto?.sifra, materialize);
    const credit = await templateAccount(db, companyId, rule.potrazuje_konto?.sifra, materialize);
    rules.set(rule.komponenta, { ...rule, inherited: true, duguje_konto_id: debit?.id ?? null, duguje_konto: debit, potrazuje_konto_id: credit?.id ?? null, potrazuje_konto: credit });
  }
  const kind = own?.vrsta_naloga ?? await templateJournalType(db, inherited.vrsta_naloga_id, source!.agencija_id, companyId);
  return { ...(own ?? inherited), firma_id: companyId, poslovna_godina_id: yearId, inherited: true, vrsta_naloga_id: own?.vrsta_naloga_id ?? kind?.id ?? null, vrsta_naloga: kind, pravila: [...rules.values()] };
}

export async function effectivePdvSettings(db: Db, companyId: string, yearId: string, materialize = false) {
  const include = { vrsta_naloga: true, izlazni_pdv_konto: true, ulazni_pdv_konto: true, pravila: { include: { konto: true }, orderBy: { redosljed: "asc" as const } } };
  const own = await db.pdvPodesavanja.findUnique({ where: { firma_id_poslovna_godina_id: { firma_id: companyId, poslovna_godina_id: yearId } }, include });
  const source = await companyPostingTemplate(db, companyId);
  const year = source ? await db.poslovnaGodina.findFirst({ where: { id: yearId, firma_id: companyId }, select: { godina: true } }) : null;
  const inherited = source && year ? (
    await db.pdvPodesavanja.findFirst({ where: { firma_id: source.id, agencija_id: source.agencija_id, poslovna_godina: { godina: year.godina } }, include })
    ?? await db.pdvPodesavanja.findFirst({ where: { firma_id: source.id, agencija_id: source.agencija_id }, include, orderBy: { poslovna_godina: { godina: "desc" } } })
  ) : null;
  const rules = new Map((own?.pravila ?? []).map(rule => [rule.polje_sifra, { ...rule, inherited: false }]));
  for (const rule of inherited?.pravila ?? []) {
    if (rules.has(rule.polje_sifra)) continue;
    const account = await templateAccount(db, companyId, rule.konto?.sifra, materialize);
    rules.set(rule.polje_sifra, { ...rule, inherited: true, konto_id: account?.id ?? null, konto: account });
  }
  if (!own && !inherited) return null;
  const kind = own?.vrsta_naloga ?? await templateJournalType(db, inherited?.vrsta_naloga_id ?? null, source?.agencija_id ?? own?.agencija_id ?? "", companyId);
  return { ...(own ?? inherited!), firma_id: companyId, poslovna_godina_id: yearId, inherited: Boolean(inherited), vrsta_naloga_id: own?.vrsta_naloga_id ?? kind?.id ?? null, vrsta_naloga: kind, pravila: [...rules.values()].filter(rule => rule.aktivno) };
}

export async function effectiveTravelSettings(db: Db, companyId: string) {
  const own = await db.putniPodesavanje.findUnique({ where: { firma_id: companyId } });
  const source = await companyPostingTemplate(db, companyId);
  const inherited = source ? await db.putniPodesavanje.findFirst({ where: { firma_id: source.id, agencija_id: source.agencija_id } }) : null;
  if (!inherited) return own;
  const raw = inherited.podaci as Record<string, Prisma.JsonValue>;
  const local = (own?.podaci ?? {}) as Record<string, Prisma.JsonValue>;
  const posting = raw.knjizenje as Record<string, string> | undefined;
  const ownPosting = local.knjizenje as Record<string, string> | undefined;
  const kind = await templateJournalType(db, posting?.vrstaNaloga ?? null, source!.agencija_id, companyId);
  // Only the posting scheme is inherited; rates, location and travel policies stay local.
  const { travelDefaults } = await import("./travel-orders");
  const podaci = { ...travelDefaults, ...local, knjizenje: { ...posting, vrstaNaloga: kind?.id ?? "", ...ownPosting } };
  return { ...(own ?? inherited), firma_id: companyId, podaci: podaci as unknown as Prisma.JsonValue };
}

function bankRuleKey(rule: { rule_type: string; direction: string; counterparty_account_number_normalized: string | null; description_contains: string | null; reference_contains: string | null; payment_code: string | null }) {
  return JSON.stringify([rule.rule_type, rule.direction, rule.counterparty_account_number_normalized, rule.description_contains?.trim().toLowerCase(), rule.reference_contains?.trim().toLowerCase(), rule.payment_code]);
}
export async function effectiveBankRules(db: Db, agencyId: string, companyId: string) {
  const include = { account: { select: { id: true, sifra: true, analitika_obavezna: true } } };
  const own = await db.bankPostingRule.findMany({ where: { agencija_id: agencyId, OR: [{ firma_id: companyId }, { firma_id: null }] }, include });
  const source = await companyPostingTemplate(db, companyId);
  const inherited = source?.agencija_id === agencyId ? await db.bankPostingRule.findMany({ where: { agencija_id: agencyId, firma_id: source.id, active: true, auto_apply: true }, include }) : [];
  const localKeys = new Set(own.filter(rule => rule.firma_id === companyId).map(bankRuleKey));
  const rows = own.map(rule => ({ ...rule, inherited: false }));
  for (const rule of inherited) {
    if (localKeys.has(bankRuleKey(rule))) continue;
    if (rule.partner_id && !await db.komitent.findFirst({ where: { id: rule.partner_id, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: agencyId }, { scope: "COMPANY", agencija_id: agencyId, firma_id: companyId }] }, select: { id: true } })) continue;
    rows.push({ ...rule, firma_id: null, inherited: true });
  }
  return rows.filter(rule => rule.active && rule.auto_apply);
}

export async function effectiveBankSetting(db: Db, companyId: string, bankId: string, materialize = false) {
  const include = { bank_account_konto: true, journal_type: true };
  const own = await db.bankStatementAccountSetting.findUnique({ where: { firma_id_company_bank_account_id: { firma_id: companyId, company_bank_account_id: bankId } }, include });
  const source = await companyPostingTemplate(db, companyId);
  if (!source || (own?.bank_account_konto_id && own.journal_type_id)) return own ? { ...own, inherited: false } : null;
  const bank = await db.firmaBankovniRacun.findFirst({ where: { id: bankId, firma_id: companyId, agencija_id: source.agencija_id, aktivan: true, is_deleted: false } });
  if (!bank) return own ? { ...own, inherited: false } : null;
  const rows = await db.bankStatementAccountSetting.findMany({ where: { firma_id: source.id, agencija_id: source.agencija_id, company_bank_account: { firma_id: source.id, agencija_id: source.agencija_id, aktivan: true, is_deleted: false } }, include: { ...include, company_bank_account: true } });
  const normal = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const matches = rows.filter(row => normal(row.company_bank_account.naziv_banke) === normal(bank.naziv_banke));
  // Multiple accounts at one bank may use different schemes: ambiguity requires local setup.
  const signatures = new Set(matches.map(row => JSON.stringify([row.bank_account_konto?.sifra ?? null, row.journal_type_id])));
  if (signatures.size !== 1) return own ? { ...own, inherited: false } : null;
  const { company_bank_account: sourceBank, ...inherited } = matches[0];
  if (sourceBank.firma_id !== source.id) return own ? { ...own, inherited: false } : null;
  const account = own?.bank_account_konto ?? await templateAccount(db, companyId, inherited.bank_account_konto?.sifra, materialize);
  const kind = own?.journal_type ?? await templateJournalType(db, inherited.journal_type_id, source.agencija_id, companyId);
  return { ...(own ?? inherited), inherited: true, firma_id: companyId, company_bank_account_id: bankId, bank_account_konto_id: account?.id ?? null, bank_account_konto: account, journal_type_id: kind?.id ?? null, journal_type: kind };
}

export async function effectiveAssetCategories(db: Db, agencyId: string, companyId: string) {
  const include = { konto_sredstva: true, konto_ispravke: true, konto_troska: true, konto_neotpisane_vrijednosti: true };
  const own = await db.osKategorija.findMany({ where: { agencija_id: agencyId, firma_id: companyId }, include, orderBy: { sifra: "asc" } });
  const source = await companyPostingTemplate(db, companyId);
  const inherited = source?.agencija_id === agencyId ? await db.osKategorija.findMany({ where: { agencija_id: agencyId, firma_id: source.id, aktivna: true, is_deleted: false }, include, orderBy: { sifra: "asc" } }) : [];
  const rows = new Map(own.map(row => [row.sifra, { ...row, inherited: false }]));
  for (const row of inherited) {
    const local = rows.get(row.sifra);
    if (local && (!local.aktivna || local.is_deleted)) continue;
    rows.set(row.sifra, { ...row, ...local, inherited: true,
      konto_sredstva: local?.konto_sredstva ?? row.konto_sredstva,
      konto_ispravke: local?.konto_ispravke ?? row.konto_ispravke,
      konto_troska: local?.konto_troska ?? row.konto_troska,
      konto_neotpisane_vrijednosti: local?.konto_neotpisane_vrijednosti ?? row.konto_neotpisane_vrijednosti });
  }
  return [...rows.values()].filter(row => row.aktivna && !row.is_deleted).sort((a,b) => a.sifra.localeCompare(b.sifra));
}

export async function resolveTemplateAssetCategory(db: Db, agencyId: string, companyId: string, categoryId: string, userId: string) {
  const category = (await effectiveAssetCategories(db, agencyId, companyId)).find(row => row.id === categoryId);
  if (!category) return null;
  const local = category.firma_id === companyId ? category : await db.osKategorija.upsert({ where: { firma_id_sifra: { firma_id: companyId, sifra: category.sifra } }, update: {}, create: { agencija_id: agencyId, firma_id: companyId, sifra: category.sifra, naziv: category.naziv, created_by: userId, updated_by: userId } });
  if (!local.aktivna || local.is_deleted) return null;
  const [asset, accumulated, expense] = await Promise.all([
    templateAccount(db, companyId, category.konto_sredstva?.sifra, true),
    templateAccount(db, companyId, category.konto_ispravke?.sifra, true),
    templateAccount(db, companyId, category.konto_troska?.sifra, true)
  ]);
  return { ...local, konto_sredstva_id: asset?.id ?? null, konto_ispravke_id: accumulated?.id ?? null, konto_troska_id: expense?.id ?? null };
}
