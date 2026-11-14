export function DokumentaOriginal({ entryId, documents }: {
  entryId: string;
  documents: Array<{ id: string; item_id: string | null; qr_link: string | null; naziv: string }>;
}) {
  return documents.filter(doc => doc.item_id || doc.qr_link).map(doc => <small key={doc.id}>
    <a href={`/api/dokumentacija/original?kuf=${entryId}&id=${doc.id}`} target="_blank" rel="noreferrer"
      title={doc.naziv}>{doc.item_id ? "Otvori original" : "Otvori fiskalni link"}</a>
  </small>);
}
