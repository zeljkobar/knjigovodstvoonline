"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { readBackupControl, startBackupControl } from "@/lib/backup-control";
import { backupDatabases, type BackupSnapshot, type BackupStartStatus } from "@/lib/backup-status";

export async function getBackupStatus(): Promise<BackupSnapshot> {
  await requireRole("admin");
  try { return { available: true, status: await readBackupControl() }; }
  catch (error) {
    return { available: false, message: error instanceof Error && error.message === "BACKUP_SERVER_ONLY"
      ? "Backup je dostupan na produkcijskom serveru nakon deploya. Lokalni program nije povezan sa serverskim kopijama."
      : "Backup servis trenutno nije dostupan. Status kopija nije mogao biti provjeren." };
  }
}

export type StartBackupState = { message: string; error?: boolean; status?: BackupStartStatus };

export async function startBackup(_previous: StartBackupState, formData: FormData): Promise<StartBackupState> {
  const admin = await requireRole("admin");
  const requestId = String(formData.get("request_id") || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)) return { error: true, message: "Osvježite stranicu pa pokušajte ponovo." };
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.backup", akcija: "backup_requested", tipEntiteta: "ServerBackup", entitetId: requestId, novaVrijednost: { databases: backupDatabases.map(item => item.id) }, upisiAktivnost: false });
  } catch {
    return { error: true, message: "Zahtjev nije mogao biti evidentiran. Backup nije pokrenut." };
  }
  let status: BackupStartStatus;
  try { status = await startBackupControl({ requestId, actorId: admin.id }); }
  catch {
    return { error: true, message: "Nije dobijena potvrda pokretanja. Osvježite status prije ponovnog pokušaja." };
  }
  try {
    await auditLog({ korisnikId: admin.id, modul: "admin.backup", akcija: `backup_${status}`, tipEntiteta: "ServerBackup", entitetId: requestId, novaVrijednost: { status }, upisiAktivnost: false });
  } catch {
    // Intent was committed before starting; the bridge also retains its durable outcome.
    console.error("Backup outcome audit unavailable", { requestId });
  }
  revalidatePath("/admin/backup");
  const messages: Record<BackupStartStatus, string> = {
    accepted: "Backup sve četiri baze je pokrenut. Napredak se automatski osvježava.",
    already_running: "Backup je već u toku. Novi posao nije pokrenut.",
    already_requested: "Ovaj zahtjev je već obrađen. Provjerite trenutni status.",
    cooldown: "Sačekajte dva minuta između ručnih pokretanja. Noćni raspored ostaje aktivan."
  };
  return { status, message: messages[status] };
}
