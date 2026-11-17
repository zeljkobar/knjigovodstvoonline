import assert from "node:assert/strict";
import test from "node:test";
import { fiscalAdminApi } from "../src/lib/fiscal-admin-api";
import { fiscalOnboardingLabel, fiscalOnboardingStatus } from "../src/lib/fiscal-admin-status";
import { describeControlTestFailure } from "../src/lib/fiscal-control-test";

const pendingLink = { is_suspended: false, fiscal_environment: "Test", onboarding_status: "READY_FOR_TEST" };

test("osvježavanje popravlja zastarjeli status produkcije i čuva suspenziju", () => {
  const productionLink = { ...pendingLink, fiscal_environment: "Production" };
  const activation = { status: "ProductionActive", environment: "Production", isReady: false, issues: [] };
  assert.equal(fiscalOnboardingStatus(productionLink, activation), "PRODUCTION_ACTIVE");
  assert.equal(fiscalOnboardingLabel(productionLink), "Produkcija aktivna");
  assert.equal(fiscalOnboardingStatus({ ...productionLink, is_suspended: true }, activation), "SUSPENDED");
});

test("potvrđen test ostaje aktivan dok Fiscal API ne zatraži novi test", () => {
  const activation = { status: "TestPassed", environment: "Test", isReady: true, issues: [] };
  assert.equal(fiscalOnboardingStatus(pendingLink, activation), "TEST_ACTIVE");
  const testedLink = { ...pendingLink, onboarding_status: "TEST_ACTIVE" };
  const retest = { ...activation, status: "RetestRequired" };
  assert.equal(fiscalOnboardingStatus(testedLink, retest), "READY_FOR_TEST");
  assert.equal(fiscalOnboardingStatus(testedLink, { ...retest, isReady: false }), "IN_PROGRESS");
});

test("odbijeni EFI zahtjev s HTTP 200 čuva konkretan razlog i Correlation ID", async (t) => {
  const actor = { id: "admin", name: "admin" };
  const correlationId = "9c03cb442dd54ef082fc35f761a2d48e5";
  const submitted = { invoiceId: "test-invoice", invoiceNumber: "1", status: "FiscalizationFailed", isSuccess: false, faultCode: "env:CLIENT" };
  const oldBase = process.env.FISCAL_API_BASE_URL;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.FISCAL_API_BASE_URL = "http://localhost:5127";
  Object.assign(process.env, { NODE_ENV: "test" });
  t.after(() => {
    if (oldBase === undefined) delete process.env.FISCAL_API_BASE_URL;
    else process.env.FISCAL_API_BASE_URL = oldBase;
    if (oldNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: oldNodeEnv });
  });

  const failures = [
    ["Business unit code is not valid.", "Kod poslovne jedinice nije važeći."],
    ["Issuer does not exist.", "Izdavalac računa nije pronađen u EFI sistemu."],
    ["Operator code is not valid.", "Operator code is not valid."]
  ];
  for (const [raw, reason] of failures) {
    t.mock.method(globalThis, "fetch", async () => Response.json({
      success: true,
      correlationId,
      data: { ...submitted, faultMessage: `${raw} Code=11 RequestUUID=req ResponseUUID=resp` }
    }));
    const result = await fiscalAdminApi.fiscalizeInvoice("test-invoice", "FISCALIZE_TEST:test-invoice", actor);
    assert.equal(result.data.isSuccess, false);
    assert.equal(result.correlationId, correlationId);
    assert.equal(describeControlTestFailure(result.data), `EFI: ${reason} (kod: 11)`);
    t.mock.restoreAll();
  }
});

test("izostanak razloga ili JIKR-a ne prikazuje se kao EFI potvrda", () => {
  const submission = { invoiceId: "test-invoice", invoiceNumber: "1", status: "Fiscalized", isSuccess: true };
  const fallback = "Fiscal API nije vratio JIKR ni detaljan razlog.";
  assert.equal(describeControlTestFailure(submission), fallback);
  assert.equal(describeControlTestFailure({ ...submission, faultMessage: "<Fault>sirovi odgovor</Fault>" }), fallback);
  assert.equal(describeControlTestFailure({ ...submission, status: "FiscalizationFailed", jikr: "test-jikr" }),
    "Fiscal API nije potvrdio fiskalizaciju i nije vratio detaljan razlog.");
});
