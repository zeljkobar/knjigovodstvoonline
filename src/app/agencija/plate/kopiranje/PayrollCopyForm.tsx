"use client";
import { useActionState, useState } from "react";
import type { PayrollCopyRow } from "@/lib/payroll-copy";
import { copyPayrollAction } from "./actions";

const money = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PayrollCopyForm({ rows, source, target }: { rows: PayrollCopyRow[]; source: string; target: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action, pending] = useActionState(copyPayrollAction, { error: null, results: [] });
  const done = new Set(state.results.filter(r => r.ok).map(r => r.companyId));
  const available = rows.filter(r => !r.reason && !done.has(r.companyId));
  const chosen = selected.filter(id => available.some(r => r.companyId === id));
  const all = available.length > 0 && chosen.length === available.length;
  return <div className="admin-stack">
    {state.error ? <p className="admin-message" role="alert">{state.error}</p> : null}
    {state.results.length ? <section className="admin-panel" aria-live="polite"><h3>Rezultat kopiranja</h3><p>{state.results.filter(r => r.ok).length} uspješno · {state.results.filter(r => !r.ok).length} preskočeno</p><ul>{state.results.map(result => <li key={result.companyId}><strong>{result.name}</strong>: {result.message}{result.calculations.map(c => <span key={c.id}> <a className="table-link" href={`/agencija/kontekst?${new URLSearchParams({ firma_id: result.companyId, poslovna_godina_id: c.yearId, returnTo: `/agencija/plate/obracun?obracun=${c.id}` })}`}>Otvori obračun {c.number}</a></span>)}</li>)}</ul></section> : null}
    <form action={action} className="admin-panel">
      <input type="hidden" name="izvor" value={source}/><input type="hidden" name="cilj" value={target}/>
      <div className="panel-header"><h3>Firme sa obračunatim platama</h3><span>Firmi: {rows.length} · Označeno: {chosen.length}</span></div>
      <p className="admin-hint">Prikazuju se obračuni redovnog rada. Označite firme za koje ostaju iste stavke, ulazni iznosi i fond sati. Datumi se prenose u ciljni mjesec, a iznosi ponovo računaju po važećim pravilima. Kopije će odmah biti obračunate.</p>
      <label className="single-checkbox"><input type="checkbox" checked={all} disabled={pending || !available.length} onChange={() => setSelected(all ? [] : available.map(r => r.companyId))}/>Označi sve dostupne firme</label>
      <div className="table-wrap"><table><thead><tr><th>Izbor</th><th>Firma</th><th>Izvorni obračuni</th><th>Radnici</th><th>Neto za isplatu u izvoru (EUR)</th><th>Status</th></tr></thead><tbody>{rows.length ? rows.map(row => <tr key={row.companyId}>
        <td><input type="hidden" name={`verzija_${row.companyId}`} value={row.version}/><input aria-label={`Kopiraj: ${row.name}`} type="checkbox" name="firma_id" value={row.companyId} checked={chosen.includes(row.companyId)} disabled={pending || Boolean(row.reason) || done.has(row.companyId)} onChange={e => setSelected(previous => e.target.checked ? [...previous, row.companyId] : previous.filter(id => id !== row.companyId))}/></td>
        <td><strong>{row.name}</strong><small>{row.pib ?? ""}</small></td><td>{row.count}</td><td>{row.workers}</td><td>{money(row.net)}</td><td>{done.has(row.companyId) ? "Kopirano i obračunato" : row.reason ?? "Spremno za kopiranje"}</td>
      </tr>) : <tr><td colSpan={6} className="empty-state">Nema obračunatih plata za izvorni mjesec u firmama kojima imate potrebna prava.</td></tr>}</tbody></table></div>
      <div className="header-actions" style={{ marginTop: "1rem" }}><button className="primary-button" type="submit" disabled={pending || !chosen.length}>{pending ? "Kopiranje i obračunavanje…" : `Kopiraj i obračunaj izabrane (${chosen.length})`}</button></div>
    </form>
  </div>;
}
