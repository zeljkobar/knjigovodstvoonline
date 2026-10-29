import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = process.env.MAIL_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("MAIL_KEY_MISSING");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("MAIL_KEY_MISSING");
  return decoded;
}
export function mailKeyConfigured() { try { key(); return true; } catch { return false; } }
export function encryptMailPassword(password: string, agencyId: string, accountId: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`mail:${agencyId}:${accountId}`));
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function decryptMailPassword(value: string, agencyId: string, accountId: string) {
  const [version, iv, tag, payload, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload || extra) throw new Error("MAIL_SECRET_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(`mail:${agencyId}:${accountId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]);
    try { return plaintext.toString("utf8"); } finally { plaintext.fill(0); }
  } catch { throw new Error("MAIL_SECRET_INVALID"); }
}
