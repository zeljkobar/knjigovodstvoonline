import { prisma } from "./prisma";
import { fiscalReviewApi, type FiscalActor } from "./fiscal-admin-api";
import { podgoricaDayUtcRange } from "./direct-portal-policy";
import { compareFiscalDocuments, reconciliationCents, type ReconciliationRemote } from "./fiscal-reconciliation";
import type { FiscalQuery } from "./fiscal-review-filters";

export class FiscalReconciliationError extends Error {}

/** Admin-only caller must authenticate before invoking this read-only service. */
export async function loadFiscalReconciliation(actor: FiscalActor, filter: FiscalQuery & { companyId: string; environment: string; fromDate: string; toDate: string }) {
  const link = await prisma.fiscalCompanyLink.findFirst({ where: { fiscal_api_company_id: filter.companyId, firma: { is_deleted: false } }, select: { firma_id: true, agencija_id: true, firma: { select: { naziv: true, pib: true } } } });
  if (!link) throw new FiscalReconciliationError("API firma nije povezana sa aktivnom lokalnom firmom.");
  const start = podgoricaDayUtcRange(new Date(`${filter.fromDate}T12:00:00Z`)).start;
  const end = podgoricaDayUtcRange(new Date(`${filter.toDate}T12:00:00Z`)).start;
  const apiFilter = { companyId: filter.companyId, environment: filter.environment, fromDate: filter.fromDate, toDate: filter.toDate, groupBy: "Month" };
  const before = (await fiscalReviewApi.turnover(actor, apiFilter)).data;
  if (before.rulesVersion !== "turnover-v1" || before.currency !== "EUR" || !before.authoritative ||
    Date.parse(before.filters.fromUtc) !== start.getTime() || Date.parse(before.filters.toUtc) !== end.getTime()) throw new FiscalReconciliationError("API pravila ili vremenski obuhvat nijesu podržani za ovo poređenje.");
  const rows: ReconciliationRemote[] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const data = (await fiscalReviewApi.turnoverDocuments(actor, { ...apiFilter, metric: "SalesNet", page })).data;
    if (!Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || data.totalCount > 500 || data.page !== page || data.pageSize !== 25 || (total !== undefined && total !== data.totalCount)) throw new FiscalReconciliationError("API skup je prevelik ili se promijenio tokom čitanja. Suzite period i ponovite.");
    total = data.totalCount;
    rows.push(...data.items);
    if (rows.length >= total) { if (rows.length !== total) throw new FiscalReconciliationError("API broj dokumenata nije usaglašen."); break; }
    if (data.items.length !== 25 || page >= 20) throw new FiscalReconciliationError("API stranice nijesu potpune.");
  }
  const localReadAt = new Date();
  const local = await prisma.fiskalniIzlazniRacun.findMany({ where: {
    agencija_id: link.agencija_id, firma_id: link.firma_id, is_deleted: false, fiskalizacija_rezim: "SUMMA",
    sales_channel: { in: ["OFFICE", "POS"] },
    AND: [{ OR: [{ fiscal_environment: filter.environment }, { fiscal_environment: null }] },
      { OR: [{ issued_at: { gte: start, lt: end } }, { issued_at: null, datum_racuna: { gte: new Date(`${filter.fromDate}T00:00:00Z`), lt: new Date(`${filter.toDate}T00:00:00Z`) } }] }]
  }, take: 5001, select: { id: true, fiscal_api_invoice_id: true, interni_broj: true, fiscal_status: true, fiscal_environment: true, valuta: true,
    document_type: true, vrsta_racuna: true, ukupno_osnovica: true, ukupno_izlazni_pdv: true, ukupno_sa_pdv: true } });
  if (local.length > 5000) throw new FiscalReconciliationError("Lokalni skup je prevelik. Suzite period.");
  const after = (await fiscalReviewApi.turnover(actor, apiFilter)).data;
  if (JSON.stringify(before.totals) !== JSON.stringify(after.totals) || before.rulesVersion !== after.rulesVersion) throw new FiscalReconciliationError("API promet se promijenio tokom poređenja. Ponovite kontrolu.");
  const compared = compareFiscalDocuments(local, rows, filter.companyId, filter.environment);
  for (const field of ["net", "vat", "gross"] as const) if (compared.apiTotals[field] !== reconciliationCents(before.totals.salesNet[field])) throw new FiscalReconciliationError("API dokumenti ne daju prijavljeni zbir. Ponovite kontrolu.");
  return { ...compared, firma: link.firma, apiEvaluatedAt: before.evaluatedAt, localReadAt,
    partial: before.coverage.partial, availableSince: before.coverage.availableSince, rulesVersion: before.rulesVersion };
}
