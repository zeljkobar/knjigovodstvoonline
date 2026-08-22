export const DIRECT_PORTAL_ACCESS_TYPES = [
  "FISCAL_CLIENT",
  "FISCAL_OPERATOR"
] as const;

export type DirectPortalAccessType =
  (typeof DIRECT_PORTAL_ACCESS_TYPES)[number];

export type DirectPortalPermission = {
  modul: string;
  akcija: string;
};

export type DirectPortalYearCandidate = {
  id: string;
  godina: number;
  datum_od: Date;
  datum_do: Date;
  zakljucena: boolean;
};

export type DirectPortalReadinessCode =
  | "READY"
  | "TEST"
  | "SUSPENDED"
  | "NEEDS_SUPPORT"
  | "SERVICE_UNAVAILABLE";

export type DirectPortalReadiness = {
  code: DirectPortalReadinessCode;
  label: string;
  blocksChanges: boolean;
};

export const DIRECT_PORTAL_PAYMENT_METHODS = [
  { value: "CASH", label: "Gotovina" },
  { value: "CARD", label: "Kartica" },
  { value: "BANK_TRANSFER", label: "Virman" }
] as const;

export type DirectPortalPaymentMethod =
  (typeof DIRECT_PORTAL_PAYMENT_METHODS)[number]["value"];

export function directPortalPaymentMethods(paymentPolicy?: string | null) {
  const normalized = paymentPolicy?.trim().toLocaleLowerCase() ?? "";

  if (normalized === "bankonly") {
    return DIRECT_PORTAL_PAYMENT_METHODS.filter(
      (method) => method.value === "BANK_TRANSFER"
    );
  }

  if (!normalized) {
    return [...DIRECT_PORTAL_PAYMENT_METHODS];
  }

  return [];
}

export const DIRECT_PORTAL_OWNER_PERMISSIONS: DirectPortalPermission[] = [
  { modul: "fiskalizacija", akcija: "view" },
  { modul: "fiskalizacija", akcija: "create" },
  { modul: "fiskalizacija", akcija: "post" },
  { modul: "fiskalizacija", akcija: "cancel" },
  { modul: "pos", akcija: "view" },
  { modul: "pos", akcija: "create" },
  { modul: "pos", akcija: "cancel" },
  { modul: "pos", akcija: "export" },
  { modul: "pos", akcija: "manage" },
  { modul: "robno", akcija: "view" },
  { modul: "robno", akcija: "create" },
  { modul: "robno", akcija: "update" },
  { modul: "robno", akcija: "manage" },
  { modul: "izvjestaji", akcija: "view" },
  { modul: "izvjestaji", akcija: "export" }
];

export function directPortalOperatorPermissions(
  enabledFiscalActions: ReadonlySet<string>
) {
  const permissions: DirectPortalPermission[] = [];

  if (enabledFiscalActions.has("view")) {
    permissions.push({ modul: "pos", akcija: "view" });
  }

  if (
    enabledFiscalActions.has("create") &&
    enabledFiscalActions.has("post")
  ) {
    permissions.push({ modul: "pos", akcija: "create" });
  }

  if (enabledFiscalActions.has("cancel")) {
    permissions.push({ modul: "pos", akcija: "cancel" });
  }

  return permissions;
}

export type AuthenticatedRole =
  | "admin"
  | "admin_agencije"
  | "korisnik_agencije"
  | "klijent";

export function authenticatedHomePath(
  role: AuthenticatedRole,
  fiscalPortalAccess: boolean
) {
  if (fiscalPortalAccess && role === "korisnik_agencije") {
    return "/portal";
  }

  const paths: Record<AuthenticatedRole, string> = {
    admin: "/admin",
    admin_agencije: "/agencija",
    korisnik_agencije: "/agencija",
    klijent: "/klijent"
  };

  return paths[role];
}

export function directPortalPermissionKey(
  permission: DirectPortalPermission
) {
  return `${permission.modul}:${permission.akcija}`;
}

export function hasDirectPortalPermission(
  permissionKeys: ReadonlySet<string>,
  permission: DirectPortalPermission
) {
  return permissionKeys.has(directPortalPermissionKey(permission));
}

export function classifyDirectCompanyCount(count: number) {
  if (count === 0) {
    return "NO_COMPANY" as const;
  }

  if (count > 1) {
    return "MULTIPLE_COMPANIES" as const;
  }

  return "READY" as const;
}

export function podgoricaBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Podgorica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

function podgoricaOffsetMinutes(at: Date) {
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Podgorica",
    timeZoneName: "longOffset"
  })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = zoneName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("Europe/Podgorica UTC offset nije dostupan.");
  }

  const value = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -value : value;
}

export function podgoricaDayUtcRange(now = new Date()) {
  const localDate = podgoricaBusinessDate(now);
  const nextLocalDate = new Date(localDate.getTime() + 24 * 60 * 60 * 1000);
  const startGuess = localDate.getTime();
  const endGuess = nextLocalDate.getTime();

  return {
    start: new Date(
      startGuess - podgoricaOffsetMinutes(new Date(startGuess)) * 60 * 1000
    ),
    end: new Date(
      endGuess - podgoricaOffsetMinutes(new Date(endGuess)) * 60 * 1000
    )
  };
}

export function selectDirectPortalYear(
  years: DirectPortalYearCandidate[],
  businessDate = podgoricaBusinessDate()
) {
  const day = businessDate.getTime();
  const current = years.find(
    (year) =>
      year.datum_od.getTime() <= day && year.datum_do.getTime() >= day
  );

  if (current) {
    return current;
  }

  return (
    years
      .filter((year) => !year.zakljucena)
      .sort(
        (left, right) =>
          right.godina - left.godina ||
          right.datum_od.getTime() - left.datum_od.getTime()
      )[0] ?? null
  );
}

type FiscalLinkSnapshot = {
  fiscal_api_company_id: string | null;
  fiscal_environment: string | null;
  onboarding_status: string;
  is_suspended: boolean;
} | null;

export function mapDirectPortalReadiness(
  link: FiscalLinkSnapshot,
  serviceAvailable = true
): DirectPortalReadiness {
  if (!serviceAvailable) {
    return {
      code: "SERVICE_UNAVAILABLE",
      label: "Fiskalni servis trenutno nije dostupan",
      blocksChanges: true
    };
  }

  if (link?.is_suspended) {
    return {
      code: "SUSPENDED",
      label: "Rad privremeno onemogućen",
      blocksChanges: true
    };
  }

  if (!link?.fiscal_api_company_id) {
    return {
      code: "NEEDS_SUPPORT",
      label: "Potrebna intervencija podrške",
      blocksChanges: true
    };
  }

  if (
    link.fiscal_environment === "Production" &&
    link.onboarding_status === "PRODUCTION_ACTIVE"
  ) {
    return {
      code: "READY",
      label: "Spremno za rad",
      blocksChanges: false
    };
  }

  if (
    link.fiscal_environment === "Test" &&
    ["READY_FOR_TEST", "TEST_ACTIVE"].includes(link.onboarding_status)
  ) {
    return {
      code: "TEST",
      label: "Testno okruženje",
      blocksChanges: false
    };
  }

  return {
    code: "NEEDS_SUPPORT",
    label: "Potrebna intervencija podrške",
    blocksChanges: true
  };
}
