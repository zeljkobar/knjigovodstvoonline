import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PrimljeniDokument } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentUser, isDirectFiscalTenantUser } from "./auth";
import { hasPermission } from "./permissions";
import { readWorkContext } from "./work-context";
import { auditLogInTransaction } from "./audit";
import { driveChildren, driveItemPath, ensureDriveFolder, graph, GraphError, oneDriveAccess, type DriveItem } from "./dokumentacija-onedrive";

export const dokumentaKategorije = [
  ["ULAZNI", "Ulazni računi"], ["IZLAZNI", "Izlazni računi"], ["IZVODI", "Izvodi"], ["OSTALO", "Ostalo"]
] as const;

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supportedFile = /\.(pdf|tiff?|jpe?g|png|xml|html?)$/i;
const maxSize = 20 * 1024 * 1024;

export type DokumentaScope = { agencija_id: string; firma_id: string; poslovna_godina_id: string };
export class DokumentaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function dokumentaContext(akcija: "view" | "create" | "update", requestedYear?: string, requestedCompany?: string) {
  const [user, work] = await Promise.all([getCurrentUser(), readWorkContext()]);
  if (!user?.agencija_id || isDirectFiscalTenantUser(user) ||
      !["klijent", "admin_agencije", "korisnik_agencije"].includes(user.rola)) {
    throw new DokumentaError("Pristup nije dozvoljen.", 403);
  }
  const client = user.rola === "klijent";
  const assigned = client ? await prisma.firma.findMany({ where: { agencija_id: user.agencija_id, aktivan: true,
      is_deleted: false, korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }, take: 2 }) : [];
  const companyId = requestedCompany ?? work.firmaId;
  const firma = client
    ? assigned.length === 1 ? assigned[0] : null
    : companyId ? await prisma.firma.findFirst({ where: { id: companyId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false } }) : null;
  if (!firma || !await hasPermission(user, { firmaId: firma.id, modul: "dokumentacija", akcija })) {
    throw new DokumentaError("Izaberite firmu za koju imate pravo pristupa dokumentaciji.", 403);
  }
  const years = await prisma.poslovnaGodina.findMany({ where: { firma_id: firma.id }, orderBy: { godina: "desc" } });
  const selected = requestedYear ?? work.poslovnaGodinaId;
  const year = years.find(item => item.id === selected) ??
    (client && !requestedYear ? years.find(item => item.godina === new Date().getFullYear()) ?? years[0] : null);
  if (!year) throw new DokumentaError("Izaberite poslovnu godinu.");
  return { user, firma, years, year, client, scope: {
    agencija_id: user.agencija_id, firma_id: firma.id, poslovna_godina_id: year.id
  } };
}

export function readFiscalLink(input: unknown) {
  if (!input) return null;
  try {
    if (typeof input !== "string" || input.length > 2200) throw new Error();
    const url = new URL(input.trim());
    const params = new URLSearchParams(url.search.slice(1) || url.hash.split("?")[1]);
    if (url.origin !== "https://mapr.tax.gov.me" || url.username || url.password ||
      !["iic", "tin", "prc", "crtd"].every(key => params.get(key))) throw new Error();
    return url.href;
  } catch {
    throw new DokumentaError("Unesite važeći MAPR fiskalni link.");
  }
}

export async function configuredFolder(scope: Pick<DokumentaScope, "agencija_id" | "firma_id">) {
  const folder = await prisma.dokumentaFolder.findFirst({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id } });
  if (!folder) throw new DokumentaError("Firma još nema povezan OneDrive folder.");
  return folder;
}

export async function documentDrive(scope: Pick<DokumentaScope, "agencija_id" | "firma_id">) {
  const folder = await configuredFolder(scope);
  const { token, driveId } = await oneDriveAccess(scope.agencija_id);
  if (folder.drive_id !== driveId) throw new DokumentaError("OneDrive veza firme se promijenila.");
  return { folder, token, driveId };
}

export function auditDocument(tx: Prisma.TransactionClient, doc: { id: string; agencija_id: string; firma_id: string },
  action: string, userId?: string, data?: unknown) {
  return auditLogInTransaction(tx, { korisnikId: userId, agencijaId: doc.agencija_id, firmaId: doc.firma_id,
    modul: "dokumentacija", akcija: action, tipEntiteta: "PrimljeniDokument", entitetId: doc.id, novaVrijednost: data });
}

type UploadInput = {
  naziv?: string; velicina?: number; kategorija?: string; qrLink?: string;
  qrStatus?: string; napomena?: string; dopunaZa?: string;
};

export async function prepareDocument(context: Awaited<ReturnType<typeof dokumentaContext>>, input: UploadInput) {
  const { scope, user, year } = context;
  if (!context.client) throw new DokumentaError("Ova radnja je dostupna u klijentskom portalu.", 403);
  const qr = readFiscalLink(input.qrLink);
  const name = typeof input.naziv === "string" ? input.naziv.trim().slice(0, 180) : "";
  const size = input.velicina;
  const category = dokumentaKategorije.find(([id]) => id === input.kategorija)?.[0];
  if (!category || (!name && !qr) || (name && (!supportedFile.test(name) ||
      !Number.isInteger(size) || size! < 1 || size! > maxSize))) {
    throw new DokumentaError("Odaberite podržan fajl do 20 MB ili unesite fiskalni link.");
  }
  const parentDoc = input.dopunaZa && uuidPattern.test(input.dopunaZa)
    ? await prisma.primljeniDokument.findFirst({ where: { ...scope, id: input.dopunaZa, poslao_id: user.id, status: "DOPUNA" } }) : null;
  if (input.dopunaZa && !parentDoc) throw new DokumentaError("Zahtjev za dopunu nije dostupan.");
  const id = randomUUID();
  const folder = await configuredFolder(scope);
  const base = { ...scope, id, poslao_id: user.id, drive_id: folder.drive_id,
    naziv: name || "Fiskalni link", kategorija: parentDoc?.kategorija ?? category,
    qr_link: qr, qr_status: qr ? "PROCITAN" : ["NEMA", "NECITLJIV"].includes(input.qrStatus ?? "") ? input.qrStatus : null,
    dopuna_za_id: parentDoc?.id, napomena: typeof input.napomena === "string" ? input.napomena.trim().slice(0, 1000) : null,
    izvor: "PORTAL" };
  if (!name) {
    await prisma.$transaction(async tx => {
      const doc = await tx.primljeniDokument.create({ data: { ...base, status: "PRIMLJENO" } });
      await auditDocument(tx, doc, "prijem_qr", user.id, { dopuna_za_id: doc.dopuna_za_id });
      await closeSupplement(tx, doc);
    });
    return { id };
  }
  const { token, driveId, folder: currentFolder } = await documentDrive(scope);
  if (folder.drive_id !== driveId || folder.folder_id !== currentFolder.folder_id) throw new DokumentaError("Odredište dokumenta je promijenjeno.");
  const parent = await ensureDriveFolder(token, driveId, folder.folder_id, [String(year.godina), "primljeno"]);
  const safe = name.replace(/[\\/:*?"<>|#%\x00-\x1F]/g, "_").replace(/^\.+/, "");
  const cloudName = `${id}-${safe}`;
  const session = await graph<{ uploadUrl: string }>(token,
    `${driveItemPath(driveId, parent)}:/${encodeURIComponent(cloudName)}:/createUploadSession`, {
      method: "POST", body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } })
    });
  if (new URL(session.uploadUrl).protocol !== "https:") throw new DokumentaError("Neispravna OneDrive sesija.");
  await prisma.primljeniDokument.create({ data: { ...base, naziv_u_oblaku: cloudName,
    parent_id: parent, velicina: size, status: "UPLOAD" } });
  return { id, uploadUrl: session.uploadUrl };
}

async function closeSupplement(tx: Prisma.TransactionClient, doc: PrimljeniDokument) {
  if (doc.dopuna_za_id) {
    await tx.primljeniDokument.updateMany({
      where: { id: doc.dopuna_za_id, status: "DOPUNA", firma_id: doc.firma_id, poslao_id: doc.poslao_id },
      data: { status: "PRIMLJENO", zahtjev_dopune: null }
    });
  }
}

async function registerUpload(doc: PrimljeniDokument, item: DriveItem) {
  if (!item.file || item.parentReference?.id !== doc.parent_id || item.name !== doc.naziv_u_oblaku ||
      item.parentReference?.driveId !== doc.drive_id || doc.velicina !== item.size) {
    throw new DokumentaError("OneDrive još nije potvrdio očekivani fajl.");
  }
  await prisma.$transaction(async tx => {
    const result = await tx.primljeniDokument.updateMany({ where: { id: doc.id, status: "UPLOAD" },
      data: { item_id: item.id, status: "PRIMLJENO" } });
    if (result.count) {
      await auditDocument(tx, doc, "prijem", doc.poslao_id ?? undefined, { item_id: item.id, dopuna_za_id: doc.dopuna_za_id });
      await closeSupplement(tx, doc);
    }
  });
}

export async function completeDocument(context: Awaited<ReturnType<typeof dokumentaContext>>, id: string) {
  if (!context.client || typeof id !== "string" || !uuidPattern.test(id)) throw new DokumentaError("Dokument nije dostupan.", 404);
  const doc = await prisma.primljeniDokument.findFirst({ where: { ...context.scope, id, poslao_id: context.user.id } });
  if (!doc) throw new DokumentaError("Dokument nije dostupan.", 404);
  if (doc.status !== "UPLOAD") return;
  const { token, driveId } = await documentDrive(context.scope);
  if (doc.drive_id !== driveId || !doc.parent_id || !doc.naziv_u_oblaku) throw new DokumentaError("Odredište dokumenta je promijenjeno.");
  const item = await graph<DriveItem>(token, `${driveItemPath(driveId, doc.parent_id)}:/${encodeURIComponent(doc.naziv_u_oblaku)}`);
  await registerUpload(doc, item);
}

export async function syncIncoming(scope: DokumentaScope, year: number, userId?: string) {
  const { token, driveId, folder } = await documentDrive(scope);
  let parent: string;
  try {
    const existing = await graph<DriveItem>(token, `${driveItemPath(driveId, folder.folder_id)}:/${year}/primljeno`);
    if (!existing.folder) throw new DokumentaError("Primljeno nije OneDrive folder.");
    parent = existing.id;
  } catch (error) {
    if (error instanceof GraphError && error.status === 404) return 0;
    throw error;
  }
  const items = await driveChildren(token, driveId, parent);
  let added = 0;
  for (const item of items) {
    if (!item.file || item.parentReference?.id !== parent || item.parentReference?.driveId !== driveId ||
        !supportedFile.test(item.name) || !item.size || item.size > 2147483647) continue;
    const existing = await prisma.primljeniDokument.findFirst({ where: { drive_id: driveId,
      OR: [{ item_id: item.id }, { naziv_u_oblaku: item.name, status: "UPLOAD", parent_id: parent }] } });
    if (existing) {
      if (existing.status === "UPLOAD" && existing.firma_id === scope.firma_id &&
          existing.agencija_id === scope.agencija_id && existing.poslovna_godina_id === scope.poslovna_godina_id &&
          existing.velicina === item.size) await registerUpload(existing, item);
      continue;
    }
    const id = randomUUID();
    added += await prisma.$transaction(async tx => {
      const result = await tx.primljeniDokument.createMany({ skipDuplicates: true, data: {
        ...scope, id, drive_id: driveId, item_id: item.id, parent_id: parent, naziv: item.name,
        velicina: item.size, kategorija: "OSTALO", izvor: "ONEDRIVE", status: "PRIMLJENO"
      } });
      if (result.count) await auditDocument(tx, { ...scope, id }, "onedrive_prijem", userId, { item_id: item.id });
      return result.count;
    });
  }
  return added;
}

export async function streamDocument(doc: PrimljeniDokument) {
  if (!doc.item_id) return null;
  const { token, driveId } = await documentDrive(doc);
  if (driveId !== doc.drive_id) throw new DokumentaError("OneDrive veza dokumenta nije dostupna.");
  const base = driveItemPath(driveId, doc.item_id);
  const item = await graph<DriveItem & { "@microsoft.graph.downloadUrl"?: string }>(token, base);
  const download = item["@microsoft.graph.downloadUrl"];
  if (!download || new URL(download).protocol !== "https:") throw new GraphError(404);
  return fetch(download, { cache: "no-store", signal: AbortSignal.timeout(90000) });
}

export async function linkKufDocument(tx: Prisma.TransactionClient, scope: DokumentaScope, documentId: string, entryId: string, userId: string) {
  if (!uuidPattern.test(documentId) || !uuidPattern.test(entryId)) throw new DokumentaError("Dokument nije dostupan.");
  const entry = await tx.kufEntry.findFirst({ where: { ...scope, id: entryId, is_deleted: false,
    kuf_book: { ...scope, is_deleted: false } } });
  if (!entry) throw new DokumentaError("KUF račun nije dostupan u aktivnoj firmi i godini.");
  const source = await tx.primljeniDokument.findFirst({ where: { ...scope, id: documentId },
    select: { id: true, dopuna_za_id: true, status: true, kuf_entry_id: true } });
  if (!source || (source.kuf_entry_id && source.kuf_entry_id !== entryId) || source.status === "DOPUNA" || source.status === "UPLOAD") {
    throw new DokumentaError("Dokument je već povezan ili čeka dopunu.");
  }
  const originalId = source.dopuna_za_id ?? source.id;
  const family = await tx.primljeniDokument.findMany({ where: { ...scope, status: { not: "UPLOAD" },
    OR: [{ id: originalId }, { dopuna_za_id: originalId }] }, select: { id: true, kuf_entry_id: true, status: true } });
  for (const doc of family.sort((left, right) => left.id.localeCompare(right.id))) {
    if (doc.kuf_entry_id === entryId) continue;
    const updated = await tx.primljeniDokument.updateMany({
      where: { ...scope, id: doc.id, status: "PRIMLJENO", kuf_entry_id: null },
      data: { kuf_entry_id: entryId }
    });
    if (!updated.count) throw new DokumentaError("Dokument je već povezan ili čeka dopunu.");
    await auditDocument(tx, { ...scope, id: doc.id }, "povezi_kuf", userId, { kuf_entry_id: entryId });
  }
}

export async function lockDocumentKufTarget(tx: Prisma.TransactionClient, scope: DokumentaScope, bookId: string, dates: Date[]) {
  const company = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM firme
    WHERE id = ${scope.firma_id}::uuid AND agencija_id = ${scope.agencija_id}::uuid AND aktivan AND NOT is_deleted FOR UPDATE`;
  const [year] = await tx.$queryRaw<{ zakljucena: boolean }[]>`SELECT zakljucena FROM poslovne_godine
    WHERE id = ${scope.poslovna_godina_id}::uuid AND firma_id = ${scope.firma_id}::uuid FOR UPDATE`;
  const book = await tx.kufBook.findFirst({ where: { ...scope, id: bookId, is_deleted: false, status: "OPEN" } });
  if (!company.length || !year || year.zakljucena || !book) throw new DokumentaError("KUF knjiga nije otvorena za unos.");
  const periods = await tx.$queryRaw<Array<{ status: string; datum_od: Date; datum_do: Date }>>`
    SELECT status, datum_od, datum_do FROM pdv_periodi WHERE firma_id = ${scope.firma_id}::uuid
    AND agencija_id = ${scope.agencija_id}::uuid FOR UPDATE
  `;
  if (periods.some(period => period.status === "LOCKED" &&
    [book.kuf_date, ...dates].some(date => date >= period.datum_od && date <= period.datum_do))) {
    throw new DokumentaError("PDV period je zaključan.");
  }
}
