import type { FiscalActivation, FiscalBusinessUnit, FiscalCertificate, FiscalCompany, FiscalDevice, FiscalOperator, FiscalProductionProfile } from "./fiscal-admin-api";
import { isValidFiscalTcrCode } from "./fiscal-production-enu";

// SEP registry identifiers shared by new Summa Fiscal clients in each environment.
export const SUMMA_FISCAL_SOFTWARE = {
  test: {
    producerCode: "qx357np160",
    softwareName: "SummaSummarum fiscal API",
    softwareVersion: "0.1.0",
    softwareCode: "zm955pb829",
    maintainerCode: "sv742uc940",
  },
  production: {
    producerCode: "gp177if699",
    softwareName: "Summa-fiscal-API",
    softwareVersion: "1.0.1",
    softwareCode: "lq099vq111",
    maintainerCode: "qf401hk617",
    isSoftwareCertified: true,
  },
} as const;

export const FISCAL_SETUP_STEPS = [
  { id: "sep", title: "Preuzmi iz SEP-a", help: "Izaberite sertifikat klijenta za direktnu prijavu u testni i produkcioni SEP. Ako isti služi i za potpisivanje, možete ga odmah sačuvati za tu namjenu." },
  { id: "firma", title: "Podaci firme", help: "Provjerite PIB, naziv, adresu i PDV status firme. Ti podaci identifikuju izdavaoca računa." },
  { id: "softver", title: "Testni softver", help: "Za novi profil kodovi Summa Fiscal su već popunjeni. Provjerite ih i sačuvajte testni profil." },
  { id: "jedinica", title: "Testna poslovna jedinica", help: "Izaberite aktivnu poslovnu jedinicu za test. Ako unosite kod ručno, naći ćete ga u testnom SEP-u pod Moji podaci → Poslovne jedinice." },
  { id: "enu", title: "Testni ENU", help: "Povežite ENU sa njegovom testnom poslovnom jedinicom. Za ručni unos, otvorite tu jedinicu u testnom SEP-u, pa u kartici ENU pogledajte polja Kod i Interna oznaka." },
  { id: "operater", title: "Testni operater", help: "Izaberite aktivnog operatera koji će izdavati testne račune. Kod za ručni unos je u testnom SEP-u pod Moji podaci → Operateri." },
  { id: "sertifikat", title: "Sertifikat", help: "Ako ste sačuvali fiskalni sertifikat u prvom koraku, otvorite njegov red i kliknite „Aktiviraj sertifikat“. Ako klijent koristi drugi sertifikat za potpisivanje, dodajte ga ovdje." },
  { id: "test", title: "Kontrolni račun", help: "Provjerite spremnost pa pošaljite kontrolni račun u testno okruženje. Možete nastaviti kada EFI vrati JIKR i aplikacija potvrdi test." },
  { id: "produkcioni-profil", title: "Produkcioni profil", help: "Za novi profil kodovi i verzija Summa Fiscal su već popunjeni. Iz produkcionog SEP-a odaberite poslovnu jedinicu i operatera ove firme, pa sačuvajte profil." },
  { id: "produkcioni-enu", title: "Produkcioni ENU", help: "Ako ENU već postoji na produkcionom SEP-u, povežite ga ovdje. Ako još ne postoji, registrujte novi za jedinicu iz prethodnog koraka." },
  { id: "aktivacija", title: "Aktivacija produkcije", help: "Provjerite produkcionu jedinicu, ENU i operatera. Kada ste spremni da izdajete stvarne račune, unesite cijeli tekst potvrde i kliknite Aktiviraj produkciju." }
] as const;

export type FiscalSetupStep = (typeof FISCAL_SETUP_STEPS)[number]["id"];

export function isFiscalSetupStep(value: unknown): value is FiscalSetupStep {
  return FISCAL_SETUP_STEPS.some((step) => step.id === value);
}

export function selectFiscalTestResources(units: FiscalBusinessUnit[], devices: FiscalDevice[], operators: FiscalOperator[]) {
  const testUnits = units.filter((unit) => !unit.environment || unit.environment === "Test");
  const testOperators = operators.filter((operator) => !operator.environment || operator.environment === "Test");
  const unitIds = new Set(testUnits.map((unit) => unit.id));
  const testDevices = devices.filter((device) => unitIds.has(device.businessUnitId));
  const activeUnits = testUnits.filter((unit) => unit.isActive && unit.code.trim());
  const activeDevices = testDevices.filter((device) => device.isActive && isValidFiscalTcrCode(device.tcrCode) &&
    (!device.registrationStatus || device.registrationStatus === "Registered"));
  const unit = activeUnits.find((item) => activeDevices.some((device) => device.businessUnitId === item.id)) ?? activeUnits[0];
  return {
    unit, device: activeDevices.find((device) => device.businessUnitId === unit?.id),
    operator: testOperators.find((operator) => operator.isActive && operator.operatorCode.trim()),
    units: testUnits, devices: testDevices, operators: testOperators
  };
}

export function fiscalSetupProgress(input: {
  pib?: string | null;
  name: string;
  company: FiscalCompany | null;
  activation: FiscalActivation | null;
  test: ReturnType<typeof selectFiscalTestResources>;
  certificates: FiscalCertificate[];
  productionProfile: FiscalProductionProfile | null;
  requested: unknown;
  suspended?: boolean;
  now: number;
}) {
  const { company, activation, test, productionProfile: profile, now } = input;
  const productionActive = activation?.environment === "Production" && activation.status === "ProductionActive";
  const testValid = activation?.environment === "Test" && activation.status === "TestPassed" &&
    activation.isReady && activation.isTestValidForCurrentConfiguration !== false &&
    Boolean(activation.testJikr?.trim() && (!activation.testValidUntil || Date.parse(activation.testValidUntil) > now));
  const productionUnit = profile?.businessUnit;
  const productionOperator = profile?.operator;
  const productionEnu = profile?.device;
  const complete: Record<FiscalSetupStep, boolean> = {
    sep: true,
    firma: Boolean(input.pib?.trim() && input.name.trim()),
    softver: Boolean(company?.environment === "Test" && company.softwareCode?.trim() && company.maintainerCode?.trim()),
    jedinica: Boolean(test.unit),
    enu: Boolean(test.device),
    operater: Boolean(test.operator),
    sertifikat: input.certificates.some((cert) => cert.isActive && Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) > now),
    test: testValid,
    "produkcioni-profil": Boolean(profile?.isSoftwareCertified && profile.producerCode?.trim() && profile.softwareName?.trim() &&
      profile.softwareVersion?.trim() && profile.softwareCode?.trim() && profile.maintainerCode?.trim() &&
      productionUnit?.environment === "Production" && productionUnit.isActive && productionUnit.code.trim() &&
      productionOperator?.isActive && productionOperator.operatorCode.trim() &&
      (!productionOperator.environment || productionOperator.environment === "Production")),
    "produkcioni-enu": Boolean(productionUnit && productionEnu?.isActive && productionEnu.registrationStatus === "Registered" &&
      productionEnu.businessUnitId === productionUnit.id && isValidFiscalTcrCode(productionEnu.tcrCode)),
    aktivacija: productionActive
  };
  const last = FISCAL_SETUP_STEPS.length - 1;
  const firstIncomplete = FISCAL_SETUP_STEPS.findIndex(({ id }) => !complete[id]);
  const available = productionActive ? last : firstIncomplete === -1 ? last : firstIncomplete;
  const requested = FISCAL_SETUP_STEPS.findIndex(({ id }) => id === input.requested);
  const start = company ? available : 0;
  const index = productionActive ? last : Math.min(requested < 0 ? start : requested, available);
  return { complete, available, index, productionActive, canActivate: !input.suspended && company?.isActive === true && company.environment === "Test" && available === last && !productionActive };
}
