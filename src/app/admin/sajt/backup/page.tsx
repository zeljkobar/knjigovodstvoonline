import { randomUUID } from "node:crypto";
import { getBackupStatus } from "./actions";
import { BackupDashboard } from "./BackupDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BackupPage() {
  const snapshot = await getBackupStatus();
  return <BackupDashboard initial={snapshot} requestId={randomUUID()} />;
}
