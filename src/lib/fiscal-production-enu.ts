import type { fiscalAdminApi, FiscalActor, FiscalDevice } from "./fiscal-admin-api";

type EnuApi = Pick<typeof fiscalAdminApi, "getCompany" | "getProductionProfile" | "listDevices" |
  "getDevice" | "createDevice" | "updateDevice" | "setDeviceActive">;

type LinkInput = {
  companyId: string;
  pib: string;
  businessUnitId: string;
  businessUnitCode: string;
  tcrCode: string;
  internalCode: string;
  retryDeviceId?: string;
};

export const FISCAL_TCR_PATTERN = "[a-z]{2}[0-9]{3}[a-z]{2}[0-9]{3}";
export const FISCAL_DEVICE_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fiscalTcrPattern = new RegExp(`^${FISCAL_TCR_PATTERN}$`);

export function isValidFiscalTcrCode(value: string | null | undefined) {
  return typeof value === "string" && fiscalTcrPattern.test(value);
}

export class ProductionEnuLinkError extends Error {}

export async function linkProductionEnu(
  api: EnuApi,
  actor: FiscalActor,
  input: LinkInput,
  onDeviceIdentified: (deviceId: string) => void
) {
  const { companyId, pib, businessUnitId, businessUnitCode, tcrCode, internalCode, retryDeviceId } = input;
  if (!isValidFiscalTcrCode(tcrCode) || !internalCode ||
      (retryDeviceId && !FISCAL_DEVICE_ID_PATTERN.test(retryDeviceId))) {
    throw new ProductionEnuLinkError("PRODUKCIONI_ENU_NEISPRAVAN_UNOS");
  }

  const { data: company } = await api.getCompany(companyId, actor);
  if (company.id !== companyId || company.tin !== pib || !company.isActive || company.environment !== "Test") {
    throw new ProductionEnuLinkError("PRODUKCIONI_ENU_NEDOSTUPNO");
  }

  const { data: profile } = await api.getProductionProfile(companyId, actor);
  const unit = profile.businessUnit;
  if (!unit?.isActive || unit.environment !== "Production" || unit.companyId !== companyId ||
      unit.id !== businessUnitId || unit.code !== businessUnitCode) {
    throw new ProductionEnuLinkError("PRODUKCIONA_JEDINICA_PROMIJENJENA");
  }

  const matchesDevice = (device: FiscalDevice | null | undefined) => device?.companyId === companyId &&
    device.tcrCode === tcrCode && device.internalCode === internalCode && device.registrationStatus === "Registered";
  const isLinked = (device: FiscalDevice | null | undefined) =>
    device?.isActive === true && device.businessUnitId === unit.id && matchesDevice(device);

  if (profile.device) {
    if (isLinked(profile.device)) return;
    throw new ProductionEnuLinkError("PRODUKCIONI_ENU_VEC_POSTOJI");
  }

  const { data: testDevices } = await api.listDevices(companyId, actor);
  const testDevice = testDevices.find((device) => device.tcrCode === tcrCode);
  let device = testDevice;
  if (!device && retryDeviceId) {
    const retry = (await api.getDevice(companyId, retryDeviceId, actor)).data;
    if (retry.businessUnitId !== unit.id || !matchesDevice(retry)) {
      throw new ProductionEnuLinkError("PRODUKCIONI_ENU_PODACI_SE_NE_POKLAPAJU");
    }
    device = retry;
  }

  const payload = { businessUnitId: unit.id, tcrCode, internalCode };
  if (device) {
    if (!matchesDevice(device)) throw new ProductionEnuLinkError("PRODUKCIONI_ENU_PODACI_SE_NE_POKLAPAJU");
    // Moving a device used in Test would change the confirmed Test configuration.
    if (testDevice && device.isActive) throw new ProductionEnuLinkError("PRODUKCIONI_ENU_AKTIVAN_U_TESTU");
    onDeviceIdentified(device.id);
    if (device.businessUnitId !== unit.id) {
      device = (await api.updateDevice(companyId, device.id, payload, actor)).data;
    }
  } else {
    device = (await api.createDevice(companyId, payload, actor)).data;
    onDeviceIdentified(device.id);
  }

  if (!matchesDevice(device) || device.businessUnitId !== unit.id) {
    throw new ProductionEnuLinkError("PRODUKCIONI_ENU_PROVJERA_NIJE_PROSLA");
  }
  if (!device.isActive) await api.setDeviceActive(companyId, device.id, true, actor);
  const { data: updatedProfile } = await api.getProductionProfile(companyId, actor);
  if (updatedProfile.businessUnit?.id !== unit.id || updatedProfile.businessUnit.code !== unit.code ||
      !isLinked(updatedProfile.device)) {
    throw new ProductionEnuLinkError("PRODUKCIONI_ENU_PROVJERA_NIJE_PROSLA");
  }
}
