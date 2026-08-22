import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticatedHomePath,
  classifyDirectCompanyCount,
  directPortalPaymentMethods,
  directPortalPermissionKey,
  hasDirectPortalPermission,
  mapDirectPortalReadiness,
  podgoricaBusinessDate,
  podgoricaDayUtcRange,
  selectDirectPortalYear
} from "../src/lib/direct-portal-policy";
import { getDirectPortalNavigation } from "../src/lib/portal-navigation";
import {
  buildPosSaleIdempotencyKey,
  isValidPosSubmissionId
} from "../src/lib/pos-sale-policy";

test("kontekstualni home čuva standardne tokove i izdvaja direktni portal", () => {
  assert.equal(authenticatedHomePath("admin", false), "/admin");
  assert.equal(authenticatedHomePath("admin_agencije", false), "/agencija");
  assert.equal(authenticatedHomePath("korisnik_agencije", false), "/agencija");
  assert.equal(authenticatedHomePath("klijent", false), "/klijent");
  assert.equal(authenticatedHomePath("korisnik_agencije", true), "/portal");
  assert.equal(authenticatedHomePath("klijent", true), "/klijent");
});

test("broj direktnih firmi razlikuje nijednu, jednu i više firmi", () => {
  assert.equal(classifyDirectCompanyCount(0), "NO_COMPANY");
  assert.equal(classifyDirectCompanyCount(1), "READY");
  assert.equal(classifyDirectCompanyCount(2), "MULTIPLE_COMPANIES");
});

test("tekuća poslovna godina ima prednost i kada je zaključana", () => {
  const selected = selectDirectPortalYear(
    [
      {
        id: "2026",
        godina: 2026,
        datum_od: new Date("2026-01-01T00:00:00.000Z"),
        datum_do: new Date("2026-12-31T00:00:00.000Z"),
        zakljucena: true
      },
      {
        id: "2025",
        godina: 2025,
        datum_od: new Date("2025-01-01T00:00:00.000Z"),
        datum_do: new Date("2025-12-31T00:00:00.000Z"),
        zakljucena: false
      }
    ],
    new Date("2026-08-19T00:00:00.000Z")
  );

  assert.equal(selected?.id, "2026");
  assert.equal(selected?.zakljucena, true);
});

test("bez tekuće godine bira najnoviju nezaključanu", () => {
  const selected = selectDirectPortalYear(
    [
      {
        id: "2024",
        godina: 2024,
        datum_od: new Date("2024-01-01T00:00:00.000Z"),
        datum_do: new Date("2024-12-31T00:00:00.000Z"),
        zakljucena: false
      },
      {
        id: "2025",
        godina: 2025,
        datum_od: new Date("2025-01-01T00:00:00.000Z"),
        datum_do: new Date("2025-12-31T00:00:00.000Z"),
        zakljucena: false
      }
    ],
    new Date("2026-08-19T00:00:00.000Z")
  );

  assert.equal(selected?.id, "2025");
  assert.equal(selectDirectPortalYear([], new Date()), null);
});

test("poslovni datum koristi Europe/Podgorica granicu dana", () => {
  assert.equal(
    podgoricaBusinessDate(new Date("2026-01-15T23:30:00.000Z")).toISOString(),
    "2026-01-16T00:00:00.000Z"
  );
  assert.deepEqual(podgoricaDayUtcRange(new Date("2026-01-15T12:00:00.000Z")), {
    start: new Date("2026-01-14T23:00:00.000Z"),
    end: new Date("2026-01-15T23:00:00.000Z")
  });
  assert.deepEqual(podgoricaDayUtcRange(new Date("2026-07-15T12:00:00.000Z")), {
    start: new Date("2026-07-14T22:00:00.000Z"),
    end: new Date("2026-07-15T22:00:00.000Z")
  });
});

test("dozvole i navigacija poštuju eksplicitni modul, akciju i POS setup", () => {
  const keys = new Set([
    directPortalPermissionKey({ modul: "fiskalizacija", akcija: "view" }),
    directPortalPermissionKey({ modul: "pos", akcija: "view" })
  ]);
  assert.equal(
    hasDirectPortalPermission(keys, { modul: "fiskalizacija", akcija: "post" }),
    false
  );

  const inactive = getDirectPortalNavigation(keys, false).map((item) => item.href);
  const active = getDirectPortalNavigation(keys, true).map((item) => item.href);
  assert.equal(inactive.includes("/portal/pos"), false);
  assert.equal(active.includes("/portal/pos"), true);
  assert.equal(active.includes("/portal/artikli"), false);
  assert.equal(active.includes("/portal/racuni"), true);
});

test("readiness mapper vraća samo bezbjedne portal statuse", () => {
  assert.equal(mapDirectPortalReadiness(null).code, "NEEDS_SUPPORT");
  const testLink = {
    fiscal_api_company_id: "company",
    fiscal_environment: "Test",
    onboarding_status: "TEST_ACTIVE",
    is_suspended: false
  };
  assert.equal(mapDirectPortalReadiness(testLink).code, "TEST");
  assert.equal(
    mapDirectPortalReadiness({ ...testLink, is_suspended: true }).code,
    "SUSPENDED"
  );
  assert.equal(
    mapDirectPortalReadiness(testLink, false).code,
    "SERVICE_UNAVAILABLE"
  );
});

test("payment methods follow the active fiscal profile", () => {
  assert.deepEqual(
    directPortalPaymentMethods("BankOnly").map((method) => method.value),
    ["BANK_TRANSFER"]
  );
  assert.deepEqual(
    directPortalPaymentMethods(null).map((method) => method.value),
    ["CASH", "CARD", "BANK_TRANSFER"]
  );
  assert.deepEqual(directPortalPaymentMethods("UnknownPolicy"), []);
});

test("POS submission keeps one stable idempotency identity", () => {
  const submissionId = "019fbd82-c79f-4b13-8811-af4bc87652c1";
  assert.equal(isValidPosSubmissionId(submissionId), true);
  assert.equal(isValidPosSubmissionId("not-a-uuid"), false);
  assert.equal(
    buildPosSaleIdempotencyKey("firma-1", submissionId),
    `pos:firma-1:${submissionId}`
  );
});
