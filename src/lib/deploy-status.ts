export const deploySite = "knjigovodstvoonline" as const;
export const deployPhases = {
  queued: "Zahtjev je prihvaćen", preflight: "Provjera uslova", backup: "Pravljenje i provjera backup-a",
  pull: "Preuzimanje nove verzije", dependencies: "Priprema aplikacije", migrations: "Primjena migracija baze",
  generate: "Priprema pristupa bazi", build: "Priprema nove verzije sajta", restart: "Restart aplikacije",
  health: "Provjera dostupnosti sajta", done: "Deploy završen"
} as const;
export type DeployPhase = keyof typeof deployPhases;
export type DeployStartStatus = "accepted" | "already_running" | "already_requested" | "cooldown" | "setup_required";
export type DeployStatus = {
  version: 1; site: typeof deploySite; ready: boolean; checkedAt: string; running: boolean;
  outcome: "idle" | "running" | "succeeded" | "failed"; requestId: string | null; phase: DeployPhase;
  startedAt: string | null; finishedAt: string | null; currentCommit: string | null;
  lastSuccess: { at: string; commit: string } | null;
  error: "backup_failed" | "script_failed" | "preflight_failed" | "start_failed" | "interrupted" | null;
};
export type DeploySnapshot = { available: true; status: DeployStatus } | { available: false; message: string };
export function parseDeployStatus(value: unknown): DeployStatus {
  function record(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid deploy response");
    return v as Record<string, unknown>;
  }
  function flag(v: unknown) { if (typeof v !== "boolean") throw new Error("Invalid deploy flag"); return v; }
  function date(v: unknown): string | null {
    if (v === null) return null;
    if (typeof v !== "string" || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(v) || !Number.isFinite(Date.parse(v))) throw new Error("Invalid deploy date");
    return new Date(v).toISOString();
  }
  function commit(v: unknown): string | null {
    if (v === null) return null;
    if (typeof v !== "string" || !/^[a-f0-9]{40}$/.test(v)) throw new Error("Invalid deploy revision");
    return v;
  }
  const raw = record(value), checkedAt = date(raw.checkedAt);
  if (raw.version !== 1 || raw.site !== deploySite || !checkedAt || typeof raw.phase !== "string" || !Object.hasOwn(deployPhases, raw.phase) ||
      !["idle", "running", "succeeded", "failed"].includes(String(raw.outcome))) throw new Error("Invalid deploy state");
  if (raw.requestId !== null && (typeof raw.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw.requestId))) throw new Error("Invalid deploy request");
  if (raw.error !== null && !["backup_failed", "script_failed", "preflight_failed", "start_failed", "interrupted"].includes(String(raw.error))) throw new Error("Invalid deploy error");
  let lastSuccess: DeployStatus["lastSuccess"] = null;
  if (raw.lastSuccess !== null) {
    const last = record(raw.lastSuccess), at = date(last.at), revision = commit(last.commit);
    if (!at || !revision) throw new Error("Invalid successful deploy");
    lastSuccess = { at, commit: revision };
  }
  return { version: 1, site: deploySite, ready: flag(raw.ready), checkedAt, running: flag(raw.running),
    outcome: raw.outcome as DeployStatus["outcome"], requestId: raw.requestId as string | null, phase: raw.phase as DeployPhase,
    startedAt: date(raw.startedAt), finishedAt: date(raw.finishedAt), currentCommit: commit(raw.currentCommit), lastSuccess,
    error: raw.error as DeployStatus["error"] };
}
