import { createHash, randomBytes } from "crypto";

export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashInvitationToken(token)
  };
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createInvitationUrl(token: string) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const url = new URL("/postavi-lozinku", appUrl);
  url.searchParams.set("token", token);

  return url.toString();
}
