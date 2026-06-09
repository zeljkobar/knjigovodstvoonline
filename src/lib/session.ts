import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export type SessionUser = {
  korisnikId: string;
  rola: "admin" | "admin_agencije" | "korisnik_agencije" | "klijent";
};

const COOKIE_NAME = "sso_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET nije podesen u .env fajlu.");
  }

  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function verify(payload: string, signature: string) {
  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export async function createSession(session: SessionUser) {
  const payload = encode(
    JSON.stringify({
      ...session,
      exp: Date.now() + MAX_AGE_SECONDS * 1000
    })
  );

  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/"
  });
}

export async function readSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;

  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");

  if (!payload || !signature || !verify(payload, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(decode(payload)) as SessionUser & { exp: number };

    if (parsed.exp < Date.now()) {
      return null;
    }

    return {
      korisnikId: parsed.korisnikId,
      rola: parsed.rola
    };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
