"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JournalEntryForm } from "./JournalEntryForm";
import { JournalLinesEditor, type JournalLineInitialValue } from "./JournalLinesEditor";

type Props = {
  statementId: string; statementVersion: string; journalId: string; journalVersion: string;
  date: string; description: string; unitId: string;
  units: Array<{ id: string; sifra: string; naziv: string }>;
  accounts: Array<{ sifra: string; naziv: string; analitika_obavezna: boolean }>;
  initialLines: JournalLineInitialValue[];
  allocations: Array<{ id: string; label: string }>;
  canPost: boolean; manualSaved: boolean;
  saveAction: (form: FormData) => Promise<{ error?: string; url?: string }>;
  postAction: (form: FormData) => Promise<void>;
};

export function ManualBankJournalForm(props: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(!props.manualSaved);
  async function save(data: FormData) {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const result = await props.saveAction(data);
      if (result.error) setError(result.error);
      else if (result.url) { router.replace(result.url, { scroll: false }); router.refresh(); }
    } catch { setError("Nalog nije sačuvan. Unesene izmjene su zadržane; pokušajte ponovo."); }
    finally { setSaving(false); }
  }
  const versions = <>
    <input type="hidden" name="statement_id" value={props.statementId} />
    <input type="hidden" name="statement_version" value={props.statementVersion} />
    <input type="hidden" name="journal_id" value={props.journalId} />
    <input type="hidden" name="journal_version" value={props.journalVersion} />
  </>;
  return <>
    <JournalEntryForm action={save} requiredAnalyticsAccounts={props.accounts.filter(a => a.analitika_obavezna).map(a => a.sifra)}
      onValidatedSubmit={event => {
        event.preventDefault();
        void save(new FormData(event.currentTarget));
      }}>
      {versions}
      <fieldset disabled={saving} className="manual-bank-fields" onChange={() => setDirty(true)}>
        <div className="admin-form">
          <label><span>Datum naloga</span><input type="date" name="datum" defaultValue={props.date} required /></label>
          <label><span>Opis naloga</span><input name="opis" defaultValue={props.description} /></label>
          <label><span>Poslovna jedinica</span><select name="poslovna_jedinica_id" defaultValue={props.unitId}>
            <option value="">Bez jedinice</option>
            {props.units.map(unit => <option key={unit.id} value={unit.id}>{unit.sifra} · {unit.naziv}</option>)}
          </select></label>
        </div>
        <JournalLinesEditor accounts={props.accounts} datalistId="manual-bank-accounts" initialLines={props.initialLines}
          allowRemoveRows onActivity={() => setDirty(true)} />
        {props.allocations.length ? <div className="status-banner">
          <p>Postojeća povezivanja sa fakturama zadržavaju se ako im odgovaraju partneri, konta i iznosi sačuvanog naloga.</p>
          <ul>{props.allocations.map(a => <li key={a.id}>{a.label}</li>)}</ul>
          <label><input type="checkbox" name="clear_allocations" value="1" /> Ukloni postojeća povezivanja sa fakturama</label>
        </div> : null}
        <p className="admin-hint">F8 čuva nacrt. Poslije čuvanja F9 knjiži sačuvani nalog. F10 popunjava razliku u aktivnoj stavci. Nacrt može biti neizbalansiran; knjiženje provjerava ravnotežu.</p>
        {error ? <p className="status-banner error" role="alert">{error}</p> : null}
        <button type="submit" className="primary-button">{saving ? "Čuvam..." : "Sačuvaj nalog (F8)"}</button>
      </fieldset>
    </JournalEntryForm>
    {props.canPost && props.journalId && props.manualSaved ? <form action={props.postAction} data-journal-post-form="true" onSubmit={event => {
      if (dirty || saving) { event.preventDefault(); setError("Prvo sačuvajte izmjene naloga (F8), pa ga proknjižite (F9)."); }
    }}>
      {versions}
      <button type="submit" className="primary-button" disabled={dirty || saving}>Proknjiži nalog (F9)</button>
    </form> : null}
  </>;
}
