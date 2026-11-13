export const deploySite = "knjigovodstvoonline" as const;
export const deploySites = [
  { id: deploySite, name: "Knjigovodstvo online", description: "Deploy aplikacije sa migracijama baze." },
  { id: "rahmetli", name: "Rahmetli.me", description: "Preuzimanje izmjena, priprema sajta i restart aplikacije." },
  { id: "dokumenta", name: "Dokumenta", description: "Preuzimanje izmjena i restart portala dokumenta.summasummarum.me." },
  { id: "royalservices", name: "Royal Services", description: "Preuzimanje izmjena i restart sajta royalservices.me." },
  { id: "spedicija", name: "Špedicija", description: "Deploy sa migracijama baze. Zasebno pokretanje migracija nije potrebno." },
  { id: "fiscal-api", name: "Fiscal API", description: "Postojeći deploy postupak za API i prateće servise, sa provjerom dostupnosti." },
  { id: "turizam", name: "Turizam", description: "Objava nove verzije sa backup-om, migracijama i provjerom dostupnosti." }
] as const;
export type DeploySite = typeof deploySites[number]["id"];
export function isDeploySite(value: unknown): value is DeploySite {
  return typeof value === "string" && deploySites.some(site => site.id === value);
}
export const deployBlockReasons = {
  script_unprepared: "Serverska skripta za ovaj sajt zahtijeva pripremu ili ponovnu provjeru.",
  uncommitted_changes: "Na serveru postoje lokalne izmjene ovog projekta. Sačuvajte i uskladite ih prije deploya.",
  wrong_branch: "Projekat na serveru nije na očekivanoj grani.",
  access_failed: "Nije moguće provjeriti pristup projektu na serveru.",
  service_unavailable: "Serverski servis za deploy nije dostupan."
} as const;
export const deployPhases = {
  queued: "Zahtjev je prihvaćen", preflight: "Provjera uslova", backup: "Pravljenje i provjera lokalne kopije baze",
  pull: "Preuzimanje nove verzije", dependencies: "Priprema aplikacije", migrations: "Primjena migracija baze",
  generate: "Priprema pristupa bazi", build: "Priprema nove verzije sajta", restart: "Restart aplikacije",
  health: "Provjera dostupnosti sajta", script: "Izvršavanje deploy postupka", done: "Deploy završen"
} as const;
export type DeployPhase = keyof typeof deployPhases;
export type DeployStartStatus = "accepted" | "already_running" | "already_requested" | "cooldown" | "setup_required";
export type DeployBackup = {
  database: string | null; local: "verified" | "not_required"; createdAt: string;
  cloud: "queued" | "uploading" | "verified" | "warning" | "not_required";
  uploadedAt: string | null; retained: boolean;
};
const siteDatabases: Record<DeploySite, string | null> = {
  knjigovodstvoonline: "knjigovodstvoonline", rahmetli: "rahmetli_me", dokumenta: "dokumenta_portal",
  royalservices: null, spedicija: "spedicija", "fiscal-api": "summa_fiscal", turizam: "turizam_prod"
};
export type DeployStatus = {
  version: 1; site: DeploySite; blockReason: keyof typeof deployBlockReasons | null; ready: boolean; checkedAt: string; running: boolean;
  outcome: "idle" | "running" | "succeeded" | "failed"; requestId: string | null; phase: DeployPhase;
  startedAt: string | null; finishedAt: string | null; currentCommit: string | null;
  lastSuccess: { at: string; commit: string } | null;
  backup: DeployBackup | null;
  error: "backup_failed" | "script_failed" | "preflight_failed" | "start_failed" | "interrupted" | null;
};
export type DeployCatalog = { version: 2; checkedAt: string; running: boolean; activeSite: DeploySite | null; sites: DeployStatus[] };
export type DeploySnapshot = { available: true; catalog: DeployCatalog } | { available: false; message: string };
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
  if (raw.version !== 1 || !isDeploySite(raw.site) || !checkedAt || typeof raw.phase !== "string" || !Object.hasOwn(deployPhases, raw.phase) ||
      !["idle", "running", "succeeded", "failed"].includes(String(raw.outcome))) throw new Error("Invalid deploy state");
  if (raw.requestId !== null && (typeof raw.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw.requestId))) throw new Error("Invalid deploy request");
  if (raw.error !== null && !["backup_failed", "script_failed", "preflight_failed", "start_failed", "interrupted"].includes(String(raw.error))) throw new Error("Invalid deploy error");
  if (raw.blockReason !== null && (typeof raw.blockReason !== "string" || !Object.hasOwn(deployBlockReasons, raw.blockReason))) throw new Error("Invalid readiness reason");
  let lastSuccess: DeployStatus["lastSuccess"] = null;
  if (raw.lastSuccess !== null) {
    const last = record(raw.lastSuccess), at = date(last.at), revision = commit(last.commit);
    if (!at || !revision) throw new Error("Invalid successful deploy");
    lastSuccess = { at, commit: revision };
  }
  let backup: DeployBackup | null = null;
  if (raw.backup !== undefined && raw.backup !== null) {
    const item = record(raw.backup), createdAt = date(item.createdAt), uploadedAt = date(item.uploadedAt);
    if (!createdAt || item.database !== siteDatabases[raw.site] || !["verified", "not_required"].includes(String(item.local)) ||
        !["queued", "uploading", "verified", "warning", "not_required"].includes(String(item.cloud))) throw new Error("Invalid deploy backup");
    if ((item.database === null) !== (item.local === "not_required") ||
        (item.database === null) !== (item.cloud === "not_required") ||
        (item.cloud === "verified" && !uploadedAt)) throw new Error("Invalid deploy backup result");
    backup = { database: item.database as string | null, local: item.local as DeployBackup["local"], createdAt,
      cloud: item.cloud as DeployBackup["cloud"], uploadedAt, retained: flag(item.retained) };
  }
  return { version: 1, site: raw.site, blockReason: raw.blockReason as DeployStatus["blockReason"], ready: flag(raw.ready), checkedAt, running: flag(raw.running),
    outcome: raw.outcome as DeployStatus["outcome"], requestId: raw.requestId as string | null, phase: raw.phase as DeployPhase,
    startedAt: date(raw.startedAt), finishedAt: date(raw.finishedAt), currentCommit: commit(raw.currentCommit), lastSuccess, backup,
    error: raw.error as DeployStatus["error"] };
}

export function parseDeployCatalog(value: unknown): DeployCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid deploy catalog");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2 || typeof raw.running !== "boolean" || (raw.activeSite !== null && !isDeploySite(raw.activeSite)) ||
      !Array.isArray(raw.sites) || raw.sites.length !== deploySites.length) throw new Error("Invalid deploy catalog");
  const sites = raw.sites.map(parseDeployStatus);
  if (new Set(sites.map(site => site.site)).size !== deploySites.length || typeof raw.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.checkedAt))) throw new Error("Invalid deploy catalog");
  if ((!raw.running && raw.activeSite !== null) || sites.some(site => site.running && (!raw.running || site.site !== raw.activeSite))) throw new Error("Invalid active deploy");
  return { version: 2, checkedAt: new Date(raw.checkedAt).toISOString(), running: raw.running, activeSite: raw.activeSite as DeploySite | null, sites };
}
