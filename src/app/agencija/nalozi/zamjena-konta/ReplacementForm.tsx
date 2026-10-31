"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import { replaceJournalAccount } from "./actions";

const journalMoney = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  companyId: string; yearId: string;
  accounts: Array<{ code: string; name: string; active: boolean }>;
  journalTypes: Array<{ id: string; naziv: string; prefiks: string | null }>;
};

export function ReplacementForm({ accounts, journalTypes, companyId, yearId }: Props) {
  const [state, action, pending] = useActionState(replaceJournalAccount, {});
  const [filter, setFilter] = useState({ from: "", to: "", journalTypeId: "", dateFrom: "", dateTo: "" });
  const change = (key: keyof typeof filter, value: string) => setFilter(previous => ({ ...previous, [key]: value }));
  const preview = state.preview && JSON.stringify(state.preview.filter) === JSON.stringify(filter) &&
    state.preview.companyId === companyId && state.preview.yearId === yearId ? state.preview : null;
  return <>
    <section className="admin-panel">
      <form action={action} className="admin-form">
        <input type="hidden" name="intent" value="preview" />
        <div className="account-replacement-fields">
          <label>Trenutni konto<AccountSearchSelect name="from" required value={filter.from} onChange={event => change("from", event.target.value)}>
            <option value="">Šifra ili naziv konta</option>
            {accounts.map(account => <option key={account.code} value={account.code}>{account.code} — {account.name}{account.active ? "" : " (neaktivan)"}</option>)}
          </AccountSearchSelect></label>
          <label>Novi konto<AccountSearchSelect name="to" required value={filter.to} onChange={event => change("to", event.target.value)}>
            <option value="">Šifra ili naziv konta</option>
            {accounts.filter(account => account.active).map(account => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}
          </AccountSearchSelect></label>
          <label>Vrsta naloga<select name="journalTypeId" required value={filter.journalTypeId} onChange={event => change("journalTypeId", event.target.value)}>
            <option value="">Izaberite vrstu naloga</option>
            {journalTypes.map(type => <option key={type.id} value={type.id}>{type.naziv}{type.prefiks ? ` (${type.prefiks})` : ""}</option>)}
          </select></label>
          <label>Datum od<input type="date" name="dateFrom" value={filter.dateFrom} onChange={event => change("dateFrom", event.target.value)} /></label>
          <label>Datum do<input type="date" name="dateTo" value={filter.dateTo} onChange={event => change("dateTo", event.target.value)} /></label>
        </div>
        <button className="primary-button" type="submit" disabled={pending}>{pending ? "Obrada…" : "Prikaži stavke"}</button>
      </form>
    </section>
    {state.error ? <div role="alert" className="status-banner error">{state.error}</div> : null}
    {state.success ? <div role="status" className="status-banner">{state.success}</div> : null}
    {preview ? <section className="admin-panel">
      <h3>Pregled zamjene</h3>
      <p><strong>{preview.from}</strong> → <strong>{preview.to}</strong> · {preview.journalType}</p>
      <p>{preview.count} stavki u {preview.journalCount} naloga · Duguje {journalMoney(preview.debit)} · Potražuje {journalMoney(preview.credit)}</p>
      {preview.bankCount ? <p>Uskladiće se i izvorne stavke za {preview.bankCount} izvoda.</p> : null}
      {preview.journalCount ? <details><summary>Svi pogođeni nalozi ({preview.journalCount})</summary><ul>{preview.journals.map(journal => <li key={journal.id}><Link href={`/agencija/nalozi/${journal.id}`}>{journal.code}</Link> · {journal.date} · {journal.count} stavki</li>)}</ul></details> : null}
      {!preview.count ? <p>Nema proknjiženih stavki za izabrani konto, vrstu naloga i period.</p> : <>
        {preview.blocked.length ? <div className="status-banner error"><strong>Zamjena je blokirana. Nijedna stavka neće biti promijenjena.</strong><ul>{preview.blocked.map((item, index) => <li key={`${item.journalId}-${index}`}><Link href={`/agencija/nalozi/${item.journalId}`}>Nalog</Link>: {item.message}</li>)}</ul></div> : null}
        <div className="table-wrap"><table><thead><tr><th>Datum</th><th>Nalog / stavka</th><th>Partner</th><th>Dokument</th><th>Opis</th><th>Duguje</th><th>Potražuje</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.id}><td>{new Date(`${row.date}T00:00:00Z`).toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" })}</td><td><Link href={`/agencija/nalozi/${row.journalId}`}>{row.journal}</Link><small>Stavka {row.number}</small></td><td>{row.partner}</td><td>{row.document}</td><td>{row.description}</td><td className="amount-cell">{journalMoney(row.debit)}</td><td className="amount-cell">{journalMoney(row.credit)}</td></tr>)}</tbody>
        </table></div>
        {preview.count > preview.rows.length ? <p>Prikazano prvih {preview.rows.length} stavki. Potvrda obuhvata svih {preview.count} stavki iz ovog pregleda.</p> : null}
        {preview.token ? <form action={action}>
          <input type="hidden" name="intent" value="confirm" />
          <input type="hidden" name="token" value={preview.token} />
          <p>Potvrdom mijenjate konto na prikazanim knjiženjima. Iznosi, partneri i brojevi naloga ostaju isti.</p>
          <button className="primary-button" type="submit" disabled={pending}>{pending ? "Obrada…" : `Potvrdi zamjenu (${preview.count})`}</button>
        </form> : null}
      </>}
    </section> : null}
  </>;
}
