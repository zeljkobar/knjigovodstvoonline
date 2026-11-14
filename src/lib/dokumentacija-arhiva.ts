import "server-only";
import { prisma } from "./prisma";
import { auditDocument, documentDrive, syncIncoming, type DokumentaScope } from "./dokumentacija";
import { driveItemPath, ensureDriveFolder, graph, type DriveItem } from "./dokumentacija-onedrive";

const subfolders: Record<string, string[]> = { VIRMANI: [], KARTICA: ["kartica"], GOTOVINA: ["gotovina"] };

export async function reconcileDocument(id: string, postedOnly = false) {
  // Persist intent before contacting OneDrive. If the process exits after a move
  // and accounting is reopened in the meantime, the next run can move it back.
  await prisma.$executeRaw`
    UPDATE primljeni_dokumenti d
    SET greska_arhive = 'Proknjiženo · čeka premještanje'
    FROM kuf_entries k, nalozi n
    WHERE d.id = ${id}::uuid AND d.status = 'PRIMLJENO' AND d.greska_arhive IS NULL
      AND d.kuf_entry_id = k.id AND k.journal_id = n.id
      AND k.agencija_id = d.agencija_id AND k.firma_id = d.firma_id
      AND k.poslovna_godina_id = d.poslovna_godina_id
      AND k.posting_status = 'POSTED' AND NOT k.is_deleted AND n.status = 'POSTED' AND NOT n.is_deleted
  `;
  return prisma.$transaction(async tx => {
    // Only one cloud operation per source at a time, including concurrent worker requests.
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 0)) AS locked
    `;
    if (!lock?.locked) return;
    const source = await tx.primljeniDokument.findUnique({ where: { id }, select: { firma_id: true, agencija_id: true } });
    if (!source) return;
    const company = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM firme WHERE id = ${source.firma_id}::uuid AND agencija_id = ${source.agencija_id}::uuid
        AND aktivan AND NOT is_deleted FOR UPDATE SKIP LOCKED
    `;
    if (!company.length) return;
    const doc = await tx.primljeniDokument.findUnique({ where: { id },
      include: { firma: { select: { aktivan: true, is_deleted: true, agencija_id: true } }, poslovna_godina: true,
        kuf_entry: { include: { kuf_book: { include: { racun_vrsta: true } } } } } });
    if (!doc || !doc.firma.aktivan || doc.firma.is_deleted || doc.firma.agencija_id !== doc.agencija_id ||
        doc.status === "UPLOAD") return;
    const entry = doc.kuf_entry;
    if (entry && (entry.agencija_id !== doc.agencija_id || entry.firma_id !== doc.firma_id ||
      entry.poslovna_godina_id !== doc.poslovna_godina_id)) return;
    const book = entry?.kuf_book;
    if (entry?.journal_id) {
      const acquired = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM nalozi WHERE id = ${entry.journal_id}::uuid FOR UPDATE SKIP LOCKED
      `;
      if (!acquired.length) return;
    }
    const journal = entry?.journal_id ? await tx.nalog.findFirst({ where: {
      id: entry.journal_id, firma_id: doc.firma_id, agencija_id: doc.agencija_id,
      poslovna_godina_id: doc.poslovna_godina_id, is_deleted: false
    }, select: { status: true } }) : null;
    const posted = Boolean(book && !book.is_deleted && book.firma_id === doc.firma_id &&
      book.agencija_id === doc.agencija_id && book.poslovna_godina_id === doc.poslovna_godina_id && entry && !entry.is_deleted &&
      entry.posting_status === "POSTED" && journal?.status === "POSTED");
    if (postedOnly && !posted) return;
    if (!posted && doc.status !== "ARHIVIRANO" && !doc.greska_arhive && !entry?.is_deleted) return;
    if (posted && doc.status === "ARHIVIRANO" && !doc.greska_arhive) return;
    try {
      if (doc.item_id) {
        const subtype = posted && book ? subfolders[book.racun_vrsta.sifra] : [];
        if (!subtype) throw new Error("Vrsta KUF-a nema podešeno odredište.");
        const { token, driveId, folder } = await documentDrive(doc);
        if (doc.drive_id !== driveId) throw new Error("OneDrive veza dokumenta je promijenjena.");
        const segments = posted && book
          ? [String(doc.poslovna_godina.godina), "ulazni", String(book.mjesec).padStart(2, "0"), ...subtype]
          : [String(doc.poslovna_godina.godina), "primljeno"];
        const parent = await ensureDriveFolder(token, driveId, folder.folder_id, segments);
        const path = driveItemPath(driveId, doc.item_id);
        const item = await graph<DriveItem>(token, path);
        if (item.parentReference?.id !== parent) {
          await graph(token, path, { method: "PATCH", body: JSON.stringify({
            parentReference: { id: parent },
            // A manually scanned filename may already exist in the target folder.
            ...(doc.naziv_u_oblaku || item.name.startsWith(`${doc.id}-`) ? {} : { name: `${doc.id}-${doc.naziv.slice(0, 150)}` })
          }) });
        }
      }
    } catch (error) {
      console.warn("OneDrive dokumentacija: premještanje nije uspjelo", {
        documentId: id, reason: error instanceof Error ? error.message : "Nepoznata greška"
      });
      await tx.primljeniDokument.update({ where: { id }, data: {
        greska_arhive: posted ? "Proknjiženo · čeka premještanje" : "Čeka povratak u Primljeno"
      } });
      return;
    }
    await tx.primljeniDokument.update({ where: { id }, data: {
      status: posted ? "ARHIVIRANO" : "PRIMLJENO",
      greska_arhive: null,
      ...(entry?.is_deleted ? { kuf_entry_id: null } : {})
    } });
    await auditDocument(tx, doc, posted ? "arhiviraj" : "vrati_u_primljeno", undefined, { kuf_entry_id: doc.kuf_entry_id });
    return true;
  }, { timeout: 90000 });
}

export async function findPostedDocuments(scope: DokumentaScope) {
  return prisma.$queryRaw<Array<{ id: string }>>`
    SELECT d.id FROM primljeni_dokumenti d
    JOIN kuf_entries k ON k.id = d.kuf_entry_id AND k.agencija_id = d.agencija_id
      AND k.firma_id = d.firma_id AND k.poslovna_godina_id = d.poslovna_godina_id
    JOIN nalozi n ON n.id = k.journal_id AND n.agencija_id = d.agencija_id
      AND n.firma_id = d.firma_id AND n.poslovna_godina_id = d.poslovna_godina_id
    JOIN kuf_books b ON b.id = k.kuf_book_id AND b.agencija_id = d.agencija_id
      AND b.firma_id = d.firma_id AND b.poslovna_godina_id = d.poslovna_godina_id
    WHERE d.agencija_id = ${scope.agencija_id}::uuid AND d.firma_id = ${scope.firma_id}::uuid
      AND d.poslovna_godina_id = ${scope.poslovna_godina_id}::uuid
      AND d.status NOT IN ('UPLOAD', 'ARHIVIRANO') AND k.posting_status = 'POSTED'
      AND NOT k.is_deleted AND n.status = 'POSTED' AND NOT n.is_deleted AND NOT b.is_deleted
    ORDER BY d.created_at, d.id
  `;
}

export async function runDocumentationMaintenance() {
  const folders = await prisma.dokumentaFolder.findMany({
    where: { firma: { aktivan: true, is_deleted: false } },
    include: { firma: { select: { agencija_id: true, poslovne_godine: { select: { id: true, godina: true } } } } }
  });
  let failures = 0;
  let imported = 0;
  for (const folder of folders) {
    if (folder.agencija_id !== folder.firma.agencija_id) continue;
    for (const year of folder.firma.poslovne_godine) {
      try {
        imported += await syncIncoming({ agencija_id: folder.agencija_id, firma_id: folder.firma_id,
          poslovna_godina_id: year.id }, year.godina);
      } catch {
        failures += 1;
      }
    }
  }
  const pending = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT d.id FROM primljeni_dokumenti d
    JOIN firme f ON f.id = d.firma_id AND f.agencija_id = d.agencija_id AND f.aktivan AND NOT f.is_deleted
    LEFT JOIN kuf_entries k ON k.id = d.kuf_entry_id
    LEFT JOIN nalozi n ON n.id = k.journal_id
    LEFT JOIN kuf_books b ON b.id = k.kuf_book_id
    WHERE d.status <> 'UPLOAD' AND (
      (d.status = 'ARHIVIRANO' AND (k.id IS NULL OR k.is_deleted OR k.posting_status <> 'POSTED'
        OR n.status IS DISTINCT FROM 'POSTED' OR n.is_deleted OR b.is_deleted))
      OR (d.status <> 'ARHIVIRANO' AND k.posting_status = 'POSTED' AND NOT k.is_deleted
        AND n.status = 'POSTED' AND NOT n.is_deleted AND NOT b.is_deleted)
      OR k.is_deleted OR d.greska_arhive IS NOT NULL
    )
    ORDER BY d.updated_at LIMIT 30
  `;
  for (const doc of pending) {
    try {
      await reconcileDocument(doc.id);
    } catch {
      failures += 1;
    }
  }
  return { imported, checked: pending.length, failures };
}

export function startDocumentationMaintenance() {
  const state = globalThis as typeof globalThis & { documentationTimer?: ReturnType<typeof setInterval>; documentationBusy?: boolean };
  if (state.documentationTimer) return;
  async function tick() {
    if (!process.env.DOKUMENTA_ONEDRIVE_CLIENT_ID) return;
    if (state.documentationBusy) return;
    state.documentationBusy = true;
    try {
      const result = await runDocumentationMaintenance();
      if (result.failures) console.warn("OneDrive dokumentacija: neuspjele provjere", result.failures);
    } catch (error) {
      console.warn("OneDrive dokumentacija: periodična provjera nije uspjela.",
        error instanceof Error ? error.name : "Nepoznata greška");
    } finally {
      state.documentationBusy = false;
    }
  }
  state.documentationTimer = setInterval(() => { void tick(); }, 60_000);
  state.documentationTimer.unref();
}
