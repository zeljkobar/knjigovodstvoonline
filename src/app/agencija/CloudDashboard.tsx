import Link from "next/link";
import { scanStatementCloud, statementCloudFolders } from "@/lib/bank-statement-cloud";
import { listIncomingFiles, type DokumentaScope } from "@/lib/dokumentacija";
import { prisma } from "@/lib/prisma";

export async function StatementCloudCard({ scope, year }: { scope: DokumentaScope; year: number }) {
  let summary;
  try {
    const folders = await statementCloudFolders(scope);
    if (!folders.length) return null;
    const groups = await scanStatementCloud(scope, year, folders);
    const rows = groups.flatMap(group => group.rows);
    summary = {
      toImport: rows.filter(row => row.status === "NEW").length,
      toPost: rows.filter(row => row.status === "IMPORTED").length,
      review: rows.filter(row => row.status === "REVIEW").length
    };
  } catch {
    return <article className="admin-panel"><h3>OneDrive izvodi</h3><p>Broj trenutno nije dostupan.</p>
      <Link href="/agencija/izvodi/onedrive" prefetch={false}>Otvori pregled</Link></article>;
  }
  return <article className="admin-panel">
    <div className="panel-header">
      <h3>Neproknjiženi OneDrive izvodi</h3>
      <Link className="table-link" href="/agencija/izvodi/onedrive" prefetch={false}>Pregled i uvoz</Link>
    </div>
    <p><strong>{summary.toImport + summary.toPost}</strong> ukupno</p>
    <small>{summary.toImport} čeka uvoz · {summary.toPost} čeka knjiženje{summary.review > 0 && ` · ${summary.review} za provjeru`}</small>
  </article>;
}

export async function IncomingCloudCard({ scope, year }: { scope: DokumentaScope; year: number }) {
  let count: number | null = null;
  try {
    if (!await prisma.dokumentaFolder.findFirst({
      where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id }, select: { firma_id: true }
    })) return null;
    const { driveId, items } = await listIncomingFiles(scope, year);
    const documents = await prisma.primljeniDokument.findMany({
      where: { ...scope, drive_id: driveId },
      select: {
        id: true, item_id: true, naziv_u_oblaku: true, status: true, kategorija: true, dopuna_za_id: true,
        kuf_entry: { select: { agencija_id: true, firma_id: true, poslovna_godina_id: true,
          is_deleted: true, posting_status: true, journal_id: true } }
      }
    });
    const journalIds = documents.flatMap(doc => doc.kuf_entry?.journal_id ? [doc.kuf_entry.journal_id] : []);
    const postedJournals = new Set((await prisma.nalog.findMany({
      where: { ...scope, id: { in: journalIds }, status: "POSTED", is_deleted: false }, select: { id: true }
    })).map(journal => journal.id));
    const byItem = new Map(documents.filter(doc => doc.item_id).map(doc => [doc.item_id, doc]));
    const uploads = new Map(documents.filter(doc => doc.status === "UPLOAD").map(doc => [doc.naziv_u_oblaku, doc]));
    const rootIds = new Set<string>();
    const inScope = (value: DokumentaScope) =>
      value.agencija_id === scope.agencija_id && value.firma_id === scope.firma_id && value.poslovna_godina_id === scope.poslovna_godina_id;
    for (const item of items) {
      const doc = byItem.get(item.id) ?? uploads.get(item.name);
      const invoiceType = doc?.kategorija === "ULAZNI" || doc?.kategorija === "IZLAZNI";
      if (!invoiceType && ((doc && doc.kategorija !== "OSTALO") || !/\.(pdf|tiff?|jpe?g|png)$/i.test(item.name))) continue;
      const entry = doc?.kuf_entry;
      if (entry && inScope(entry) && !entry.is_deleted && entry.posting_status === "POSTED" &&
          entry.journal_id && postedJournals.has(entry.journal_id)) continue;
      rootIds.add(doc?.dopuna_za_id ?? doc?.id ?? `cloud:${item.id}`);
    }
    count = rootIds.size;
  } catch {
    // Keep the rest of the dashboard available if OneDrive is unreachable.
  }
  return <article className="admin-panel">
    <div className="panel-header">
      <h3>Računi u folderu Primljeno</h3>
      <Link className="table-link" href="/agencija/dokumentacija" prefetch={false}>Otvori dokumentaciju</Link>
    </div>
    {count === null ? <p>Broj trenutno nije dostupan.</p> : <p><strong>{count}</strong> računa i nerazvrstanih skenova za obradu</p>}
  </article>;
}
