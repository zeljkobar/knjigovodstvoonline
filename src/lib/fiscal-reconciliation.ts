import { decimalToScaled } from "./inventory-calculation";

export type ReconciliationLocal = {
  id: string; fiscal_api_invoice_id: string | null; interni_broj: string;
  fiscal_status: string; fiscal_environment: string | null; valuta: string;
  document_type: string; vrsta_racuna: string;
  ukupno_osnovica: { toString(): string }; ukupno_izlazni_pdv: { toString(): string }; ukupno_sa_pdv: { toString(): string };
};
export type ReconciliationRemote = { id: string; companyId: string; environment: string; status: string; currency: string;
  invoiceNumber: string; category?: string | null;
  contribution: { net?: string | null; vat?: string | null; gross?: string | null } };

export function reconciliationCents(value: string | null | undefined) {
  if (typeof value !== "string" || !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new Error("Neispravan novčani podatak u poređenju.");
  return decimalToScaled(value, 2);
}

export function compareFiscalDocuments(local: ReconciliationLocal[], remote: ReconciliationRemote[], companyId: string, environment: string) {
  const remoteMap = new Map<string, ReconciliationRemote>();
  for (const row of remote) {
    if (row.companyId !== companyId || row.environment !== environment || row.currency !== "EUR" || !["Fiscalized", "StornoCreated"].includes(row.status) || remoteMap.has(row.id)) throw new Error("API dokumenti ne odgovaraju jedinstvenom izabranom obuhvatu.");
    remoteMap.set(row.id, row);
  }
  const seen = new Set<string>();
  const differences: Array<{ localId?: string; apiId?: string; number: string; reasons: string[] }> = [];
  const localTotals = { net: BigInt(0), vat: BigInt(0), gross: BigInt(0), count: 0 };
  const apiTotals = { net: BigInt(0), vat: BigInt(0), gross: BigInt(0), count: remote.length };
  for (const row of remote) {
    apiTotals.net += reconciliationCents(row.contribution.net);
    apiTotals.vat += reconciliationCents(row.contribution.vat);
    apiTotals.gross += reconciliationCents(row.contribution.gross);
  }
  for (const row of local) {
    const ordinary = ["INVOICE", "OFFICE_STORNO", "POS_RECEIPT", "POS_RETURN"].includes(row.document_type) && ["NORMAL", "CORRECTIVE"].includes(row.vrsta_racuna);
    const included = ordinary && ["Fiscalized", "StornoCreated"].includes(row.fiscal_status) && row.fiscal_environment === environment && row.valuta === "EUR";
    if (included) {
      localTotals.count++;
      localTotals.net += reconciliationCents(row.ukupno_osnovica.toString());
      localTotals.vat += reconciliationCents(row.ukupno_izlazni_pdv.toString());
      localTotals.gross += reconciliationCents(row.ukupno_sa_pdv.toString());
    }
    const api = row.fiscal_api_invoice_id ? remoteMap.get(row.fiscal_api_invoice_id) : undefined;
    if (!included && !api) continue; // Non-sales documents are not sales differences.
    const reasons: string[] = [];
    if (row.fiscal_api_invoice_id && seen.has(row.fiscal_api_invoice_id)) throw new Error("Više lokalnih dokumenata ima isti API identifikator.");
    if (row.fiscal_api_invoice_id) seen.add(row.fiscal_api_invoice_id);
    if (!api) reasons.push(row.fiscal_api_invoice_id ? "Lokalni promet nema potvrđen prodajni dokument u API obuhvatu" : "Nedostaje veza sa API računom");
    else {
      if (!ordinary) reasons.push("API prodaja pripada kategoriji izvan lokalnog izvještaja");
      if (row.fiscal_status !== api.status) reasons.push("Različit fiskalni status");
      if (row.fiscal_environment !== api.environment) reasons.push("Različito ili nepotvrđeno okruženje");
      if (row.valuta !== api.currency) reasons.push("Različita valuta");
      if (reconciliationCents(row.ukupno_osnovica.toString()) !== reconciliationCents(api.contribution.net)) reasons.push("Različita osnovica");
      if (reconciliationCents(row.ukupno_izlazni_pdv.toString()) !== reconciliationCents(api.contribution.vat)) reasons.push("Različit PDV");
      if (reconciliationCents(row.ukupno_sa_pdv.toString()) !== reconciliationCents(api.contribution.gross)) reasons.push("Različit ukupan iznos");
    }
    if (reasons.length) differences.push({ localId: row.id, apiId: row.fiscal_api_invoice_id ?? undefined, number: row.interni_broj, reasons });
  }
  for (const row of remote) if (!seen.has(row.id)) differences.push({ apiId: row.id, number: row.invoiceNumber, reasons: ["API prodaja nije pronađena u lokalnom skupu (provjeriti izvor, datum i kategoriju)"] });
  return { differences, localTotals, apiTotals };
}
