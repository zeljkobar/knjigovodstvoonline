import "server-only";
import { execFile } from "node:child_process";
import { parseBackupStatus, type BackupStartStatus } from "./backup-status";

function invocation(operation: "status" | "start") {
  // The web app can only invoke the helper installed on its own server.
  // There is deliberately no SSH transport or remote database connection.
  if (process.env.NODE_ENV !== "production" || process.platform !== "linux") throw new Error("BACKUP_SERVER_ONLY");
  return { file: "/usr/bin/sudo", args: ["-n", "/usr/local/sbin/summa-backup-control", operation] };
}

async function call(operation: "status" | "start", request?: { requestId: string; actorId: string }): Promise<unknown> {
  const { file, args } = invocation(operation);
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 20_000, maxBuffer: 256 * 1024, encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) return reject(new Error("BACKUP_UNAVAILABLE"));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("BACKUP_INVALID_RESPONSE")); }
    });
    child.stdin?.on("error", () => { /* execFile callback reports the actual transport failure. */ });
    child.stdin?.end(request ? JSON.stringify(request) : "");
  });
}

export async function readBackupControl() {
  return parseBackupStatus(await call("status"));
}
export async function startBackupControl(request: { requestId: string; actorId: string }): Promise<BackupStartStatus> {
  const result = await call("start", request) as { status?: unknown } | null;
  if (!result || !["accepted", "already_running", "already_requested", "cooldown"].includes(String(result.status))) throw new Error("BACKUP_INVALID_RESPONSE");
  return result.status as BackupStartStatus;
}
