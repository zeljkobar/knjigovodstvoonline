import type { OsParametar, OsUcinak } from "@prisma/client";
import { fixedAssetDecimalToCents } from "./fixed-assets";
import type { FixedAssetCalculationParameter } from "./fixed-assets-calculation";
export function parameterInput(p: OsParametar): FixedAssetCalculationParameter {
  return { id:p.id, effectiveFrom:p.vazi_od.toISOString().slice(0,10), method:p.metoda,
    usefulLifeMonths:p.korisni_vijek_mjeseci ?? 0, residualCents:fixedAssetDecimalToCents(p.ostatak_vrijednosti)!,
    algorithm:p.algoritam, annualRate:p.godisnja_stopa?.toString(), basisCents:p.osnovica == null ? null : fixedAssetDecimalToCents(p.osnovica),
    expectedUnits:p.ocekivani_ucinak?.toString(),priorUnits:p.prethodni_ucinak?.toString(),unitRate:p.stopa_po_jedinici?.toString(),rateSource:p.izvor_stope };
}
export function usageInput(u: OsUcinak) {
  return { parameterId:u.parametar_id,from:u.datum_od.toISOString().slice(0,10),to:u.datum_do.toISOString().slice(0,10),quantity:u.kolicina.toString() };
}
