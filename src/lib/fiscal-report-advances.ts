import { decimalToScaled } from "./inventory-calculation";

type Source = { id: string; number: string; buyer: string; buyerId: string | undefined; gross: bigint; status: string };
export type AdvanceReportUsage = {
  id: string; avansni_racun_id: string | null; kupac_id: string; iznos_avansa: { toString(): string }; ukupno_sa_pdv: { toString(): string };
  fiscal_status: string; fiscal_environment: string | null; valuta: string; is_deleted: boolean;
  document_type: string; vrsta_racuna: string; sales_channel: string;
  fiscal_api_invoice_id: string | null; jikr: string | null; official_invoice_number: string | null; interni_broj: string;
  avans_umanjenje: unknown;
};
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : null;
const present = (value: unknown) => typeof value === "string" && Boolean(value.trim());
function settlement(value: unknown, amount: bigint) {
  const data = object(value);
  if (!data || data.status !== "Fiscalized" || !present(data.remoteId) || !present(data.jikr) || !present(data.iic) || !Array.isArray(data.allocations)) return null;
  let allocated = BigInt(0);
  for (const item of data.allocations) {
    const row = object(item), gross = row?.grossAmount;
    if (!present(row?.advanceItemId) || (typeof gross !== "number" && typeof gross !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(gross))) return null;
    allocated += decimalToScaled(String(gross),2);
  }
  return allocated === amount ? { number: present(data.officialInvoiceNumber) ? data.officialInvoiceNumber as string : data.remoteId as string, jikr: data.jikr as string } : null;
}

/** Current local workflow evidence for advances issued in the selected period.
 * No deduction of API availability/reservations and no historical balance claim. */
export function fiscalAdvanceRows(sources: Source[], usages: AdvanceReportUsage[], environment: string) {
  const bySource = new Map<string, AdvanceReportUsage[]>();
  for (const usage of usages) {
    const list = bySource.get(usage.avansni_racun_id ?? "") ?? [];
    list.push(usage); bySource.set(usage.avansni_racun_id ?? "",list);
  }
  return sources.map(source => {
    let used = BigInt(0), settled = BigInt(0), pending = BigInt(0);
    const links = (bySource.get(source.id) ?? []).map(usage => {
      const amount = decimalToScaled(usage.iznos_avansa,2);
      const confirmed = amount > BigInt(0) && amount <= decimalToScaled(usage.ukupno_sa_pdv,2) && !usage.is_deleted && usage.document_type === "INVOICE" && usage.vrsta_racuna === "NORMAL" && usage.sales_channel === "OFFICE" && usage.fiscal_status === "Fiscalized" && usage.fiscal_environment === environment && usage.valuta === "EUR" && usage.kupac_id === source.buyerId && present(usage.fiscal_api_invoice_id) && present(usage.jikr);
      const reduction = confirmed ? settlement(usage.avans_umanjenje,amount) : null;
      if (confirmed) { used += amount; if (reduction) settled += amount; }
      else if (usage.valuta === "EUR" && amount > BigInt(0)) pending += amount;
      return { id: usage.id, number: usage.official_invoice_number ?? usage.interni_broj, amount, currency: usage.valuta, confirmed, settlementNumber: reduction?.number ?? "", settlementJikr: reduction?.jikr ?? "", status: confirmed ? reduction ? "Korišćenje i umanjenje potvrđeni" : "Čeka potvrđeno umanjenje" : "Veza za provjeru" };
    });
    return { ...source, used, settled, unsettled: used-settled, pending, review: source.status !== "Fiscalized" || source.gross <= BigInt(0) || used > source.gross || links.some(link=>!link.confirmed), links };
  });
}
