import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key() {
  const raw = process.env.FISCAL_PORTAL_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error("PORTAL_KEY_MISSING");
  return Buffer.from(raw, "base64");
}
export function fiscalPortalKeyConfigured() { try { return key().length === 32; } catch { return false; } }
export function encryptPortalPassword(password: string, scope: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`fiscal-portal:${scope}`));
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}
export function decryptPortalPassword(value: string, scope: string) {
  try {
    const [version, iv, tag, data, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !data || extra) throw new Error();
    const nonce = Buffer.from(iv, "base64"), authTag = Buffer.from(tag, "base64");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(`fiscal-portal:${scope}`)); cipher.setAuthTag(authTag);
    const plain = Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]);
    try { return plain.toString("utf8"); } finally { plain.fill(0); }
  } catch { throw new Error("PORTAL_SECRET_INVALID"); }
}
export type PazarImportProof = {
  agencyId: string; companyId: string; companyPib: string; yearId: string; bookId: string; userId: string;
  configId: string; configVersion: string; provider: string; deviceId: string; cashRegister: string;
  from: string; to: string; digest: string; expires: number;
};
export function signPazarImport(proof: PazarImportProof) {
  const data = Buffer.from(JSON.stringify(proof)).toString("base64url");
  return `${data}.${createHmac("sha256", key()).update(`pazar-import:${data}`).digest("base64url")}`;
}
export function verifyPazarImport(token: string): PazarImportProof {
  try {
    if (token.length > 6000) throw new Error();
    const [data, signature, extra] = token.split(".");
    if (!data || !signature || extra) throw new Error();
    const expected = createHmac("sha256", key()).update(`pazar-import:${data}`).digest(), actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const proof = JSON.parse(Buffer.from(data, "base64url").toString()) as PazarImportProof;
    if (!Number.isFinite(proof.expires) || proof.expires < Date.now()) throw new Error();
    return proof;
  } catch { throw new Error("Pazar uvoz je istekao ili nije ispravan. Ponovo preuzmite izvještaj."); }
}
