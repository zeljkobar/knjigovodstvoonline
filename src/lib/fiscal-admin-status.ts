import type { FiscalActivation } from "./fiscal-admin-api";

type FiscalLinkStatus = {
  is_suspended: boolean;
  fiscal_environment: string | null;
  onboarding_status: string;
};

export function fiscalOnboardingStatus(link: FiscalLinkStatus, activation?: FiscalActivation | null) {
  if (link.is_suspended) return "SUSPENDED";
  if (activation?.environment === "Production" && activation.status === "ProductionActive") {
    return "PRODUCTION_ACTIVE";
  }
  if (activation?.environment === "Test") {
    if (activation.status === "TestPassed") return "TEST_ACTIVE";
    if (activation.status === "NotTested" || activation.status === "RetestRequired") {
      return activation.isReady ? "READY_FOR_TEST" : "IN_PROGRESS";
    }
  }
  // Starije osvježavanje spremnosti je moglo prepisati status, ali nije mijenjalo okruženje.
  if (!activation && link.fiscal_environment === "Production") return "PRODUCTION_ACTIVE";
  return link.onboarding_status;
}

const onboardingLabels: Record<string, string> = {
  NOT_CONFIGURED: "Nije podešeno",
  IN_PROGRESS: "Podešavanje u toku",
  READY_FOR_TEST: "Spremna za test",
  TEST_ACTIVE: "Test potvrđen",
  READY_FOR_PRODUCTION: "Spremna za produkciju",
  PRODUCTION_ACTIVE: "Produkcija aktivna",
  SUSPENDED: "Suspendovana"
};

export function fiscalOnboardingLabel(link?: FiscalLinkStatus | null, activation?: FiscalActivation | null) {
  return link ? onboardingLabels[fiscalOnboardingStatus(link, activation)] ?? "Nepoznat status" : "Nije podešeno";
}

export function fiscalActivationLabel(status?: string) {
  switch (status) {
    case "NotTested": return "Test nije potvrđen";
    case "TestPassed": return "Test potvrđen";
    case "RetestRequired": return "Potreban je novi test";
    case "ProductionActive": return "Produkcija aktivna";
    default: return "Status nije dostupan";
  }
}

export function fiscalEnvironmentLabel(environment?: string | null) {
  return environment === "Production" ? "Produkcija" : environment === "Test" ? "Test" : "—";
}
