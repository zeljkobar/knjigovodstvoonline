import Link from "next/link";
import { requireImapAgency } from "../../izvodi/imap/access";
import ConnectionTest from "../../izvodi/imap/ConnectionTest";
import { agencyMailAccounts } from "@/lib/mail-accounts";
import { mailKeyConfigured } from "@/lib/mail-secrets";
import { saveMailAccount } from "./actions";
const messages: Record<string,string> = {
  sacuvano: "Mail nalog je sačuvan. Izaberite ga u podešavanjima izvoda firme.",
  podaci: "Provjerite naziv, IMAP server, korisničko ime i lozinku.",
  kljuc: "Na serveru treba podesiti MAIL_ENCRYPTION_KEY prije čuvanja naloga.",
  greska: "Nalog nije sačuvan. Osvježite stranicu; server i korisničko ime moraju biti jedinstveni i ne mijenjaju se na postojećem nalogu."
};
export default async function MailAccountsPage({searchParams}:{searchParams?:Promise<{poruka?:string}>}) {
  const user = await requireImapAgency(), query = await searchParams;
  const accounts = await agencyMailAccounts(user.agencija_id!);
  function fields(account?: (typeof accounts)[number]) {
    return <>
      <input type="hidden" name="id" value={account?.id ?? ""}/><input type="hidden" name="version" value={account?.updated_at.toISOString() ?? ""}/>
      <label>Naziv naloga<input name="naziv" maxLength={100} defaultValue={account?.naziv} required/></label>
      <label>IMAP server<input name="host" maxLength={253} defaultValue={account?.host} readOnly={Boolean(account)} placeholder="imap.example.com" required/></label>
      <label>Port / zaštita<input value="993 / TLS" readOnly/></label>
      <label>Mail adresa / korisničko ime<input name="korisnicko_ime" maxLength={320} defaultValue={account?.korisnicko_ime} readOnly={Boolean(account)} autoComplete="off" required/></label>
      <label>{account ? "Nova lozinka (prazno zadržava postojeću)" : "Lozinka / App password"}<input name="lozinka" type="password" maxLength={4096} autoComplete="new-password" required={!account}/></label>
      <label><input name="aktivan" type="checkbox" defaultChecked={account?.aktivan ?? true}/> Aktivan nalog</label>
      <label><input name="automatska_obrada" type="checkbox" defaultChecked={account?.automatska_obrada ?? false}/> Automatsko preuzimanje i knjiženje izvoda u 10:00</label>
      <div className="form-actions"><button type="submit">Sačuvaj nalog</button></div>
    </>;
  }
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Mail nalozi agencije</h2><p>Više sandučića za agenciju. Firma bira jedan nalog i svoja pravila za izvode.</p></div><Link className="secondary-button" href="/agencija/izvodi/podesavanja">Podešavanja firme</Link></header>
    {query?.poruka && messages[query.poruka] ? <p role="status" className="admin-message">{messages[query.poruka]}</p> : null}
    {!mailKeyConfigured() ? <p className="admin-message">Nedostaje serverski ključ MAIL_ENCRYPTION_KEY.</p> : null}
    <section className="admin-panel"><h3>Novi mail nalog</h3><form className="admin-form" action={saveMailAccount}>{fields()}</form></section>
    {accounts.map(account => <section className="admin-panel" key={account.id}>
      <div className="panel-header"><h3>{account.naziv}</h3><span>{account.aktivan ? "Aktivan" : "Neaktivan"}</span></div>
      <p>Za drugu adresu ili server dodajte novi nalog, radi odvojene evidencije poruka. Gmail/Yahoo mogu zahtijevati posebnu lozinku za aplikaciju.</p>
      <form className="admin-form" action={saveMailAccount}>{fields(account)}</form>
      {account.aktivan ? <ConnectionTest accountId={account.id}/> : null}
    </section>)}
  </div>;
}
