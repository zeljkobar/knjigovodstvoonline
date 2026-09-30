import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { calculateAssetPeriods, type FixedAssetCalculationLine } from "./fixed-assets-calculation";
import { parameterInput, usageInput } from "./fixed-assets-input";
import { fixedAssetDecimalToCents, fixedAssetDepreciationEligibility } from "./fixed-assets";

export const assetDate = (date: Date) => date.toISOString().slice(0, 10);
export const assetDay = (date: Date, offset: number) => new Date(date.getTime() + offset * 86400000);
export type AssetBatchScope = { agencija_id: string; firma_id: string; poslovna_godina_id: string };
export type AssetBatchSnapshot = {
  schema_version: 1;
  debitOverride: string | null;
  creditOverride: string | null;
  totalCents: number;
  excluded: { name: string; reason: string }[];
  postingErrors: string[];
  coverage: { assetId: string; from: string; to: string; firstDate: string }[];
  lines: (FixedAssetCalculationLine & {
    name: string; debit: string | null; credit: string | null;
    debitLabel: string; creditLabel: string; partner: string | null; unit: string | null;
  })[];
};

export async function buildAssetBatch(tx: Prisma.TransactionClient, scope: AssetBatchScope, from: Date, to: Date, debitOverride: string | null = null, creditOverride: string | null = null) {
  const assets = await tx.osnovnoSredstvo.findMany({
    where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, is_deleted: false }, orderBy: { id: "asc" },
    include: {
      parametri: { orderBy: { vazi_od: "asc" } },
      ucinci: { where: { is_deleted: false, datum_od: { lte: to } }, orderBy: [{ datum_od: "asc" }, { id: "asc" }] },
      promjene: { where: { status: "CONFIRMED", is_deleted: false }, orderBy: [{ datum: "asc" }, { id: "asc" }] }
    }
  });
  const ids = [...new Set([debitOverride, creditOverride, ...assets.flatMap(a => a.parametri.flatMap(p => [p.konto_troska_id, p.konto_ispravke_id]))].filter((id): id is string => Boolean(id)))];
  const accounts = await tx.firmaKonto.findMany({ where: { id: { in: ids }, firma_id: scope.firma_id }, orderBy: { id: "asc" } });
  if ([debitOverride, creditOverride].some(id => id && !accounts.some(a => a.id === id))) throw new Error("Konto ne pripada izabranoj firmi.");
  const partners = await tx.komitent.findMany({ where: { id: { in: assets.flatMap(a => a.parametri.flatMap(p => p.komitent_id ? [p.komitent_id] : [])) }, OR: [{ agencija_id: null }, { agencija_id: scope.agencija_id, firma_id: null }, { agencija_id: scope.agencija_id, firma_id: scope.firma_id }] }, select: { id: true }, orderBy: { id: "asc" } });
  const units = await tx.poslovnaJedinica.findMany({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, aktivna: true, is_deleted: false }, select: { id: true }, orderBy: { id: "asc" } });
  const snapshot: AssetBatchSnapshot = { schema_version: 1, debitOverride, creditOverride, totalCents: 0, excluded: [], postingErrors: [], coverage: [], lines: [] };
  for (const asset of assets) {
    const name = `${asset.inventarski_broj} · ${asset.naziv}`;
    if (!["ACTIVE", "DISPOSED"].includes(asset.status) || fixedAssetDepreciationEligibility(asset.vrsta_imovine) === "EXCLUDED") {
      snapshot.excluded.push({ name, reason: asset.vrsta_imovine === "LAND" ? "Zemljište se ne amortizuje." : "Sredstvo nije aktivirano." });
      continue;
    }
    const first = asset.parametri[0]?.vazi_od;
    if (first && (first > to || asset.datum_isknjizenja && asset.datum_isknjizenja <= from)) {
      snapshot.excluded.push({ name, reason: "Van perioda korišćenja." }); continue;
    }
    if (fixedAssetDepreciationEligibility(asset.vrsta_imovine) !== "SUPPORTED" || !asset.datum_raspolozivosti || !first || asset.promjene.some(c => !["OPENING", "ACQUISITION", "SALE"].includes(c.vrsta))) throw new Error(`${name}: provjerite vrstu imovine, datume i početne podatke.`);
    const grossCents = asset.promjene.filter(p=>p.vrsta!=="SALE").reduce((sum, p) => sum + fixedAssetDecimalToCents(p.delta_nabavna_vrijednost)!, 0);
    const accumulatedCents = asset.promjene.filter(p=>p.vrsta!=="SALE").reduce((sum, p) => sum + fixedAssetDecimalToCents(p.delta_ispravka_vrijednosti)!, 0);
    const result = calculateAssetPeriods({ assetId: asset.id, grossCents, accumulatedCents, availableDate: assetDate(asset.datum_raspolozivosti), disposalDate: asset.datum_isknjizenja ? assetDate(asset.datum_isknjizenja) : null, periodFrom: assetDate(from), periodTo: assetDate(to), parameters: asset.parametri.map(parameterInput), usage: asset.ucinci.map(usageInput) });
    if (result.errors.length) {
      const missing = result.errors.some(e => ["MISSING_USAGE", "INVALID_USAGE"].includes(e.code));
      throw new Error(`${name}: ${missing ? "dopunite učinak i uskladite njegove periode sa periodom obračuna" : "provjerite parametre amortizacije"}. ${result.errors.map(e => e.detail ?? "").join(" ")}`);
    }
    snapshot.coverage.push({ assetId: asset.id, from: assetDate(first > from ? first : from), to: assetDate(asset.datum_isknjizenja && asset.datum_isknjizenja <= to ? assetDay(asset.datum_isknjizenja, -1) : to), firstDate: assetDate(first) });
    for (const line of result.lines) {
      const p = asset.parametri.find(p => p.id === line.parameterId)!;
      const debit = debitOverride ?? p.konto_troska_id, credit = creditOverride ?? p.konto_ispravke_id;
      const d = accounts.find(a => a.id === debit), c = accounts.find(a => a.id === credit);
      if (line.amountCents > 0 && (!d || !c || debit === credit || [d, c].some(a => !a.aktivan || a.override_type === "DEACTIVATED" || a.tip_konta !== "analiticko" || a.analitika_obavezna && !partners.some(k => k.id === p.komitent_id) || a.koristi_radnu_jedinicu && !units.some(u => u.id === p.poslovna_jedinica_id)) || p.komitent_id && !partners.some(k => k.id === p.komitent_id) || p.poslovna_jedinica_id && !units.some(u => u.id === p.poslovna_jedinica_id))) snapshot.postingErrors.push(`${name}: podesite ispravna konta troška i ispravke, partnera ili poslovnu jedinicu.`);
      snapshot.lines.push({ ...line, name, debit, credit, debitLabel: d ? `${d.sifra} · ${d.naziv}` : "Nije podešeno", creditLabel: c ? `${c.sifra} · ${c.naziv}` : "Nije podešeno", partner: p.komitent_id, unit: p.poslovna_jedinica_id });
    }
    snapshot.totalCents += result.totalCents;
  }
  if (!snapshot.coverage.length) throw new Error("Nema aktivnih sredstava za izabrani period. Prvo unesite ili aktivirajte sredstvo.");
  if (!Number.isSafeInteger(snapshot.totalCents) || snapshot.totalCents > 99999999999999) throw new Error("Ukupan iznos prelazi dozvoljenu vrijednost.");
  snapshot.postingErrors = [...new Set(snapshot.postingErrors)];
  // Includes raw inputs and posting dimensions, not only the resulting amount.
  const hash = createHash("sha256").update(JSON.stringify({ scope, from, to, assets, accounts, partners, units, snapshot })).digest("hex");
  return { snapshot, hash };
}

export async function assertAssetHistoryUnposted(tx: Prisma.TransactionClient, assetId: string, from: Date) {
  if (await tx.osObracunPokrice.findFirst({ where: { sredstvo_id: assetId, aktivno: true, period_do: { gte: from } }, select: { id: true } })) throw new Error("POSTED_HISTORY");
}
