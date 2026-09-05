import assert from "node:assert/strict";
import test from "node:test";
import { getPublicAppUrl } from "../src/lib/app-url";
import { internalRedirect } from "../src/lib/internal-redirect";
import { getAgencyNavigation, getSubNavigation } from "../src/lib/navigation";

test("interni redirect ostavlja relativan Location iza reverse proxy-ja", () => {
  const response = internalRedirect("/agencija/robno?status=DRAFT");

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/agencija/robno?status=DRAFT");
});

test("interni redirect odbija apsolutne i protocol-relative URL-ove", () => {
  assert.throws(() => internalRedirect("https://example.com/agencija"));
  assert.throws(() => internalRedirect("//example.com/agencija"));
});

test("produkcijski javni URL nikad ne koristi localhost", { concurrency: false }, () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousAppUrl = env.APP_URL;

  try {
    env.NODE_ENV = "production";
    env.APP_URL = "http://localhost:3004";
    assert.equal(getPublicAppUrl(), "https://knjigovodstvo.summasummarum.me");
  } finally {
    env.NODE_ENV = previousNodeEnv;
    env.APP_URL = previousAppUrl;
  }
});

test("radnik u glavnom meniju vidi samo module sa pravom pregleda", () => {
  const navigation = getAgencyNavigation(
    "korisnik_agencije",
    new Set(["robno:view"])
  );
  const sections = navigation.map((item) => item.section);

  assert.deepEqual(sections, ["dashboard", "robno"]);
  assert.equal(sections.includes("firme"), false);
  assert.equal(sections.includes("korisnici"), false);
  assert.equal(sections.includes("podesavanja"), false);
});

test("KIF/KUF je vidljiv sa pregledom bilo koje od dvije knjige", () => {
  const onlyKuf = getAgencyNavigation(
    "korisnik_agencije",
    new Set(["ulazni_racuni:view"])
  );
  const withoutBooks = getAgencyNavigation(
    "korisnik_agencije",
    new Set(["ulazni_racuni:create"])
  );

  assert.equal(onlyKuf.some((item) => item.section === "racuni"), true);
  assert.equal(withoutBooks.some((item) => item.section === "racuni"), false);
});

test("admin agencije zadržava kompletan meni bez eksplicitne matrice", () => {
  const navigation = getAgencyNavigation("admin_agencije");

  assert.equal(navigation.length, 13);
  assert.equal(navigation.some((item) => item.section === "zavrsni-racun"), true);
  assert.equal(navigation.some((item) => item.section === "korisnici"), true);
});

test("radnik ne vidi podešavanja unutar poslovnih modula", () => {
  for (const section of ["pos", "robno", "racuni", "pdv", "plate", "izvodi", "zavrsni-racun"]) {
    const workerItems = getSubNavigation(section, "korisnik_agencije");
    const adminItems = getSubNavigation(section, "admin_agencije");

    assert.equal(workerItems.some((item) => item.href.includes("/podesavanja")), false);
    assert.equal(adminItems.some((item) => item.href.includes("/podesavanja")), true);
  }
});

test("KIF/KUF podmeni prati odvojena prava pregleda i unosa", () => {
  const items = getSubNavigation(
    "racuni",
    "korisnik_agencije",
    new Set(["izlazni_racuni:view", "ulazni_racuni:create"])
  );
  const hrefs = items.map((item) => item.href);

  assert.equal(hrefs.includes("/agencija/racuni/kif"), true);
  assert.equal(hrefs.includes("/agencija/racuni/pregled-kif"), true);
  assert.equal(hrefs.includes("/agencija/racuni/kuf"), false);
  assert.equal(hrefs.includes("/agencija/racuni/pregled-kuf"), false);
  assert.equal(hrefs.includes("/agencija/racuni/neproknjizeno"), true);
  assert.equal(hrefs.includes("/agencija/racuni/import"), true);
});

test("pravila knjiženja izvoda traže pravo administracije modula", () => {
  const withoutManage = getSubNavigation(
    "izvodi",
    "korisnik_agencije",
    new Set(["izvodi:view"])
  );
  const withManage = getSubNavigation(
    "izvodi",
    "korisnik_agencije",
    new Set(["izvodi:view", "izvodi:manage"])
  );

  assert.equal(
    withoutManage.some((item) => item.href === "/agencija/izvodi/pravila"),
    false
  );
  assert.equal(
    withManage.some((item) => item.href === "/agencija/izvodi/pravila"),
    true
  );
});

test("statistika aktivnosti radnika je samo u admin podmeniju", () => {
  const workerItems = getSubNavigation("dashboard", "korisnik_agencije");
  const adminItems = getSubNavigation("dashboard", "admin_agencije");

  assert.equal(workerItems.some((item) => item.href === "/agencija/aktivnosti"), false);
  assert.equal(adminItems.some((item) => item.href === "/agencija/aktivnosti"), true);
});
