import type { DirectPortalReport } from "./direct-portal-reports";

/** Identity is the local partner plus the issued snapshot, never name or PIB alone. */
export function fiscalBuyerRows(documents: DirectPortalReport["documents"]) {
  const rows = new Map<string, { id: string; name: string; taxNumber: string; historical: boolean; ordinaryCount: number; correctionCount: number; sales: bigint; corrections: bigint; base: bigint; vat: bigint; gross: bigint }>();
  for (const document of documents) {
    const key = JSON.stringify([document.buyerId || document.id, document.buyer, document.buyerTaxNumber, document.buyerHistorical ?? false]);
    const row = rows.get(key) ?? { id: key, name: document.buyer, taxNumber: document.buyerTaxNumber, historical: document.buyerHistorical ?? false, ordinaryCount: 0, correctionCount: 0, sales: BigInt(0), corrections: BigInt(0), base: BigInt(0), vat: BigInt(0), gross: BigInt(0) };
    if (document.correction) { row.correctionCount++; row.corrections += document.gross; }
    else { row.ordinaryCount++; row.sales += document.gross; }
    row.base += document.base; row.vat += document.vat; row.gross += document.gross;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a,b) => a.gross === b.gross ? a.id.localeCompare(b.id) : a.gross > b.gross ? -1 : 1);
}

export function fiscalBuyerSnapshot(value: unknown, current: { naziv: string; pib: string | null; foreign_tax_number: string | null }) {
  const snapshot = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const historical = typeof snapshot?.naziv === "string" && Boolean(snapshot.naziv.trim());
  const name = historical ? snapshot!.naziv as string : current.naziv;
  // A present snapshot with a null PIB must not borrow today's tax number.
  const tax = historical ? snapshot!.pib ?? snapshot!.foreignTaxNumber ?? snapshot!.foreign_tax_number : current.pib ?? current.foreign_tax_number;
  return { name, taxNumber: typeof tax === "string" ? tax : "", historical };
}
