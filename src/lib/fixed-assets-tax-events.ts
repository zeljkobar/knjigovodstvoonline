import type { Prisma } from "@prisma/client";
import { assetDate, type AssetBatchScope } from "./fixed-assets-batches";
import { fixedAssetDecimalToCents } from "./fixed-assets";
import type { TaxInput } from "./fixed-assets-tax";
export type AutomaticTaxEvent = TaxInput["events"][number] & { origin: { changeId: string; assetId: string; assetName: string; journalId: string } };
export const isAutomaticTaxEvent = (event: TaxInput["events"][number]) => event.id.startsWith("os:");

// Rebuild from source every time: opening records are deliberately never purchases.
export async function automaticTaxEvents(tx: Prisma.TransactionClient, scope: AssetBatchScope, input: TaxInput, from: Date, to: Date) {
  const changes = await tx.osPromjena.findMany({
    where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, status: "CONFIRMED", is_deleted: false, vrsta: { in: ["ACQUISITION","SALE"] }, sredstvo: { is_deleted: false, status: { in: ["ACTIVE","DISPOSED"] } } },
    include: { sredstvo: true, izvorni_nalog: true, storno_promjene: { where: { status: "CONFIRMED", is_deleted: false } } }, orderBy: [{ datum: "asc" },{id:"asc"}]
  });
  const events: AutomaticTaxEvent[] = [], errors: string[] = [];
  for (const change of changes) {
    if (change.storno_promjene.length) continue;
    const date = change.vrsta === "ACQUISITION" ? change.sredstvo.datum_raspolozivosti : change.datum;
    if (!date || date < from || date > to) continue;
    const name=`${change.sredstvo.inventarski_broj} · ${change.sredstvo.naziv}`;
    const row=input.assets.find(a=>a.id===change.sredstvo_id);
    if (row?.classification === "EXEMPT") continue;
    if (!row || !["I","II","III","IV","V","ACCOUNTING_AMOUNT"].includes(row.classification)) { errors.push(`${name}: dopunite poresku klasifikaciju za automatsko preuzimanje promjene.`); continue; }
    const journal=change.izvorni_nalog;
    if (!journal || journal.firma_id!==scope.firma_id || journal.agencija_id!==scope.agencija_id || journal.status!=="POSTED") { errors.push(`${name}: potvrđena promjena nema važeći proknjiženi izvorni nalog.`); continue; }
    const snapshot=change.snapshot as Record<string, unknown> | null;
    const amount=change.vrsta === "ACQUISITION" ? fixedAssetDecimalToCents(change.delta_nabavna_vrijednost) : typeof snapshot?.sale_price_cents === "string" && /^\d+$/.test(snapshot.sale_price_cents) ? Number(snapshot.sale_price_cents) : null;
    if (amount===null || !Number.isSafeInteger(amount) || amount<0 || amount>99999999999999 || change.vrsta==="ACQUISITION" && !amount) { errors.push(`${name}: nedostaje ispravan iznos potvrđene nabavke/prodaje.`); continue; }
    const group=row.classification === "ACCOUNTING_AMOUNT" ? "POSEBNO" : row.classification;
    events.push({ id:`os:${change.id}`, group, assetId:["I","POSEBNO"].includes(group)?row.id:"", kind:change.vrsta==="ACQUISITION"?"PURCHASE":"SALE", date:assetDate(date), amount, source:`${name} · ${journal.sifra}`, origin:{changeId:change.id,assetId:row.id,assetName:name,journalId:journal.id} });
  }
  return {events,errors};
}
export function mergeTaxEvents(input: TaxInput, automatic: AutomaticTaxEvent[]) {
  const manual=input.events.filter(e=>!isAutomaticTaxEvent(e));
  // Existing manual copies are not silently dropped: require review of an exact duplicate.
  for (const event of manual) if (automatic.some(a=>a.group===event.group && a.kind===event.kind && a.date===event.date && a.amount===event.amount && (!event.assetId || event.assetId===a.assetId))) throw new Error("Ručna poreska promjena odgovara automatski preuzetoj nabavci/prodaji. Uklonite ručni duplikat ili uskladite izvorni dokument.");
  return {...input,events:[...manual,...automatic]};
}
