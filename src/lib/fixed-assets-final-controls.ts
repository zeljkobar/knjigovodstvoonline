import "server-only";
import type { Prisma } from "@prisma/client";
import { buildAssetBatch, type AssetBatchScope } from "./fixed-assets-batches";
import { fixedAssetDecimalToCents } from "./fixed-assets";
import { corporateTaxDepreciationFromSnapshot } from "./corporate-tax";
import { standardJournalTypes } from "./journals";

type AssetControl = {
  id: string; group: "Osnovna sredstva"; level: "error" | "warning" | "success" | "info";
  title: string; description: string; actionHref?: string; actionLabel?: string;
};
const bookHref = "/agencija/osnovna-sredstva/obracuni";
const taxHref = "/agencija/osnovna-sredstva/poreska-amortizacija";

export async function fixedAssetFinalControls(db: Prisma.TransactionClient, scope: AssetBatchScope, from: Date, to: Date, canView: boolean): Promise<AssetControl[]> {
  const controls: AssetControl[] = [];
  const add = (id: string, level: AssetControl["level"], title: string, description: string, actionHref = bookHref) => {
    controls.push({ id, group: "Osnovna sredstva", level, title, description, actionHref, actionLabel: actionHref === taxHref ? "Poreska amortizacija" : "Računovodstvena amortizacija" });
  };
  if (!canView) return [{ id: "assets-access", group: "Osnovna sredstva", level: "warning", title: "Amortizacija nije provjerena", description: "Za ovu kontrolu potrebno je pravo pregleda osnovnih sredstava." }];

  const validPosted = { ...scope, status: "POSTED", OR: [
    { nalog: { status: "POSTED", is_deleted: false, firma_id: scope.firma_id, poslovna_godina_id: scope.poslovna_godina_id } },
    { nalog_id: null, bez_naloga_razlog: "ZERO_AMOUNT" }
  ] } satisfies Prisma.OsObracunWhereInput;
  const [assets, bookCount, bookTotals, taxBatch, draftBooks, draftTaxes, coverage] = await Promise.all([
    db.osnovnoSredstvo.count({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, is_deleted: false,
      status: { in: ["ACTIVE", "DISPOSED"] }, vrsta_imovine: { not: "LAND" },
      AND: [{ OR: [{ datum_raspolozivosti: null }, { datum_raspolozivosti: { lte: to } }] },
        { OR: [{ datum_isknjizenja: null }, { datum_isknjizenja: { gt: from } }] }] } }),
    db.osObracun.count({ where: { ...validPosted, period_od: { lte: to }, period_do: { gte: from } } }),
    db.stavkaNaloga.aggregate({ where: { nalog: { ...scope, status: "POSTED", is_deleted: false,
      vrsta_naloga: { sifra: { notIn: [standardJournalTypes[0][0], standardJournalTypes[8][0]] } } },
      firma_konto: { firma_id: scope.firma_id, sifra: { startsWith: "540" } } }, _sum: { duguje: true, potrazuje: true } }),
    db.osPoreskiObracun.findFirst({ where: { ...scope, status: "CONFIRMED" }, orderBy: { revizija: "desc" }, select: { snapshot: true } }),
    db.osObracun.count({ where: { ...scope, status: "DRAFT", period_od: { lte: to }, period_do: { gte: from } } }),
    db.osPoreskiObracun.count({ where: { ...scope, status: "DRAFT" } }),
    db.osObracunPokrice.findMany({ where: { ...scope, aktivno: true, obracun: validPosted, period_od: { lte: to }, period_do: { gte: from } },
      select: { sredstvo_id: true, period_od: true, period_do: true } })
  ]);
  const hasBook = bookCount > 0 || (fixedAssetDecimalToCents(bookTotals._sum.duguje ?? "0")! - fixedAssetDecimalToCents(bookTotals._sum.potrazuje ?? "0")!) !== 0;
  const hasTax = Boolean(taxBatch && corporateTaxDepreciationFromSnapshot(taxBatch.snapshot, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)) !== null);
  if (hasBook && !hasTax) add("assets-paired-depreciation", "error", "Nedostaje potvrđena poreska amortizacija", "Računovodstvena amortizacija postoji, ali nema ispravnog potvrđenog OA obračuna za izabranu godinu. Nacrt nije završen obračun.", taxHref);
  else if (hasTax && !hasBook) add("assets-paired-depreciation", "error", "Nedostaje računovodstvena amortizacija", "Poreska amortizacija je potvrđena, ali nema proknjiženog računovodstvenog obračuna ni knjižene amortizacije na kontima 540.");
  else add("assets-paired-depreciation", hasBook ? "success" : "info", hasBook ? "Obje amortizacije postoje" : "Nema završenih obračuna amortizacije", "Računovodstvena i poreska amortizacija provjeravaju se za istu firmu i godinu. Njihovi iznosi ne moraju biti jednaki.");

  if (taxBatch && !hasTax) add("assets-tax-validity", "error", "Poreski obračun nije ispravan za izabrani period", "Provjerite potvrđeni OA: period, rezultat i eventualne greške obračuna.", taxHref);
  if (assets > 0) {
    try {
      // Reuse the annual calculator, including residual value, dates, methods
      // and prior depreciation; no second approximation of asset eligibility.
      const { snapshot } = await buildAssetBatch(db, scope, from, to);
      const expectedIds = new Set(snapshot.lines.filter(line => line.amountCents > 0).map(line => line.assetId));
      const missing = snapshot.coverage.filter(period => {
        if (!expectedIds.has(period.assetId)) return false;
        let next = new Date(`${period.from}T00:00:00Z`).getTime();
        const end = new Date(`${period.to}T00:00:00Z`).getTime();
        for (const interval of coverage.filter(c => c.sredstvo_id === period.assetId).sort((a, b) => a.period_od.getTime() - b.period_od.getTime())) {
          if (interval.period_od.getTime() > next) break;
          next = Math.max(next, interval.period_do.getTime() + 86400000);
        }
        return next <= end;
      });
      if (expectedIds.size && (!hasBook || !hasTax || missing.length)) {
        const reasons = [!hasBook ? "nedostaje računovodstvena amortizacija" : null, !hasTax ? "nedostaje potvrđena poreska amortizacija" : null,
          missing.length ? `${missing.length} sredstava nema potpuno proknjižen period amortizacije` : null].filter(Boolean);
        add("assets-required-depreciation", "error", "Osnovna sredstva nemaju završenu amortizaciju", reasons.join("; ") + ".", !hasTax && hasBook && !missing.length ? taxHref : bookHref);
      } else add("assets-required-depreciation", "success", expectedIds.size ? "Amortizacija osnovnih sredstava je završena" : "Nema obračunljive računovodstvene amortizacije", expectedIds.size ? "Sredstva koja se amortizuju imaju proknjiženo pokriće perioda i potvrđen poreski obračun." : "Godišnji obračun nema iznos za amortizaciju; potpuno otpisana sredstva ne zahtijevaju novi trošak.");
    } catch (error) {
      // Database/programming errors must not be shown as business validation.
      if (!(error instanceof Error) || error.name !== "Error") throw error;
      add("assets-required-depreciation", "error", "Provjerite podatke za amortizaciju osnovnih sredstava", error.message);
    }
  } else add("assets-required-depreciation", "info", "Nema sredstava za računovodstvenu amortizaciju u ovom periodu", "Zemljište, neaktivirana sredstva i sredstva van perioda ne zahtijevaju računovodstveni obračun. Provjera para amortizacija i dalje važi.");
  if (draftBooks || draftTaxes) add("assets-draft-depreciation", "warning", "Postoje nezavršeni obračuni amortizacije", `Računovodstveni nacrti: ${draftBooks}; poreski nacrti: ${draftTaxes}. Pregledajte ih prije završetka godine.`, draftTaxes && !draftBooks ? taxHref : bookHref);
  return controls;
}
