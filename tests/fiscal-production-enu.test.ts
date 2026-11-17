import assert from "node:assert/strict";
import test from "node:test";
import type { FiscalBusinessUnit, FiscalCompany, FiscalDevice, FiscalProductionProfile } from "../src/lib/fiscal-admin-api";
import { linkProductionEnu } from "../src/lib/fiscal-production-enu";

const actor = { id: "admin-id", name: "admin" };
const company: FiscalCompany = {
  id: "company-id", tin: "01234567", legalName: "Test firma", country: "MNE",
  isVatPayer: true, isActive: true, environment: "Test"
};
const unit: FiscalBusinessUnit = {
  id: "production-unit", companyId: company.id, environment: "Production", code: "aa123bb456",
  name: "Produkcija", isActive: true
};
const input = {
  companyId: company.id, pib: company.tin, businessUnitId: unit.id, businessUnitCode: unit.code,
  tcrCode: "ab123cd456", internalCode: "KASA-01"
};
const savedEnu: FiscalDevice = {
  id: "541fd175-f3eb-45cb-b71f-ff5e34440fb7", companyId: company.id, businessUnitId: "test-unit",
  tcrCode: input.tcrCode, internalCode: input.internalCode, registrationStatus: "Registered", isActive: false
};

function fixture(devices: FiscalDevice[] = [], failFirstActivation = false) {
  let currentDevices = devices;
  const mutations: string[] = [];
  function existing(id: string) {
    const device = currentDevices.find((x) => x.id === id);
    if (!device) throw new Error("ENU nije pronađen.");
    return device;
  }
  function replace(device: FiscalDevice) {
    currentDevices = [...currentDevices.filter((x) => x.id !== device.id), device];
    return { data: device };
  }
  const api: Parameters<typeof linkProductionEnu>[0] = {
    getCompany: async () => ({ data: company }),
    getProductionProfile: async () => ({
      data: { businessUnit: unit, device: currentDevices.find((x) => x.businessUnitId === unit.id && x.isActive) } satisfies FiscalProductionProfile
    }),
    listDevices: async () => ({ data: currentDevices.filter((x) => x.businessUnitId === "test-unit") }),
    getDevice: async (_, id) => ({ data: existing(id) }),
    createDevice: async (_, payload) => {
      mutations.push("create");
      return replace({ ...savedEnu, ...payload, isActive: true });
    },
    updateDevice: async (_, id, payload) => {
      mutations.push("move");
      return replace({ ...existing(id), ...payload });
    },
    setDeviceActive: async (_, id, active) => {
      mutations.push("activate");
      if (failFirstActivation) {
        failFirstActivation = false;
        throw new Error("API veza je prekinuta.");
      }
      return replace({ ...existing(id), isActive: active });
    }
  };
  return { api, mutations, existing };
}

test("povezuje ENU koji je već registrovan u SEP-u i ponovni zahtjev ga ne duplira", async () => {
  const { api, mutations, existing } = fixture();
  await linkProductionEnu(api, actor, input, () => {});
  await linkProductionEnu(api, actor, input, () => {});
  assert.deepEqual(mutations, ["create"]);
  assert.equal(existing(savedEnu.id).businessUnitId, unit.id);
});

test("poslije prekida aktivacije nastavlja povezivanje premještenog ENU-a bez dupliranja", async () => {
  const { api, mutations, existing } = fixture([savedEnu], true);
  let retryDeviceId: string | undefined;
  await assert.rejects(linkProductionEnu(api, actor, input, (id) => { retryDeviceId = id; }), /veza je prekinuta/);
  assert.equal(retryDeviceId, savedEnu.id);
  assert.equal(existing(savedEnu.id).businessUnitId, unit.id);
  assert.equal(existing(savedEnu.id).isActive, false);
  await linkProductionEnu(api, actor, { ...input, retryDeviceId }, () => {});
  assert.deepEqual(mutations, ["move", "activate", "activate"]);
  assert.equal(existing(savedEnu.id).isActive, true);
});

test("čuva aktivni testni ENU, postojeći produkcioni ENU i promijenjenu jedinicu", async () => {
  const activeTest = fixture([{ ...savedEnu, isActive: true }]);
  await assert.rejects(linkProductionEnu(activeTest.api, actor, input, () => {}), /AKTIVAN_U_TESTU/);

  const otherProduction = fixture([{ ...savedEnu, businessUnitId: unit.id, tcrCode: "xy123zz456", isActive: true }]);
  await assert.rejects(linkProductionEnu(otherProduction.api, actor, input, () => {}), /VEC_POSTOJI/);
  await assert.rejects(linkProductionEnu(otherProduction.api, actor, { ...input, businessUnitCode: "xx123xx123" }, () => {}), /JEDINICA_PROMIJENJENA/);

  const foreignRetry = fixture([{ ...savedEnu, companyId: "other-company", businessUnitId: unit.id }]);
  await assert.rejects(linkProductionEnu(foreignRetry.api, actor, { ...input, retryDeviceId: savedEnu.id }, () => {}), /PODACI_SE_NE_POKLAPAJU/);
  assert.deepEqual([...activeTest.mutations, ...otherProduction.mutations, ...foreignRetry.mutations], []);
});
