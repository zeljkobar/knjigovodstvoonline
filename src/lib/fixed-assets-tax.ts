import { parseFixedAssetMoney, parseFixedAssetDate } from "./fixed-assets";
export const TAX_RULES = "ME_2024_ANNUAL_DAYS_OPENING_REPAIRS_V1";
export const poolGroups = ["II", "III", "IV", "V"] as const;
export type PoolGroup = typeof poolGroups[number];
export type TaxAsset = { id: string; name: string; type: string; classification: string; available: string | null; disposed: string | null };
export type TaxInput = {
  schema: 1;
  openingSource: string;
  pools: { group: PoolGroup; opening: number; soldAll: boolean }[];
  assets: { id: string; classification: string; basis: number; previous: number; accounting: number; source: string }[];
  events: { id: string; group: string; assetId: string; kind: "PURCHASE" | "SALE" | "REPAIR"; date: string; amount: number; source: string }[];
};
export type TaxRow = { key: string; name: string; group: string; opening: number; purchases: number; sales: number; repairs: number; basis: number; rate: string; current: number; previous: number; total: number; closing: number; extraWriteOff: number; taxableIncome: number };
export type TaxResult = { rules: string; rows: TaxRow[]; errors: string[]; total: number; extraWriteOff: number; taxableIncome: number; specialTotal: number };
const MAX = 99999999999999;
function money(value: unknown): number {
  if (typeof value !== "string") throw new Error("Novčani iznos mora biti tekstualni zapis.");
  const cents = parseFixedAssetMoney(value);
  if (cents === null || cents < 0 || cents > MAX) throw new Error("Unesite nenegativne novčane iznose sa najviše dvije decimale.");
  return cents;
}
function text(value: unknown, max = 500): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Neispravan tekstualni podatak.");
  return value.trim();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Neispravni poreski podaci.");
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Previše ili neispravne stavke poreskog obračuna.");
  return value;
}
export function parseTaxInput(json: string): TaxInput {
  if (json.length > 2_000_000) throw new Error("Previše podataka u jednom unosu.");
  const raw = record(JSON.parse(json));
  const pools = array(raw.pools, 4).map(item => {
    const p = record(item), group = text(p.group);
    if (!poolGroups.includes(group as PoolGroup) || typeof p.soldAll !== "boolean") throw new Error("Neispravna poreska grupa.");
    return { group: group as PoolGroup, opening: money(p.opening), soldAll: p.soldAll };
  });
  if (pools.length !== 4 || new Set(pools.map(p => p.group)).size !== 4) throw new Error("Unesite početna stanja sve četiri grupe, uključujući nule.");
  const assets = array(raw.assets, 10000).map(item => {
    const a = record(item);
    return { id: text(a.id, 36), classification: text(a.classification, 30), basis: money(a.basis), previous: money(a.previous), accounting: money(a.accounting), source: text(a.source) };
  });
  const events = array(raw.events, 10000).map(item => {
    const e = record(item), kind = text(e.kind), date = text(e.date, 10);
    if (!["PURCHASE", "SALE", "REPAIR"].includes(kind) || !parseFixedAssetDate(date)) throw new Error("Neispravna vrsta ili datum poreske promjene.");
    const amount = money(e.amount), source = text(e.source);
    if (!amount || !source) throw new Error("Svaka poreska promjena zahtijeva iznos i izvorni dokument.");
    return { id: text(e.id, 60), group: text(e.group, 10), assetId: text(e.assetId, 36), kind: kind as TaxInput["events"][number]["kind"], date, amount, source };
  });
  if (new Set(assets.map(a => a.id)).size !== assets.length || new Set(events.map(e => e.id)).size !== events.length) throw new Error("Duplirane stavke poreskog obračuna.");
  const openingSource = text(raw.openingSource);
  if (!openingSource) throw new Error("Unesite dokument / izvor početnih poreskih stanja, i kada su sva stanja nula.");
  return { schema: 1, openingSource, pools, assets, events };
}
function sum(values: number[]) {
  const value = values.reduce((s, n) => s + n, 0);
  if (!Number.isSafeInteger(value) || value > MAX || value < 0) throw new Error("Ukupan iznos prelazi dozvoljeni raspon.");
  return value;
}
function rate(amount: number, basisPoints: number) { return Number((BigInt(amount) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000)); }
export function calculateTax(input: TaxInput, assets: TaxAsset[], from: string, to: string): TaxResult {
  const errors: string[] = [], rows: TaxRow[] = [];
  if (!/^\d{4}-01-01$/.test(from) || to !== `${from.slice(0,4)}-12-31`) errors.push("Podržana je puna kalendarska poreska godina.");
  if (Number(from.slice(0,4)) < 2025) errors.push("Ova verzija pravila podržava poreske godine od 2025. godine.");
  for (const asset of assets) {
    const a = input.assets.find(a => a.id === asset.id);
    if (!a || !a.classification || a.classification === "UNSUPPORTED") { errors.push(`${asset.name}: dopunite poresku klasifikaciju.`); continue; }
    if (a.classification === "EXEMPT" || poolGroups.includes(a.classification as PoolGroup)) continue;
    const events = input.events.filter(e => e.assetId === a.id);
    if (a.classification === "ACCOUNTING_AMOUNT") {
      const purchases = sum(events.filter(e => e.kind === "PURCHASE").map(e => e.amount));
      const basis = sum([a.basis,purchases]);
      if (!a.source) errors.push(`${asset.name}: navedite izvor godišnje računovodstvene amortizacije i stanja.`);
      if (a.previous > basis || a.accounting > basis-a.previous) { errors.push(`${asset.name}: ranija i tekuća amortizacija prelaze osnovicu.`); continue; }
      const disposal = asset.disposed && asset.disposed <= to ? asset.disposed : null;
      const sales = events.filter(e => e.kind === "SALE");
      if (events.some(e => e.kind === "REPAIR")) errors.push(`${asset.name}: ulaganje se uključuje tek po dokumentovanom računovodstvenom priznavanju u osnovicu; unesite ga kao povećanje osnovice (nabavku).`);
      if (sales.length > 1 || Boolean(disposal) !== Boolean(sales.length) || sales.some(e => e.date !== disposal)) errors.push(`${asset.name}: podržana je prodaja cijelog sredstva na datum isknjiženja iz registra.`);
      const removed = disposal ? basis-a.previous-a.accounting : 0;
      rows.push({ key: a.id, name: asset.name, group: "POSEBNO", opening: a.basis, purchases, sales: removed, repairs: 0, basis: basis-removed, rate: "—", current: a.accounting, previous: a.previous, total: sum([a.accounting,a.previous]), closing: basis-removed-a.previous-a.accounting, extraWriteOff: 0, taxableIncome: 0 });
      continue;
    }
    if (a.classification !== "I") { errors.push(`${asset.name}: nepoznat tretman.`); continue; }
    if (a.previous > a.basis) { errors.push(`${asset.name}: prethodna poreska amortizacija prelazi poresku nabavnu osnovicu.`); continue; }
    if (!a.source) errors.push(`${asset.name}: navedite izvor poreske osnovice i ranije amortizacije.`);
    const purchases = events.filter(e => e.kind === "PURCHASE");
    const repairEvents = events.filter(e => e.kind === "REPAIR");
    const sales = events.filter(e => e.kind === "SALE");
    const purchaseTotal = sum(purchases.map(e => e.amount));
    const gross = sum([a.basis,purchaseTotal]);
    const repairs = sum(repairEvents.map(e => e.amount));
    const capitalized = BigInt(repairs)*BigInt(20) > BigInt(gross) ? repairs : 0;
    const capitalEvents = [...purchases,...(capitalized ? repairEvents : [])];
    const fullBasis = sum([gross,capitalized]);
    const endExclusive = new Date(to).getTime()+86400000;
    const start = new Date(from).getTime();
    const yearDays = (endExclusive-start)/86400000;
    const disposal = asset.disposed && asset.disposed <= to ? asset.disposed : null;
    if (!asset.available) errors.push(`${asset.name}: nedostaje datum raspoloživosti.`);
    if (asset.available && asset.available > from && a.basis) errors.push(`${asset.name}: nabavku tokom godine unesite kao poresku promjenu, uz nultu početnu osnovicu.`);
    if (asset.available && asset.available > from && !purchases.length) errors.push(`${asset.name}: nedostaje poreska nabavka tokom godine.`);
    if (sales.length > 1 || Boolean(disposal) !== Boolean(sales.length) || sales.some(e => e.date !== disposal)) errors.push(`${asset.name}: podržana je prodaja cijelog sredstva na datum isknjiženja iz registra.`);
    if (capitalEvents.some(e => e.date < (asset.available ?? from) || disposal && e.date >= disposal)) errors.push(`${asset.name}: nabavka/ulaganje mora biti u periodu korišćenja.`);
    const stop = disposal ? new Date(disposal).getTime() : endExclusive;
    const days = (date:string) => Math.max(0,(stop-Math.max(start,new Date(date).getTime()))/86400000);
    // Daily fractions are summed before one rounding; disposal day is excluded.
    const weighted = BigInt(a.basis)*BigInt(days(asset.available ?? from)) + capitalEvents.reduce((n,e)=>n+BigInt(e.amount)*BigInt(days(e.date)),BigInt(0));
    const denominator=BigInt(yearDays)*BigInt(10000);
    const calculated=Number((weighted*BigInt(250)+denominator/BigInt(2))/denominator);
    const current=Math.min(Math.max(0,fullBasis-a.previous),calculated);
    const remaining=fullBasis-a.previous-current;
    // I-group disposal removes the remaining tax value; proceeds remain in the source event.
    const removed=disposal ? remaining : 0;
    rows.push({ key:a.id,name:asset.name,group:"I",opening:a.basis,purchases:sum([purchaseTotal,capitalized]),sales:removed,repairs,basis:fullBasis-removed,rate:"2,5",current,previous:a.previous,total:sum([current,a.previous]),closing:disposal?0:remaining,extraWriteOff:0,taxableIncome:0 });

  }
  for (const e of input.events) {
    if (e.date < from || e.date > to) errors.push("Poreska promjena je van izabrane godine.");
    if (e.group === "I" || e.group === "POSEBNO") {
      if (!input.assets.some(a => a.id === e.assetId && a.classification === (e.group === "I" ? "I" : "ACCOUNTING_AMOUNT"))) errors.push("Promjena I grupe nema odgovarajuće sredstvo.");
    } else if (!poolGroups.includes(e.group as PoolGroup) || e.assetId) errors.push("Grupna promjena mora pripadati grupi II–V.");
  }
  for (const p of input.pools) {
    const events = input.events.filter(e => e.group === p.group);
    const purchases = sum(events.filter(e => e.kind === "PURCHASE").map(e => e.amount));
    const sales = sum(events.filter(e => e.kind === "SALE").map(e => e.amount));
    const repairs = sum(events.filter(e => e.kind === "REPAIR").map(e => e.amount));
    // Agreed policy: opening tax balance; strictly over 5% capitalizes the whole repair amount.
    const capitalized = BigInt(repairs)*BigInt(20) > BigInt(p.opening) ? repairs : 0;
    if (p.soldAll && !sales) errors.push(`Grupa ${p.group}: prodaja svih sredstava zahtijeva evidentiranu prodaju.`);
    if (p.soldAll && events.some(e => e.kind !== "SALE" && e.date > (events.filter(s=>s.kind === "SALE").map(s=>s.date).sort().reverse()[0] ?? ""))) errors.push(`Grupa ${p.group}: postoji nabavka/ulaganje poslije prodaje svih sredstava.`);
    const available = sum([p.opening,purchases,capitalized]);
    const basis = Math.max(0, available-sales);
    const taxableIncome = Math.max(0, sales-available);
    const bps = { II: 1000, III: 1500, IV: 2000, V: 3000 }[p.group];
    const current = p.soldAll ? 0 : rate(basis,bps);
    const remainder = basis-current;
    // Article 9 applies to closing balance after ordinary depreciation; equality is excluded.
    const extraWriteOff = p.soldAll || remainder < 100000 ? remainder : 0;
    rows.push({ key: p.group, name: `Grupa ${p.group}`, group: p.group, opening: p.opening, purchases: sum([purchases,capitalized]), sales, repairs, basis, rate: String(bps/100), current, previous: 0, total: current, closing: remainder-extraWriteOff, extraWriteOff, taxableIncome });
  }
  sum(rows.flatMap(r=>[r.current,r.extraWriteOff]));
  return { rules: TAX_RULES, rows, errors: [...new Set(errors)], total: sum(rows.map(r => r.current)), extraWriteOff: sum(rows.map(r => r.extraWriteOff)), taxableIncome: sum(rows.map(r => r.taxableIncome)), specialTotal: sum(rows.filter(r => r.group === "POSEBNO").map(r => r.current)) };
}
