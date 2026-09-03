import { createHash, randomBytes } from "crypto";
import { createPublicAppUrl } from "@/lib/app-url";

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
  const url = createPublicAppUrl("/postavi-lozinku");
  url.searchParams.set("token", token);

  return url.toString();
}
