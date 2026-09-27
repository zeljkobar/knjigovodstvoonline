"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { MailRule } from "@/lib/company-mail-rules";
import { loadCompanyMailFolders, saveCompanyMailSettings } from "./mail-actions";
import styles from "./settings.module.css";

const blank = (): MailRule => ({ sender: "", subject: "", attachment: "" });
export default function MailSettingsForm({ firmaId, godinaId, initial }: {
  firmaId: string; godinaId: string;
  initial: { folder: string; subfolders: boolean; inbox: boolean; active: boolean; rules: MailRule[]; version: string };
}) {
  const [rules, setRules] = useState(initial.rules.length ? initial.rules : [blank()]);
  const [folders, setFolders] = useState<Array<{ path: string; selectable: boolean }>>([]);
  const [folderMessage, setFolderMessage] = useState("");
  const [loading, startLoad] = useTransition();
  const [state, action, pending] = useActionState(saveCompanyMailSettings, { message: "", ok: false });
  function change(index: number, key: keyof MailRule, value: string) {
    setRules((current) => current.map((rule, i) => i === index ? { ...rule, [key]: value } : rule));
  }
  return <section className={`admin-panel ${styles.panel}`}>
    <h3>Preuzimanje iz maila</h3>
    <p>Folderi i pravila važe za izabranu firmu. Sanduče i lozinka pripadaju agenciji.</p>
    <form action={action} className={styles.mailForm}>
      <input type="hidden" name="firma_id" value={firmaId} />
      <input type="hidden" name="godina_id" value={godinaId} />
      <input type="hidden" name="version" value={initial.version} />
      <input type="hidden" name="pravila" value={JSON.stringify(rules)} />
      <label><input type="checkbox" name="aktivno" defaultChecked={initial.active} /> Uključi pregled mailova za ovu firmu</label>
      <label>Folder firme
        <select name="folder" defaultValue={initial.folder}>
          <option value="">Bez posebnog foldera</option>
          {initial.folder && !folders.some((item) => item.path === initial.folder) && <option value={initial.folder}>{initial.folder}</option>}
          {folders.map((item) => <option key={item.path} value={item.path}>{item.path}{item.selectable ? "" : " (grupa foldera)"}</option>)}
        </select>
      </label>
      <div><button type="button" className="secondary-button" disabled={loading || pending} onClick={() => startLoad(async () => {
        try {
          const result = await loadCompanyMailFolders();
          if (result.ok) { setFolders(result.folders); setFolderMessage(`Učitano foldera: ${result.folders.length}.`); }
          else setFolderMessage(result.message);
        } catch { setFolderMessage("Foldere nije moguće učitati. Provjerite prijavu."); }
      })}>{loading ? "Učitavanje…" : "Učitaj foldere sa servera"}</button></div>
      {folderMessage && <p role="status">{folderMessage}</p>}
      <label><input type="checkbox" name="ukljuci_podfoldere" defaultChecked={initial.subfolders} /> Uključi podfoldere izabranog foldera</label>
      <label><input type="checkbox" name="ukljuci_inbox" defaultChecked={initial.inbox} /> Provjeravaj i INBOX</label>
      <p>Svi popunjeni uslovi u jednom redu moraju biti ispunjeni. Prazna polja se ne provjeravaju. Dovoljno je da poruka odgovara jednom redu. Pravila važe i u folderu firme i u INBOX-u.</p>
      {rules.map((rule, index) => <fieldset className={styles.mailRule} key={index}>
        <legend>Pravilo {index + 1}</legend>
        <label>Pošiljalac (tačna email adresa)<input type="email" maxLength={320} value={rule.sender} onChange={(e) => change(index, "sender", e.target.value)} placeholder="Opciono" /></label>
        <label>Subject / naslov sadrži<input maxLength={320} value={rule.subject} onChange={(e) => change(index, "subject", e.target.value)} placeholder="Riječ ili dio teksta bilo gdje" /></label>
        <label>Naziv attachmenta / priloga sadrži<input maxLength={320} value={rule.attachment} onChange={(e) => change(index, "attachment", e.target.value)} placeholder="Riječ ili dio naziva bilo gdje" /></label>
        <button type="button" className="secondary-button" onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>Ukloni pravilo {index + 1}</button>
      </fieldset>)}
      <div><button className="secondary-button" type="button" disabled={rules.length >= 20} onClick={() => setRules((current) => [...current, blank()])}>Dodaj pravilo</button></div>
      {!rules.some((rule) => rule.sender.trim() || rule.subject.trim() || rule.attachment.trim()) && <p className="admin-message">Bez popunjenih uslova prikazuju se samo poruke iz foldera firme. INBOX se preskače dok ne unesete bar jedan uslov, čak i kada je uključen.</p>}
      <p>Pretraga ne razlikuje velika i mala slova. Uslov za naziv priloga prolazi ako bar jedan prilog odgovara.</p>
      <div><button type="submit" className="primary-button" disabled={pending || loading}>{pending ? "Čuvanje…" : "Sačuvaj mail podešavanja"}</button> <Link href="/agencija/izvodi/imap">Pogledaj filtrirane mailove</Link></div>
      {state.message && <p role="status" className="admin-message">{state.message}</p>}
    </form>
  </section>;
}
