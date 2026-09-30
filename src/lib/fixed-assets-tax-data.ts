import { automaticTaxEvents, mergeTaxEvents } from "./fixed-assets-tax-events";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assetDate, type AssetBatchScope } from "./fixed-assets-batches";
import { calculateTax, poolGroups, type TaxAsset, type TaxInput, type TaxResult } from "./fixed-assets-tax";
import { parseTaxClassification, taxClassificationOptions } from "./fixed-assets-tax-groups";

export type TaxSnapshot = { schema: 1; from: string; to: string; company: string; pib: string; input: TaxInput; assets: TaxAsset[]; result: TaxResult; previousId: string | null };
export async function taxAssets(tx: Prisma.TransactionClient, scope: AssetBatchScope, from: Date, to: Date): Promise<TaxAsset[]> {
  const assets = await tx.osnovnoSredstvo.findMany({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, is_deleted: false, status: { in: ["ACTIVE", "DISPOSED"] }, OR: [{ datum_raspolozivosti: null }, { datum_raspolozivosti: { lte: to } }], AND: [{ OR: [{ datum_isknjizenja: null }, { datum_isknjizenja: { gte: from } }] }] }, include: { parametri: { where: { vazi_od: { lte: to } }, orderBy: { vazi_od: "desc" }, take: 1 } }, orderBy: { id: "asc" } });
  return assets.map(a => ({ id: a.id, name: `${a.inventarski_broj} · ${a.naziv}`, type: a.vrsta_imovine, classification: a.parametri[0]?.poreska_grupa ?? a.parametri[0]?.poreski_tretman ?? "UNSUPPORTED", available: a.datum_raspolozivosti ? assetDate(a.datum_raspolozivosti) : null, disposed: a.datum_isknjizenja ? assetDate(a.datum_isknjizenja) : null }));
}
export function validateTaxAssets(input: TaxInput, assets: TaxAsset[]) {
  if (input.assets.length !== assets.length || input.assets.some(a => !assets.some(s => s.id === a.id))) throw new Error("Registar je promijenjen. Ponovo otvorite poreske podatke.");
  for (const asset of assets) {
    const row = input.assets.find(a => a.id === asset.id)!;
    if (!parseTaxClassification(row.classification, asset.type)) throw new Error(`${asset.name}: poreska klasifikacija ne odgovara vrsti imovine.`);
    if (!["I","ACCOUNTING_AMOUNT"].includes(row.classification) && (row.basis || row.previous) || row.classification !== "ACCOUNTING_AMOUNT" && row.accounting) throw new Error(`${asset.name}: iznosi ne odgovaraju poreskom tretmanu.`);
  }
}
export function initialTaxInput(assets: TaxAsset[], prior?: { id: string; snapshot: TaxSnapshot }): TaxInput {
  return {
    schema: 1, openingSource: prior ? `Prenos potvrđenog obračuna ${prior.id}` : "",
    pools: poolGroups.map(group => ({ group, opening: prior?.snapshot.result.rows.find(r => r.group === group)?.closing ?? 0, soldAll: false })),
    assets: assets.map(asset => {
      const old = prior?.snapshot.input.assets.find(a => a.id === asset.id), result = prior?.snapshot.result.rows.find(r => r.key === asset.id);
      return { id: asset.id, classification: old?.classification ?? (taxClassificationOptions(asset.type).length === 1 ? taxClassificationOptions(asset.type)[0].value : asset.classification), basis: result && ["I","POSEBNO"].includes(result.group) ? result.basis : 0, previous: result && ["I","POSEBNO"].includes(result.group) ? result.total : 0, accounting: 0, source: result && ["I","POSEBNO"].includes(result.group) ? `Prenos ${prior!.id}` : "" };
    }), events: []
  };
}
export async function buildTaxSnapshot(tx: Prisma.TransactionClient, scope: AssetBatchScope, input: TaxInput, previousId: string | null) {
  const year = await tx.poslovnaGodina.findFirstOrThrow({ where: { id: scope.poslovna_godina_id, firma_id: scope.firma_id, firma: { agencija_id: scope.agencija_id, is_deleted: false } }, include: { firma: true } });
  const assets = await taxAssets(tx,scope,year.datum_od,year.datum_do);
  const defaults = initialTaxInput(assets);
  input = {...input,assets:[...input.assets,...defaults.assets.filter(a=>!input.assets.some(old=>old.id===a.id))]};
  validateTaxAssets(input,assets);
  const automatic=await automaticTaxEvents(tx,scope,input,year.datum_od,year.datum_do);
  input=mergeTaxEvents(input,automatic.events);
  for (const a of input.assets) if (!a.source) a.source=automatic.events.find(e=>e.kind==="PURCHASE" && e.origin.assetId===a.id)?.source??"";
  const snapshot: TaxSnapshot = { schema: 1, from: assetDate(year.datum_od), to: assetDate(year.datum_do), company: year.firma.naziv, pib: year.firma.pib ?? "", assets, input, previousId, result: calculateTax(input,assets,assetDate(year.datum_od),assetDate(year.datum_do)) };
  snapshot.result.errors.push(...automatic.errors);
  return { snapshot, hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}
