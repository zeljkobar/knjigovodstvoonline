import assert from "node:assert/strict";
import test from "node:test";
import type { FiscalActivation, FiscalBusinessUnit, FiscalCertificate, FiscalCompany, FiscalDevice, FiscalOperator, FiscalProductionProfile } from "../src/lib/fiscal-admin-api";
import { FISCAL_SETUP_STEPS, fiscalSetupProgress, selectFiscalTestResources } from "../src/lib/fiscal-setup";

const company: FiscalCompany = {
  id: "company", tin: "01234567", legalName: "Primjer DOO", country: "MNE", environment: "Test",
  isVatPayer: true, isActive: true, softwareCode: "aa111bb222", maintainerCode: "cc333dd444"
};
const unit: FiscalBusinessUnit = { id: "unit", companyId: company.id, code: "aa111cc333", environment: "Test", name: "Test", isActive: true };
const operator: FiscalOperator = { id: "operator", companyId: company.id, environment: "Test", operatorCode: "bb222cc333", isActive: true };
const device: FiscalDevice = { id: "device", companyId: company.id, businessUnitId: unit.id, tcrCode: "aa111dd444", internalCode: "TEST-1", registrationStatus: "Registered", isActive: true };
const certificate: FiscalCertificate = {
  id: "cert", companyId: company.id, fileName: "example.pfx", thumbprint: "test", subject: "test", issuer: "test",
  validFrom: "2026-01-01T00:00:00Z", validTo: "2027-01-01T00:00:00Z", isActive: true
};
const activation: FiscalActivation = { environment: "Test", status: "TestPassed", isReady: true, issues: [], testJikr: "test-jikr", isTestValidForCurrentConfiguration: true };
const productionUnit = { ...unit, id: "prod-unit", environment: "Production", code: "pp111rr222" };
const productionDevice = { ...device, id: "prod-device", businessUnitId: productionUnit.id, tcrCode: "pp222rr333" };
const productionProfile: FiscalProductionProfile = {
  producerCode: "pp333rr444", softwareName: "Primjer", softwareVersion: "1.0.0", softwareCode: "pp444rr555", maintainerCode: "pp555rr666",
  isSoftwareCertified: true, businessUnit: productionUnit, device: productionDevice,
  operator: { ...operator, id: "prod-operator", environment: "Production" }
};

function progress(overrides: Partial<Parameters<typeof fiscalSetupProgress>[0]> = {}) {
  const result = fiscalSetupProgress({
    pib: company.tin, name: company.legalName, company, activation, test: selectFiscalTestResources([unit], [device], [operator]),
    certificates: [certificate], productionProfile, requested: undefined, now: Date.parse("2026-11-17T12:00:00Z"), ...overrides
  });
  return { ...result, step: FISCAL_SETUP_STEPS[result.index].id };
}

test("new firms start with SEP import and can continue manually; a direct link cannot skip missing setup", () => {
  assert.equal(progress({ company: null, activation: null }).step, "sep");
  assert.equal(progress({ company: null, activation: null, requested: "firma" }).step, "firma");
  assert.equal(progress({ company: null, activation: null, requested: "aktivacija" }).step, "softver");
  assert.equal(progress({ pib: null, requested: "enu" }).step, "firma");
  assert.equal(progress({ productionProfile: null }).step, "produkcioni-profil");
  assert.equal(progress({ productionProfile: null, requested: "enu" }).step, "enu");
});

test("test selection uses an active registered ENU and its matching test unit", () => {
  const earlierUnit = { ...unit, id: "earlier-unit" };
  const options = selectFiscalTestResources([earlierUnit, productionUnit, unit], [
    { ...device, businessUnitId: earlierUnit.id, registrationStatus: "Pending" }, productionDevice, device
  ], [productionProfile.operator!, operator]);
  assert.equal(options.unit, unit);
  assert.equal(options.device, device);
  assert.equal(options.operator, operator);
  assert.deepEqual(options.units, [earlierUnit, unit]);
  assert.equal(options.devices.includes(productionDevice), false);
});

test("expired certificate, failed readiness, and an unconfirmed or stale JIKR block production steps", () => {
  assert.equal(progress({ certificates: [{ ...certificate, validTo: "2026-11-16" }], requested: "aktivacija" }).step, "sertifikat");
  for (const invalid of [{ isReady: false }, { status: "NotTested" }, { testJikr: null }, { isTestValidForCurrentConfiguration: false }]) {
    const result = progress({ activation: { ...activation, ...invalid }, requested: "aktivacija" });
    assert.equal(result.step, "test");
    assert.equal(result.canActivate, false);
  }
});

test("activation needs a certified profile and an active registered ENU for that production unit", () => {
  assert.equal(progress({ productionProfile: { ...productionProfile, isSoftwareCertified: false } }).step, "produkcioni-profil");
  for (const invalid of [null, { ...productionDevice, businessUnitId: unit.id }, { ...productionDevice, isActive: false }]) {
    const result = progress({ productionProfile: { ...productionProfile, device: invalid }, requested: "aktivacija" });
    assert.equal(result.step, "produkcioni-enu");
    assert.equal(result.canActivate, false);
  }
  assert.equal(progress().step, "aktivacija");
  assert.equal(progress().canActivate, true);
  assert.equal(progress({ suspended: true }).canActivate, false);
});

test("a firm already in production is complete even when its test resources are not listed", () => {
  const result = progress({
    company: { ...company, environment: "Production" }, activation: { ...activation, environment: "Production", status: "ProductionActive" },
    test: selectFiscalTestResources([], [], []), requested: "firma"
  });
  assert.equal(result.productionActive, true);
  assert.equal(result.step, "aktivacija");
  assert.equal(result.canActivate, false);
});
