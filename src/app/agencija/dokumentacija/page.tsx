import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { dokumentaContext, dokumentaKategorije } from "@/lib/dokumentacija";
import { driveChildren, driveItemPath, graph, oneDriveAccess, type DriveItem } from "@/lib/dokumentacija-onedrive";
import { hasPermission } from "@/lib/permissions";
import { archivePostedDocuments, refreshIncoming, requestSupplement, retryArchive, saveDocumentFolder } from "./actions";
import { findPostedDocuments } from "@/lib/dokumentacija-arhiva";
import { DokumentaKufImport, DokumentaKufSelection } from "@/components/DokumentaKufImport";

export default async function DokumentacijaPage({ searchParams }: {
  searchParams: Promise<{ onedrive?: string; folder?: string; arhivirano?: string; preostalo?: string }>;
}) {
  const context = await dokumentaContext("view").catch(() => null);
  if (!context || context.client) return <p>Izaberite dostupnu firmu i poslovnu godinu.</p>;
  const { scope, user, firma, year } = context;
  const query = await searchParams;
  const archiveResult = /^\d+$/.test(query.arhivirano ?? "") && /^\d+$/.test(query.preostalo ?? "");
  const [documents, books, connection, mapping, canUpdate, canKuf] = await Promise.all([
    prisma.primljeniDokument.findMany({ where: { ...scope, status: { not: "UPLOAD" } },
      include: { kuf_entry: { select: { id: true, is_deleted: true, journal_id: true, posting_status: true, internal_kuf_number: true, kuf_book_id: true } } },
      orderBy: [{ created_at: "desc" }] }),
    prisma.kufBook.findMany({ where: { ...scope, is_deleted: false, status: "OPEN" },
      select: { id: true, mjesec: true, internal_kuf_number: true, racun_vrsta: { select: { naziv: true } } },
      orderBy: { mjesec: "desc" } }),
    prisma.dokumentaOneDrive.findUnique({ where: { agencija_id: scope.agencija_id }, select: { drive_id: true } }),
    prisma.dokumentaFolder.findUnique({ where: { firma_id: firma.id } }),
    hasPermission(user, { firmaId: firma.id, modul: "dokumentacija", akcija: "update" }),
    hasPermission(user, { firmaId: firma.id, modul: "ulazni_racuni", akcija: "create" })
  ]);
  const canProcess = canKuf && canUpdate && !year.zakljucena;
  const bookOptions = books.map(book => ({
    id: book.id, label: `${book.internal_kuf_number} · ${book.mjesec} · ${book.racun_vrsta.naziv}`
  }));
  const selectionKey = `dokumentacija:kuf:${user.id}:${firma.id}:${year.id}`;
  const importDocuments = documents
    .filter(doc => doc.status === "PRIMLJENO" && !doc.kuf_entry_id &&
      (doc.kategorija === "ULAZNI" || doc.kategorija === "OSTALO") &&
      (doc.qr_link || /\.(pdf|tiff?|jpe?g|png)$/i.test(doc.naziv)))
    .map(doc => ({ id: doc.id, name: doc.naziv, qr: doc.qr_link, size: doc.velicina }));
  const journalIds = documents.flatMap(doc => doc.kuf_entry?.journal_id ? [doc.kuf_entry.journal_id] : []);
  const postedJournals = new Set((await prisma.nalog.findMany({ where: { ...scope, id: { in: journalIds },
    status: "POSTED", is_deleted: false }, select: { id: true } })).map(journal => journal.id));
  const pendingArchive = canUpdate ? (await findPostedDocuments(scope)).length : 0;
  let folder: DriveItem | undefined;
  let children: DriveItem[] = [];
  let folderError = false;
  if (user.rola === "admin_agencije" && connection && query.folder) {
    try {
      const { token, driveId } = await oneDriveAccess(scope.agencija_id);
      folder = await graph(token, query.folder === "root"
        ? `drives/${encodeURIComponent(driveId)}/root` : driveItemPath(driveId, query.folder));
      if (folder?.folder) children = (await driveChildren(token, driveId, folder.id)).filter(child => child.folder);
    } catch { folderError = true; }
  }
  const messages: Record<string, string> = { folder: "Folder je povezan.", povezano: "OneDrive je povezan.",
    greska_folder: "Folder nije sačuvan. Provjerite da li je već dodijeljen ili firma ima primljene dokumente.",
    greska: "OneDrive operacija nije uspjela.", osvjezeno: "Primljena dokumentacija je osvježena." };
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Primljena dokumentacija</h2><p>{firma.naziv} · {year.godina}</p></div></header>
    {query.onedrive && messages[query.onedrive] && <p role="status">{messages[query.onedrive]}</p>}
    <section className="admin-panel">
      {user.rola === "admin_agencije" && <div className="table-actions">
        <Link className="table-button" href="/api/dokumentacija/oauth" prefetch={false}>{connection ? "Ponovo poveži OneDrive" : "Poveži OneDrive"}</Link>
        {connection && <Link className="table-button" href="?folder=root">Odaberi folder firme</Link>}
      </div>}
      <p>{mapping ? "OneDrive folder firme je povezan." : "Firma još nema povezan OneDrive folder."}</p>
      {folderError && <p role="alert">OneDrive folder trenutno nije dostupan.</p>}
      {folder?.folder && <div>
        <p>{folder.name}</p>
        {folder.parentReference?.id && <Link href={`?folder=${encodeURIComponent(folder.parentReference.id)}`}>Nazad</Link>}
        {folder.parentReference?.id && <form action={saveDocumentFolder}>
          <input type="hidden" name="folderId" value={folder.id} /><button type="submit">Poveži ovaj folder</button>
        </form>}
        <ul>{children.map(child => <li key={child.id}><Link href={`?folder=${encodeURIComponent(child.id)}`}>{child.name}</Link></li>)}</ul>
      </div>}
      {canUpdate && mapping && <form action={refreshIncoming}><button type="submit">Osvježi iz OneDrive-a</button></form>}
    </section>
    {(["PRIMLJENO", "ARHIVIRANO"] as const).map(group => {
      const table = <div className="table-wrap"><table><thead><tr><th>Dokument</th><th>Status</th><th>Obrada</th></tr></thead>
        <tbody>{documents.filter(doc => group === "ARHIVIRANO" ? doc.status === group && !doc.greska_arhive : doc.status !== "ARHIVIRANO" || doc.greska_arhive).map(doc => {
          const entry = doc.kuf_entry?.is_deleted ? null : doc.kuf_entry;
          const posted = entry?.posting_status === "POSTED" && entry.journal_id && postedJournals.has(entry.journal_id);
          const status = doc.greska_arhive ?? (doc.status === "ARHIVIRANO" ? "Obrađeno" : posted ? "Proknjiženo · čeka premještanje" :
            entry ? "Uneseno u KUF" : doc.status === "DOPUNA" ? "Potrebna dopuna" : "Primljeno");
          return <tr key={doc.id}>
            <td><strong>{doc.naziv}</strong><small>{dokumentaKategorije.find(([id]) => id === doc.kategorija)?.[1]} · {doc.izvor === "PORTAL" ? "Klijentski portal" : "OneDrive"}</small>
              {doc.dopuna_za_id && <small>Dopuna</small>}
              {doc.napomena && <small>{doc.napomena}</small>}
              <a href={`/api/dokumentacija/original?id=${doc.id}`} target="_blank" rel="noreferrer">{doc.item_id ? "Otvori original" : "Otvori fiskalni link"}</a></td>
            <td>{status}<small>{doc.qr_link ? "QR pročitan" : doc.qr_status === "NECITLJIV" ? "QR nečitljiv" : "Bez sačuvanog QR linka"}</small>
              {doc.zahtjev_dopune && <small>{doc.zahtjev_dopune}</small>}</td>
            <td>{entry ? <Link href={`/agencija/racuni/kuf/${entry.kuf_book_id}`}>{entry.internal_kuf_number}</Link> :
              canProcess && group === "PRIMLJENO" && doc.status === "PRIMLJENO" && !doc.kuf_entry_id &&
                <DokumentaKufImport document={{ id: doc.id, name: doc.naziv, qr: doc.qr_link, size: doc.velicina }} />}
              {canUpdate && (doc.greska_arhive || (posted && doc.status !== "ARHIVIRANO")) && <form action={retryArchive}>
                <input type="hidden" name="id" value={doc.id} /><button type="submit">Ponovi premještanje</button></form>}
              {canUpdate && !entry && doc.poslao_id && !doc.dopuna_za_id && <form action={requestSupplement}>
                <input type="hidden" name="id" value={doc.id} /><input name="comment" required maxLength={1000} placeholder="Šta treba dopuniti" aria-label="Šta treba dopuniti" />
                <button type="submit">Zatraži dopunu</button></form>}
            </td>
          </tr>;
        })}</tbody>
      </table></div>;
      return <section className="admin-panel" key={group}>
        <h3>{group === "ARHIVIRANO" ? "Arhivirano" : "Primljeno"}</h3>
        {group === "PRIMLJENO" && archiveResult && <p role="status">
          Arhivirano {query.arhivirano}. Još čeka {query.preostalo}.
        </p>}
        {group === "PRIMLJENO" && pendingArchive > 0 && <form action={archivePostedDocuments} className="table-actions">
          <input type="hidden" name="firma" value={firma.id} />
          <input type="hidden" name="godina" value={year.id} />
          <button className="primary-button" type="submit">Premjesti proknjižene račune ({pendingArchive})</button>
        </form>}
        {group === "PRIMLJENO" && canProcess
          ? <DokumentaKufSelection key={selectionKey} sessionKey={selectionKey} books={bookOptions}
              scope={{ companyId: firma.id, yearId: year.id, userId: user.id }}
              documents={importDocuments}>{table}</DokumentaKufSelection>
          : table}
      </section>;
    })}
  </div>;
}
