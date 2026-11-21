import "server-only";
import { prisma } from "./prisma";
import { auditDocument, documentDrive, DokumentaError, type DokumentaScope } from "./dokumentacija";
import { driveItemPath, graph, graphResponse, GraphError, type DriveItem } from "./dokumentacija-onedrive";
import type { Prisma } from "@prisma/client";

async function lockScope(tx: Prisma.TransactionClient, scope: DokumentaScope) {
  const company = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM firme
    WHERE id = ${scope.firma_id}::uuid AND agencija_id = ${scope.agencija_id}::uuid
      AND aktivan AND NOT is_deleted FOR UPDATE`;
  const [year] = await tx.$queryRaw<{ zakljucena: boolean; godina: number }[]>`SELECT zakljucena, godina FROM poslovne_godine
    WHERE id = ${scope.poslovna_godina_id}::uuid AND firma_id = ${scope.firma_id}::uuid FOR UPDATE`;
  if (!company.length || !year || year.zakljucena) throw new DokumentaError("Godina je zaključana ili firma nije dostupna.");
  return year;
}

export async function deleteIncomingCloudDocument(scope: DokumentaScope, id: string, userId: string) {
  // Durable intent precedes the remote operation. A timeout/DB failure leaves an explicit retry,
  // never a document eligible for accounting while its original may already be in the recycle bin.
  await prisma.$transaction(async tx => {
    await lockScope(tx, scope);
    const doc = await tx.primljeniDokument.findFirst({ where: { ...scope, id,
      status: { in: ["PRIMLJENO", "BRISANJE"] }, kuf_entry_id: null, dopuna_za_id: null, greska_arhive: null } });
    if (!doc?.item_id || await tx.primljeniDokument.count({ where: {
      agencija_id: scope.agencija_id, firma_id: scope.firma_id, dopuna_za_id: id } })) {
      throw new DokumentaError("Dokument nije dostupan za brisanje.");
    }
    if (doc.status === "BRISANJE") return;
    await tx.primljeniDokument.update({ where: { id }, data: { status: "BRISANJE" } });
    await auditDocument(tx, doc, "onedrive_brisanje_zatrazeno", userId, { prethodni_status: doc.status, item_id: doc.item_id });
  });
  await prisma.$transaction(async tx => {
    const year = await lockScope(tx, scope);
    const doc = await tx.primljeniDokument.findFirst({ where: { ...scope, id, status: "BRISANJE",
      kuf_entry_id: null, dopuna_za_id: null, greska_arhive: null } });
    if (!doc?.item_id) throw new DokumentaError("Dokument nije dostupan za brisanje.");
    const { token, driveId, folder } = await documentDrive(scope);
    if (driveId !== doc.drive_id) throw new DokumentaError("OneDrive veza je promijenjena.");
    const incoming = await graph<DriveItem>(token, `${driveItemPath(driveId, folder.folder_id)}:/${year.godina}/primljeno`);
    if (!incoming.folder) throw new DokumentaError("Folder Primljeno nije dostupan.");
    let absent = false;
    let item: DriveItem | undefined;
    try { item = await graph<DriveItem>(token, driveItemPath(driveId, doc.item_id)); }
    catch (error) { if (error instanceof GraphError && error.status === 404) absent = true; else throw error; }
    if (!absent) {
      if (!item?.file || item.folder || item.id !== doc.item_id || !item.eTag ||
          item.parentReference?.driveId !== driveId || item.parentReference?.id !== incoming.id ||
          (doc.parent_id && doc.parent_id !== incoming.id)) {
        throw new DokumentaError("Fajl nije u očekivanom folderu Primljeno. Brisanje je zaustavljeno.");
      }
      await graphResponse(token, driveItemPath(driveId, doc.item_id), {
        method: "DELETE", headers: { "If-Match": item.eTag }
      });
    }
    await tx.primljeniDokument.update({ where: { id }, data: { status: "UKLONJENO" } });
    await auditDocument(tx, doc, "onedrive_brisanje_zavrseno", userId,
      { status: "UKLONJENO", item_id: doc.item_id, ishod: absent ? "VEC_NEDOSTAJE" : "ONEDRIVE_KORPA" });
  }, { timeout: 60000 });
}
