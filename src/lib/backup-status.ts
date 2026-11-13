export const backupDatabases = [
  { id: "knjigovodstvoonline", label: "Knjigovodstvo", folder: "knjigovodstvoonline" },
  { id: "summa_fiscal", label: "Fiskal API", folder: "fiskal-api" },
  { id: "spedicija", label: "Špedicija", folder: "spedicija" },
  { id: "turizam_prod", label: "Turizam", folder: "turizam_prod" }
] as const;

export type BackupDatabase = typeof backupDatabases[number]["id"];
export const backupPhases = {
  queued: "Čeka red", dumping: "Pravi kopiju baze", encrypting: "Šifruje kopiju",
  uploading: "Šalje na OneDrive", verifying: "Provjerava poslatu kopiju",
  pruning: "Uklanja stare kopije", done: "Završeno", failed: "Neuspješno"
} as const;
export type BackupPhase = keyof typeof backupPhases;
export type BackupRow = {
  database: BackupDatabase;
  lastSuccess: { verifiedAt: string; bytes: number; filename: string } | null;
  lastAttempt: { finishedAt: string | null; ok: boolean } | null;
  phase: BackupPhase | null;
};
export type BackupStatus = {
  version: 1; checkedAt: string; running: boolean; retryPending: boolean; serviceFailed: boolean;
  startedAt: string | null;
  scheduler: { enabled: boolean; active: boolean; nextRunAt: string | null };
  lastRestoreAt: string | null;
  databases: BackupRow[];
};
export type BackupSnapshot = { available: true; status: BackupStatus } | { available: false; message: string };
export type BackupStartStatus = "accepted" | "already_running" | "already_requested" | "cooldown";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backup response");
  return value as Record<string, unknown>;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid backup boolean");
  return value;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid backup date");
  return new Date(value).toISOString();
}

// Reconstruct an allowlisted public projection; never forward raw server state.
export function parseBackupStatus(input: unknown): BackupStatus {
  const raw = object(input), scheduler = object(raw.scheduler);
  const checkedAt = date(raw.checkedAt);
  if (raw.version !== 1 || !checkedAt || !Array.isArray(raw.databases) || raw.databases.length !== 4) throw new Error("Invalid backup status");
  const rows = raw.databases.map(object);
  const databases = backupDatabases.map(({ id }) => {
    const matches = rows.filter(row => row.database === id);
    if (matches.length !== 1) throw new Error("Invalid backup database scope");
    const row = matches[0];
    let lastSuccess: BackupRow["lastSuccess"] = null;
    if (row.lastSuccess !== null) {
      const saved = object(row.lastSuccess), verifiedAt = date(saved.verifiedAt);
      if (!verifiedAt || typeof saved.bytes !== "number" || !Number.isSafeInteger(saved.bytes) || saved.bytes <= 0 ||
          typeof saved.filename !== "string" || !new RegExp(`^summa-${id}-\\d{8}T\\d{6}Z-[a-f0-9]{8}\\.tar\\.age$`).test(saved.filename)) throw new Error("Invalid backup metadata");
      lastSuccess = { verifiedAt, bytes: saved.bytes, filename: saved.filename };
    }
    let lastAttempt: BackupRow["lastAttempt"] = null;
    if (row.lastAttempt !== null) {
      const attempt = object(row.lastAttempt);
      lastAttempt = { finishedAt: date(attempt.finishedAt), ok: boolean(attempt.ok) };
    }
    if (row.phase !== null && (typeof row.phase !== "string" || !Object.hasOwn(backupPhases, row.phase))) throw new Error("Invalid backup phase");
    return { database: id, lastSuccess, lastAttempt, phase: row.phase as BackupPhase | null };
  });
  return { version: 1, checkedAt, running: boolean(raw.running), retryPending: boolean(raw.retryPending),
    serviceFailed: boolean(raw.serviceFailed), startedAt: date(raw.startedAt), lastRestoreAt: date(raw.lastRestoreAt),
    scheduler: { enabled: boolean(scheduler.enabled), active: boolean(scheduler.active), nextRunAt: date(scheduler.nextRunAt) }, databases };
}

export function backupRowState(row: BackupRow, status: BackupStatus): { text: string; tone: "success" | "warning" | "error" | "info" } {
  if (status.running && row.phase) return { text: backupPhases[row.phase], tone: row.phase === "failed" ? "error" : row.phase === "done" ? "success" : "info" };
  if (row.lastAttempt?.ok === false) return { text: "Posljednji pokušaj nije uspio", tone: "error" };
  if (!row.lastSuccess) return { text: "Još nema potvrđene kopije", tone: "warning" };
  const age = Date.parse(status.checkedAt) - Date.parse(row.lastSuccess.verifiedAt);
  if (age > 26 * 60 * 60 * 1000 || age < -5 * 60 * 1000) return { text: "Potrebna provjera datuma kopije", tone: "warning" };
  return { text: "OneDrive kopija provjerena", tone: "success" };
}

export function backupDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("sr-Latn-ME", { timeZone: "Europe/Podgorica", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)) : "—";
}
export function backupSize(bytes: number) {
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1 ? `${megabytes.toLocaleString("sr-Latn-ME", { maximumFractionDigits: 2 })} MB` : `${(bytes / 1024).toLocaleString("sr-Latn-ME", { maximumFractionDigits: 1 })} KB`;
}
