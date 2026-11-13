import "server-only";
import { execFile } from "node:child_process";
import { parseDeployStatus, type DeployStartStatus } from "./deploy-status";

async function call(operation: "status" | "start", request?: { site: string; requestId: string; actorId: string }): Promise<unknown> {
  if (process.env.NODE_ENV !== "production" || process.platform !== "linux") throw new Error("DEPLOY_SERVER_ONLY");
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/sudo", ["-n", "/usr/local/sbin/summa-deploy-control", operation],
      { timeout: 25_000, maxBuffer: 256 * 1024, encoding: "utf8", windowsHide: true }, (error, stdout) => {
        if (error) return reject(new Error("DEPLOY_UNAVAILABLE"));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("DEPLOY_INVALID_RESPONSE")); }
      });
    child.stdin?.on("error", () => { /* The callback reports transport errors without exposing stderr. */ });
    child.stdin?.end(request ? JSON.stringify(request) : "");
  });
}
export async function readDeployControl() { return parseDeployStatus(await call("status")); }
export async function startDeployControl(request: { site: string; requestId: string; actorId: string }): Promise<DeployStartStatus> {
  const value = await call("start", request) as { status?: unknown } | null;
  if (!value || !["accepted", "already_running", "already_requested", "cooldown", "setup_required"].includes(String(value.status))) throw new Error("DEPLOY_INVALID_RESPONSE");
  return value.status as DeployStartStatus;
}
