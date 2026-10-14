import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createSecureContext } from "node:tls";

export type SepCredentials = { pfx: string; password: string; jmbg: string };
export const MAX_SEP_PFX_BYTES = 512 * 1024;

function key() {
  const value = process.env.SEP_ENCRYPTION_KEY ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("SEP_KEY_MISSING");
  const result = Buffer.from(value, "base64");
  if (result.length !== 32) throw new Error("SEP_KEY_MISSING");
  return result;
}
export function sepKeyConfigured() { try { key(); return true; } catch { return false; } }

export function validateSepCredentials(pfx: Buffer, password: string, jmbg: string) {
  if (!pfx.length || pfx.length > MAX_SEP_PFX_BYTES) throw new Error("INVALID_PFX_SIZE");
  if (!/^\d{13}$/.test(jmbg)) throw new Error("INVALID_JMBG");
  if (password.length > 1024) throw new Error("INVALID_PASSWORD_LENGTH");
  try { createSecureContext({ pfx, passphrase: password }); }
  catch { throw new Error("INVALID_PFX_PASSWORD"); }
}

// AAD binds the ciphertext to both tenant and owner; copying it cannot grant access.
export function encryptSepCredentials(credentials: SepCredentials, scope: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(scope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function decryptSepCredentials(value: string, scope: string): SepCredentials {
  const [version, iv, tag, payload, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload || extra) throw new Error("SEP_SECRET_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]);
    try {
      const result = JSON.parse(plaintext.toString("utf8"));
      if (typeof result.pfx !== "string" || typeof result.password !== "string" || !/^\d{13}$/.test(result.jmbg)) throw new Error();
      return result;
    } finally { plaintext.fill(0); }
  } catch { throw new Error("SEP_SECRET_INVALID"); }
}
