"use server";

import { requireRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { readDeployControl, startDeployControl } from "@/lib/deploy-control";
import { isDeploySite, deploySites, type DeploySite, type DeploySnapshot, type DeployStartStatus } from "@/lib/deploy-status";

export async function getDeployStatus(): Promise<DeploySnapshot> {
  await requireRole("admin");
  try { return { available: true, catalog: await readDeployControl() }; }
  catch (error) {
    return { available: false, message: error instanceof Error && error.message === "DEPLOY_SERVER_ONLY"
      ? "Deploy se može pokrenuti samo iz aplikacije na produkcijskom serveru. Lokalni program nema pristup serveru."
      : "Status deploya trenutno nije dostupan. Posao koji je već pokrenut nastavlja rad na serveru." };
  }
}
export type DeployActionState = { message: string; error?: boolean; status?: DeployStartStatus; requestId?: string; site?: DeploySite };
export async function startDeploy(_previous: DeployActionState, data: FormData): Promise<DeployActionState> {
  const admin = await requireRole("admin");
  const requestId = String(data.get("request_id") || "");
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId)) return { error: true, message: "Osvježite stranicu pa pokušajte ponovo." };
  const site = data.get("site");
  if (!isDeploySite(site)) return { error: true, message: "Izaberite jedan od podržanih sajtova." };
  const name = deploySites.find(target => target.id === site)!.name;
  // Only an allowlisted site ID is accepted. Commands and paths stay in the root helper.
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.deploy", akcija: "deploy_requested", tipEntiteta: "SiteDeployment", entitetId: requestId,
      novaVrijednost: { site }, upisiAktivnost: false });
  } catch { return { error: true, message: "Zahtjev nije mogao biti evidentiran. Deploy nije pokrenut." }; }
  let status: DeployStartStatus;
  try { status = await startDeployControl({ site, requestId, actorId: admin.id }); }
  catch { return { error: true, requestId, site, message: "Nije dobijena potvrda pokretanja. Osvježite status prije ponovnog pokušaja." }; }
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.deploy", akcija: `deploy_${status}`, tipEntiteta: "SiteDeployment", entitetId: requestId,
      novaVrijednost: { site, status }, upisiAktivnost: false });
  } catch { console.error("Deploy outcome audit unavailable", { requestId }); }
  const messages: Record<DeployStartStatus, string> = {
    accepted: `Zahtjev za deploy sajta ${name} je prihvaćen. Posao nastavlja rad na serveru i kada se aplikacija restartuje.`,
    already_running: "Deploy jednog od sajtova je već u toku. Sačekajte njegov završetak.",
    already_requested: "Ovaj zahtjev je već obrađen. Provjerite posljednji status.",
    cooldown: "Sačekajte dva minuta između ručnih pokretanja.",
    setup_required: "Ovaj sajt trenutno nije spreman za deploy. Osvježite status da vidite razlog."
  };
  return { message: messages[status], status, requestId, site, error: status === "setup_required" };
}
