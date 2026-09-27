import Link from "next/link";
import MailImport from "./MailImport";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { hasPermission } from "@/lib/permissions";
import { mailSourceKey, mailImportLabels } from "@/lib/mail-import-policy";
import { requireImapCompany } from "./access";
import ConnectionTest from "./ConnectionTest";
import { getMailDetail, listCompanyInbox, MailError, mailPage, mailReference } from "@/lib/imap-mail";
import { getCompanyMailConfigs } from "@/lib/company-mail-settings";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const path = "/agencija/izvodi/imap";

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" }) : "—";
}

export default async function ImapConnectionPage({ searchParams }: {
  searchParams?: Promise<{ page?: string; uid?: string; validity?: string; folder?: string; firma?: string }>;
}) {
  const params = await searchParams;
  const { user, firma } = await requireImapCompany(params?.uid ? params.firma || "missing" : undefined);
  const configs = await getCompanyMailConfigs(user.agencija_id!);
  const config = configs.find((item) => item.firmaId === firma.id);
  if (!config) return <div className="admin-stack"><h2>Mailovi — {firma.naziv}</h2><section className="admin-panel">
    <p>Podesite preuzimanje mailova za ovu firmu ili uključite njen pregled.</p>
    <Link href="/agencija/izvodi/podesavanja">Otvori mail podešavanja</Link>
  </section></div>;
  const context = await readWorkContext();
  const year = context.poslovnaGodinaId ? await prisma.poslovnaGodina.findFirst({ where: { id: context.poslovnaGodinaId, firma_id: firma.id } }) : null;
  const canImport = Boolean(year && !year.zakljucena && await hasPermission(user, { firmaId: firma.id, modul: "izvodi", akcija: "create" }));
  const page = mailPage(params?.page);
  let inbox: Awaited<ReturnType<typeof listCompanyInbox>> | undefined;
  let detail: Awaited<ReturnType<typeof getMailDetail>> | undefined;
  let ref: ReturnType<typeof mailReference> | undefined;
  let error = "";
  try {
    if (params?.uid) {
      ref = mailReference(params.uid, params.validity);
      detail = await getMailDetail(ref.uid, ref.validity, params.folder || "", config);
      await auditLog({ korisnikId: user.id, agencijaId: user.agencija_id, firmaId: firma.id,
        modul: "izvodi", akcija: "IMAP_READ_MESSAGE", tipEntiteta: "IMAP_CONNECTION",
        novaVrijednost: { status: "OK" } });
    } else {
      inbox = await listCompanyInbox(config, page);
    }
  } catch (caught) {
    error = caught instanceof MailError ? caught.message : "Mailove trenutno nije moguće prikazati. Pokušajte ponovo.";
  }

  const messageKeys = inbox?.messages.map((mail) => mailSourceKey(mail.folder, mail.validity, mail.uid)) || [];
  if (params?.uid && ref) messageKeys.push(mailSourceKey(params.folder || "", ref.validity, ref.uid));
  const records = year && messageKeys.length ? await prisma.mailIzvodObrada.findMany({ where: {
    agencija_id: user.agencija_id!, firma_id: firma.id, poslovna_godina_id: year.id,
    poruka_kljuc: { in: messageKeys }
  }, orderBy: { created_at: "asc" } }) : [];
  function importStatus(key: string) {
    const items = records.filter((item) => item.poruka_kljuc === key);
    return items.length ? <ul>{items.map((item) => <li key={item.id}>
      {item.naziv_priloga}: <strong>{item.status === "IMPORTED" && !item.izvod_id ? "Potrebna provjera — izvod je obrisan" : mailImportLabels[item.status]}</strong>
      {item.razlog && ` — ${item.razlog}`}
      {item.izvod_id && <> · <Link href={`/agencija/izvodi?izvod=${item.izvod_id}`}>Otvori izvod</Link></>}
    </li>)}</ul> : <small>Za uvoz — prilozi još nijesu provjereni.</small>;
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div><h2>Mailovi — {firma.naziv}</h2><p>Pregled samo za čitanje. Otvaranje poruke ne mijenja oznaku pročitano.</p></div>
        <form action={path} method="get"><button className="secondary-button" type="submit">Osvježi spisak</button></form>
      </header>
      <Link href="/agencija/izvodi/podesavanja">Podešavanja foldera i pravila firme</Link>
      <details className="admin-panel"><summary>Provjera IMAP veze</summary><ConnectionTest /></details>
      <MailImport key={`${firma.id}-${year?.id}`} firmaId={firma.id} yearId={year?.id || ""} disabled={!canImport} />
      {error && <p className="admin-message" role="alert">{error}</p>}
      {params?.uid && <Link className="table-link" href={`${path}?page=${page}`}>← Nazad na spisak</Link>}
      {detail && ref && <section className="admin-panel" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <h3>{detail.subject}</h3>
        {importStatus(mailSourceKey(params?.folder || "", ref.validity, ref.uid))}
        <p><strong>Od:</strong> {detail.from}<br /><strong>Za:</strong> {detail.to}<br /><strong>Datum:</strong> {dateLabel(detail.date)}</p>
        <hr />
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6 }}>{detail.text}</div>
        {detail.truncated && <p>Prikazan je početak duge poruke. Cijelu poruku otvorite u svom mail programu.</p>}
        {detail.attachments.length > 0 && <div>
          <h3>Prilozi ({detail.attachments.length})</h3>
          <ul>{detail.attachments.map((attachment) => <li key={attachment.index}>
            <a className="table-link" href={`${path}/prilog?firma=${firma.id}&folder=${encodeURIComponent(params?.folder || "")}&uid=${ref.uid}&validity=${ref.validity}&index=${attachment.index}`}>
              {attachment.filename}
            </a> — {Math.ceil(attachment.size / 1024)} KB
          </li>)}</ul>
        </div>}
      </section>}
      {inbox && <section className="admin-panel">
        <p>Ukupno {inbox.count.toLocaleString("sr-Latn-ME")} poruka · Stranica {inbox.page} od {inbox.pages} · Najnovije prvo</p>
        {inbox.messages.length === 0 ? <p className="empty-state">Nema poruka koje odgovaraju podešavanjima ove firme.</p> : <div className="table-wrap">
          <table><thead><tr><th>Status</th><th>Pošiljalac / naslov</th><th>Datum</th><th>Veličina</th></tr></thead>
            <tbody>{inbox.messages.map((mail) => <tr key={`${mail.folder}-${mail.validity}-${mail.uid}`}>
              <td>{mail.seen ? "Pročitano" : <strong>Nepročitano</strong>}</td>
              <td style={{ minWidth: 200, maxWidth: 650, overflowWrap: "anywhere" }}>
                <div>{mail.from}</div><small>Folder: {mail.folder}</small>
                <div>{importStatus(mailSourceKey(mail.folder, mail.validity, mail.uid))}</div>
                <Link prefetch={false} className="table-link" href={`${path}?page=${inbox.page}&firma=${firma.id}&folder=${encodeURIComponent(mail.folder)}&uid=${mail.uid}&validity=${mail.validity}`}>
                  {mail.seen ? mail.subject : <strong>{mail.subject}</strong>}
                </Link>
              </td>
              <td>{dateLabel(mail.date)}</td><td>{Math.ceil(mail.size / 1024)} KB</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <nav aria-label="Stranice mailova" style={{ display: "flex", gap: 20, marginTop: 16 }}>
          {inbox.page > 1 && <Link prefetch={false} href={`${path}?page=${inbox.page - 1}`}>← Novije</Link>}
          {inbox.page < inbox.pages && <Link prefetch={false} href={`${path}?page=${inbox.page + 1}`}>Starije →</Link>}
        </nav>
      </section>}
    </div>
  );
}
