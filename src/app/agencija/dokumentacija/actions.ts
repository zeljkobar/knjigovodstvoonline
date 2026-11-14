"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditDocument, dokumentaContext, syncIncoming, uuidPattern } from "@/lib/dokumentacija";
import { driveItemPath, graph, oneDriveAccess, type DriveItem } from "@/lib/dokumentacija-onedrive";
import { findPostedDocuments, reconcileDocument } from "@/lib/dokumentacija-arhiva";
import { auditLogInTransaction } from "@/lib/audit";
import { redirect } from "next/navigation";

export async function saveDocumentFolder(form: FormData) {
  const { user, scope } = await dokumentaContext("update");
  if (user.rola !== "admin_agencije") return;
  const folderId = String(form.get("folderId") ?? "");
  let status = "folder";
  try {
    const { token, driveId } = await oneDriveAccess(scope.agencija_id);
    const item = await graph<DriveItem>(token, driveItemPath(driveId, folderId));
    if (!item.folder) throw new Error();
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM firme WHERE id = ${scope.firma_id}::uuid FOR UPDATE`;
      const current = await tx.dokumentaFolder.findUnique({ where: { firma_id: scope.firma_id } });
      if (current && (current.folder_id !== item.id || current.drive_id !== driveId) &&
          await tx.primljeniDokument.count({ where: { firma_id: scope.firma_id } })) throw new Error();
      await tx.dokumentaFolder.upsert({ where: { firma_id: scope.firma_id },
        create: { firma_id: scope.firma_id, agencija_id: scope.agencija_id, drive_id: driveId, folder_id: item.id },
        update: { agencija_id: scope.agencija_id, drive_id: driveId, folder_id: item.id } });
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id,
        modul: "dokumentacija", akcija: "povezi_folder", tipEntiteta: "DokumentaFolder", entitetId: scope.firma_id,
        novaVrijednost: { folder_id: item.id, drive_id: driveId } });
    });
  } catch {
    status = "greska_folder";
  }
  redirect(`/agencija/dokumentacija?onedrive=${status}`);
}

export async function refreshIncoming() {
  const { user, scope, year } = await dokumentaContext("update");
  if (user.rola === "klijent") return;
  let status = "osvjezeno";
  try { await syncIncoming(scope, year.godina, user.id); } catch { status = "greska"; }
  redirect(`/agencija/dokumentacija?onedrive=${status}`);
}

export async function requestSupplement(form: FormData) {
  const { user, scope } = await dokumentaContext("update");
  const id = String(form.get("id") ?? "");
  const comment = String(form.get("comment") ?? "").trim().slice(0, 1000);
  if (user.rola === "klijent" || !comment || !uuidPattern.test(id)) return;
  await prisma.$transaction(async tx => {
    const result = await tx.primljeniDokument.updateMany({
      where: { ...scope, id, status: { in: ["PRIMLJENO", "DOPUNA"] }, poslao_id: { not: null }, kuf_entry_id: null, dopuna_za_id: null },
      data: { status: "DOPUNA", zahtjev_dopune: comment }
    });
    if (result.count) await auditDocument(tx, { ...scope, id }, "zatrazi_dopunu", user.id, { comment });
  });
  revalidatePath("/agencija/dokumentacija");
}

export async function retryArchive(form: FormData) {
  const { user, scope } = await dokumentaContext("update");
  const id = String(form.get("id") ?? "");
  if (user.rola === "klijent" || !uuidPattern.test(id)) return;
  if (await prisma.primljeniDokument.count({ where: { ...scope, id } })) await reconcileDocument(id);
  revalidatePath("/agencija/dokumentacija");
}

export async function archivePostedDocuments(form: FormData) {
  const { user, scope } = await dokumentaContext("update");
  if (user.rola === "klijent" || form.get("firma") !== scope.firma_id ||
      form.get("godina") !== scope.poslovna_godina_id) return;
  const pending = await findPostedDocuments(scope);
  let archived = 0;
  for (const { id } of pending) {
    try {
      if (await reconcileDocument(id, true)) archived += 1;
    } catch (error) {
      console.warn("OneDrive dokumentacija: grupno premještanje nije uspjelo", id,
        error instanceof Error ? error.name : "Nepoznata greška");
    }
  }
  const remaining = (await findPostedDocuments(scope)).length;
  revalidatePath("/agencija/dokumentacija");
  redirect(`/agencija/dokumentacija?arhivirano=${archived}&preostalo=${remaining}`);
}
