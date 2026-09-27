import { createHash } from "node:crypto";

export const mailImportLabels: Record<string, string> = {
  IMPORTED: "Uvezen", DUPLICATE: "Već postoji", REVIEW: "Potrebna provjera",
  ERROR: "Greška", SKIPPED: "Preskočen"
};
export class MailImportError extends Error {}
export function mailSourceKey(folder: string, validity: string, uid: number) {
  return createHash("sha256").update(JSON.stringify([folder, validity, uid])).digest("hex");
}
export function attachmentHash(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}
export function supportedStatementAttachment(name: string) {
  return /\.(pdf|xml|html?)$/i.test(name);
}
export function normalizeStatementAccount(value: string | null | undefined) {
  const compact = String(value || "").trim().replace(/\s/g, "").replace(/^ME\d{2}/i, "");
  if (!/^(?:\d{3}-\d{1,13}-\d{2}|\d{6,18})$/.test(compact)) return "";
  const digits = compact.replace(/-/g, "");
  return digits.slice(0, 3) + digits.slice(3, -2).padStart(13, "0") + digits.slice(-2);
}
export function assertStatementAccount(account: string | null | undefined, expected: string) {
  if (!normalizeStatementAccount(account) || normalizeStatementAccount(account) !== normalizeStatementAccount(expected)) {
    throw new MailImportError("Račun iz priloga nije prepoznat ili ne pripada izabranom računu firme.");
  }
}
