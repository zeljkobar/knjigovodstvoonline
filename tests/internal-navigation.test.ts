import assert from "node:assert/strict";
import test from "node:test";
import { getPublicAppUrl } from "../src/lib/app-url";
import { internalRedirect } from "../src/lib/internal-redirect";

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
