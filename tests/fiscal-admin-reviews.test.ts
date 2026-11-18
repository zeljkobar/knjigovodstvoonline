import assert from "node:assert/strict";
import test from "node:test";
import { FiscalAdminApiError, fiscalAdminApi, fiscalReviewApi } from "../src/lib/fiscal-admin-api";
import { defaultFiscalPeriod, fiscalDocumentSelection, fiscalReportSelection, fiscalReviewHref,
  fiscalReviewRoutes, fiscalUtcRange, isFiscalUuid, officialFiscalQr } from "../src/lib/fiscal-review-filters";

const companyId = "8cd24e15-a594-4467-b1ef-6a497403e0a0";
const invoiceId = "bb68158e-0228-4886-b617-5d9c00f1ed7f";
const exchangeId = "35d84457-0c48-4e85-832e-77b4f9de42ba";
const actor = { id: "admin:test", name: "test-admin" };

test("izvještaj koristi granice mjeseca u Podgorici i provjerava stvarne datume", () => {
  const nearMidnight = new Date("2026-10-31T23:45:00Z");
  assert.deepEqual(defaultFiscalPeriod(nearMidnight), { fromDate: "2026-11-01", toDate: "2026-12-01" });
  assert.deepEqual(fiscalReportSelection({ companyId }, nearMidnight).filter,
    { companyId, environment: "Production", groupBy: "Month", fromDate: "2026-11-01", toDate: "2026-12-01" });
  assert.ok(fiscalReportSelection({ companyId, fromDate: "2026-02-30" }, nearMidnight).error);
  assert.ok(fiscalReportSelection({ companyId, fromDate: "2026-11-01", toDate: "2026-11-01" }).error);
  assert.ok(fiscalReportSelection({ companyId, fromDate: "2010-01-01", toDate: "2026-11-01" }).error);
  assert.ok(fiscalReportSelection({ companyId, environment: ["Test", "Production"] }).error);
  assert.equal(fiscalReportSelection({}, nearMidnight).filter, undefined);
});

test("drill-down čuva period, grupu i poresku stopu bez preračunavanja iznosa", () => {
  const filter = fiscalReportSelection({ companyId, fromDate: "2026-08-01", toDate: "2026-09-01" }).filter;
  const drill = fiscalDocumentSelection({ metric: "SalesNet", vatRate: "21.25", bucketStartDate: "2026-08-01" });
  assert.ok(filter && drill);
  const url = new URL(fiscalReviewHref(fiscalReviewRoutes.documents, { ...filter, ...drill, page: 2 }), "https://example.invalid");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    companyId, environment: "Production", groupBy: "Month", fromDate: "2026-08-01", toDate: "2026-09-01",
    metric: "SalesNet", bucketStartDate: "2026-08-01", vatRate: "21.25", page: "2"
  });
  assert.equal(fiscalDocumentSelection({ metric: "Category", vatRate: "21", category: "AdvanceReceipt" }), null);
  assert.equal(fiscalDocumentSelection({ metric: "Payment", category: "StandardSale" }), null);
  assert.deepEqual(fiscalDocumentSelection({ metric: "Payment", category: "StandardSale", paymentType: "BankAccount" }),
    { metric: "Payment", bucketStartDate: "", category: "StandardSale", paymentType: "BankAccount" });
  assert.equal(fiscalDocumentSelection({ metric: "SalesNet", vatRate: "101" }), null);
  assert.equal(fiscalDocumentSelection({ metric: "SalesNet", bucketStartDate: "2026-02-30" }), null);
  assert.equal(fiscalUtcRange("2026-11-01", "2026-11-03").to, "2026-11-03T00:00:00Z");
  assert.ok(fiscalUtcRange("2026-11-01", undefined).error);
});

test("prikazuje samo zvanični HTTPS QR, a ID nije proizvoljna putanja", () => {
  for (const host of ["mapr.tax.gov.me", "efitest.tax.gov.me"]) {
    const url = "https://" + host + "/ic/#/verify?iic=abc&prc=242.00";
    assert.equal(officialFiscalQr(url), url);
  }
  for (const url of ["javascript:alert(1)", "//mapr.tax.gov.me/ic/#/verify?iic=x",
    "https://mapr.tax.gov.me.example.org/ic/#/verify?iic=x", "https://user:pw@mapr.tax.gov.me/ic/#/verify?iic=x",
    "https://mapr.tax.gov.me/elsewhere/#/verify?iic=x"]) assert.equal(officialFiscalQr(url), null);
  assert.ok(isFiscalUuid(invoiceId));
  assert.equal(isFiscalUuid("../api-clients"), false);
});

test("admin pregledi koriste samo odvojeni GET klijent, bez upisa ili security scope-a", async t => {
  const values = {
    FISCAL_API_BASE_URL: "https://fiscal.invalid", FISCAL_API_CLIENT_ID: "legacy-writer", FISCAL_API_KEY: "legacy-test-key",
    FISCAL_API_READ_CLIENT_ID: "global-reader", FISCAL_API_READ_KEY: "read-test-key"
  };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls: { url: URL; options?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify({ success: true, data: { id: invoiceId } }));
  });

  await fiscalReviewApi.invoices(actor, { companyId, buyerName: "A & B" });
  await fiscalReviewApi.invoice(actor, invoiceId);
  await fiscalReviewApi.turnover(actor, { companyId, environment: "Production", groupBy: "Month", fromDate: "2026-08-01", toDate: "2026-09-01" });
  await fiscalReviewApi.turnoverDocuments(actor, { companyId, metric: "SalesNet", vatRate: "21" });
  await fiscalReviewApi.invoiceExchanges(actor, invoiceId, 2);
  await fiscalReviewApi.exchanges(actor, { correlationId: "test & history" });
  await fiscalReviewApi.exchange(actor, exchangeId);
  await fiscalReviewApi.requests(actor, { scope: "security", httpStatus: undefined, apiHttpStatus: 409 });
  assert.deepEqual(calls.map(x => x.url.pathname), [
    "/api/v1/admin/invoices", "/api/v1/fiscal/invoices/" + invoiceId, "/api/v1/admin/reports/turnover",
    "/api/v1/admin/reports/turnover/documents", "/api/v1/admin/invoices/" + invoiceId + "/exchanges",
    "/api/v1/admin/exchanges", "/api/v1/admin/exchanges/" + exchangeId, "/api/v1/admin/api-requests"
  ]);
  for (const call of calls) {
    const headers = new Headers(call.options?.headers);
    assert.equal(headers.get("X-Fiscal-Client-Id"), "global-reader");
    assert.equal(headers.get("X-Fiscal-Api-Key"), "read-test-key");
    assert.equal(call.options?.method, "GET");
    assert.equal(call.options?.redirect, "error");
    assert.equal(call.options?.cache, "no-store");
  }
  assert.equal(calls[0].url.searchParams.get("buyerName"), "A & B");
  assert.equal(calls[3].url.searchParams.get("vatRate"), "21");
  assert.equal(calls[4].url.searchParams.get("page"), "2");
  assert.equal(calls[7].url.searchParams.get("scope"), "tenant");

  delete process.env.FISCAL_API_READ_KEY;
  await assert.rejects(fiscalReviewApi.invoices(actor, {}), (error: unknown) =>
    error instanceof FiscalAdminApiError && error.code === "FISCAL_READ_NOT_CONFIGURED");
  assert.throws(() => fiscalReviewApi.exchange(actor, "../api-clients"));
  assert.equal(calls.length, 8);
  await fiscalAdminApi.getInvoice(invoiceId, actor);
  assert.equal(new Headers(calls[8].options?.headers).get("X-Fiscal-Api-Key"), "legacy-test-key");
});
