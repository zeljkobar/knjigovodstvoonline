"use server";

import { requireRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { readDeployControl, startDeployControl } from "@/lib/deploy-control";
import { deploySite, type DeploySnapshot, type DeployStartStatus } from "@/lib/deploy-status";

export async function getDeployStatus(): Promise<DeploySnapshot> {
  await requireRole("admin");
  try { return { available: true, status: await readDeployControl() }; }
  catch (error) {
    return { available: false, message: error instanceof Error && error.message === "DEPLOY_SERVER_ONLY"
      ? "Deploy se može pokrenuti samo iz aplikacije na produkcijskom serveru. Lokalni program nema pristup serveru."
      : "Status deploya trenutno nije dostupan. Posao koji je već pokrenut nastavlja rad na serveru." };
  }
}
export type DeployActionState = { message: string; error?: boolean; status?: DeployStartStatus; requestId?: string };
export async function startDeploy(_previous: DeployActionState, data: FormData): Promise<DeployActionState> {
  const admin = await requireRole("admin");
  const requestId = String(data.get("request_id") || "");
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId)) return { error: true, message: "Osvježite stranicu pa pokušajte ponovo." };
  // Scope is defined on the server, never taken from a command, path or site supplied by the browser.
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.deploy", akcija: "deploy_requested", tipEntiteta: "SiteDeployment", entitetId: requestId,
      novaVrijednost: { site: deploySite, migrations: true }, upisiAktivnost: false });
  } catch { return { error: true, message: "Zahtjev nije mogao biti evidentiran. Deploy nije pokrenut." }; }
  let status: DeployStartStatus;
  try { status = await startDeployControl({ site: deploySite, requestId, actorId: admin.id }); }
  catch { return { error: true, requestId, message: "Nije dobijena potvrda pokretanja. Osvježite status prije ponovnog pokušaja." }; }
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.deploy", akcija: `deploy_${status}`, tipEntiteta: "SiteDeployment", entitetId: requestId,
      novaVrijednost: { site: deploySite, status }, upisiAktivnost: false });
  } catch { console.error("Deploy outcome audit unavailable", { requestId }); }
  const messages: Record<DeployStartStatus, string> = {
    accepted: "Zahtjev za deploy sa migracijama je prihvaćen. Posao nastavlja rad na serveru i kada se aplikacija restartuje.",
    already_running: "Deploy je već u toku. Novi posao nije pokrenut.",
    already_requested: "Ovaj zahtjev je već obrađen. Provjerite posljednji status.",
    cooldown: "Sačekajte dva minuta između ručnih pokretanja.",
    setup_required: "Serverska deploy skripta još nije pripremljena. Potrebno je prvo preuzeti i objaviti ovu verziju aplikacije."
  };
  return { message: messages[status], status, requestId, error: status === "setup_required" };
}
