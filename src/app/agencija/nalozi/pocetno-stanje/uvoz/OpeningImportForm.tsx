"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import type { OpeningImportOptions, OpeningImportPreview } from "@/lib/opening-import";

const money = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const endpoint = "/api/nalozi/pocetno-stanje/uvoz";

export function OpeningImportForm({ options }: { options: OpeningImportOptions }) {
  const router = useRouter();
  const [preview, setPreview] = useState<OpeningImportPreview | null>(null);
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [partnerMap, setPartnerMap] = useState<Record<string, string>>({});
  const [unitId, setUnitId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [format, setFormat] = useState("PRIMATECH_V1");
  const [basis, setBasis] = useState("CLOSING");

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setPreview(null); setConfirmed(false);
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Pregled nije dostupan.");
      const next = result.preview as OpeningImportPreview;
      setPreview(next);
      setAccountMap(Object.fromEntries(next.data.lines.map(l => [l.account, options.accounts.some(a => a.code === l.account) ? l.account : ""])));
      setPartnerMap(Object.fromEntries(next.partnerSuggestions.filter(p => p.partner).map(p => [p.name, p.partner!.id])));
      setUnitId("");
    } catch (e) { setError(e instanceof Error ? e.message : "Pregled nije uspio."); }
    finally { setBusy(false); }
  }

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: preview.token, choices: { accounts: accountMap, partners: partnerMap, unitId, confirmed } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nacrt nije sačuvan.");
      router.push(`/agencija/nalozi/${result.journalId}?poruka=nalog_kreiran`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Uvoz nije uspio."); setBusy(false); }
  }

  const sourceAccounts = preview ? [...new Map(preview.data.lines.map(l => [l.account, l.accountName])).entries()] : [];
  const missingPartners = preview?.data.lines.filter(l => !l.partner && options.accounts.find(a => a.code === accountMap[l.account])?.partnerRequired) ?? [];
  const epsilon = preview?.data.format === "EPSILON_V1";
  const needsBreakdown = epsilon && missingPartners.some(l => !preview.data.epsilon?.expandedAccounts.includes(l.account));
  const canSave = preview && sourceAccounts.every(([code]) => accountMap[code]) &&
    !preview.data.epsilon?.blocked.length && !needsBreakdown &&
    preview.partnerSuggestions.every(p => partnerMap[p.name]) && missingPartners.every(l => partnerMap[`row:${l.row}`]) &&
    (!preview.data.lines.some(l => options.accounts.find(a => a.code === accountMap[l.account])?.unitRequired) || unitId);

  return <>
    <section className="admin-panel">
      <h2>1. Pripremite fajlove</h2>
      <p>Podržani su provjereni Primatech i Epsilon Excel rasporedi. Uvoz prometa tokom godine još nije podržan.</p>
      <p>Izaberite fajlove za <strong>{options.company}</strong>. Prenosi se početno stanje na <strong>01.01.{options.year}.</strong> Pregled fajlova ne mijenja podatke u programu.</p>
      <form onSubmit={inspect} className="admin-form" onChange={() => { setPreview(null); setConfirmed(false); setError(""); }}>
        <input type="hidden" name="companyId" value={options.companyId} /><input type="hidden" name="yearId" value={options.yearId} />
        <label className="form-wide">Iz kojeg programa prenosite podatke?
          <select name="format" value={format} disabled={busy} onChange={e => setFormat(e.target.value)}>
            <option value="PRIMATECH_V1">Primatech — nalog početnog stanja</option>
            <option value="EPSILON_V1">Epsilon — zaključni list i zbirni partneri</option>
          </select>
        </label>
        {format === "PRIMATECH_V1" ? <>
        <label className="form-wide"><span>Nalog početnog stanja na 01.01.{options.year}. — obavezno</span>
          <small>Izvještaj sa rednim brojem, šifrom/nazivom konta, datumom, opisom i kolonama Duguje/Potražuje. Partner je naveden u opisu.</small>
          <input type="file" name="opening" accept=".xls,.xlsx" required disabled={busy} /></label>
        <label className="form-wide"><span>Zbirni dobavljači — preporučeno ako nalog sadrži dobavljače</span>
          <small>Kolone Pib, Naziv i Grad. Koristi se samo za identifikaciju partnera, bez uvoza njegovih iznosa. Može biti iz kasnijeg perioda.</small>
          <input type="file" name="suppliers" accept=".xls,.xlsx" disabled={busy} /></label>
        <label className="form-wide"><span>Zbirni kupci — opciono</span>
          <small>Isti raspored Pib, Naziv i Grad. Bez zbirnog pregleda partnera birate ručno.</small>
          <input type="file" name="customers" accept=".xls,.xlsx" disabled={busy} /></label>
        <label className="form-wide"><span>Zaključni list na 31.12.{options.year - 1}. — opciona kontrola</span>
          <small>Kolone Oznaka, Naziv i završni Saldo. Ne knjiži se ponovo. Potvrdite da izvještaj pripada istoj firmi i prethodnoj godini.</small>
          <input type="file" name="closing" accept=".xls,.xlsx" disabled={busy} /></label>
        </> : <>
          <label className="form-wide">Koje stanje prenosite?
            <select name="basis" value={basis} disabled={busy} onChange={e => setBasis(e.target.value)}>
              <option value="CLOSING">Završni SALDO prethodne godine (kolone I/J) → početno stanje {options.year}.</option>
              <option value="OPENING">POČETNO STANJE iste godine (kolone C/D) → početno stanje {options.year}.</option>
            </select>
          </label>
          <label>Datum izvještaja<input key={basis} type="date" name="reportDate" required disabled={busy} defaultValue={basis === "CLOSING" ? `${options.year - 1}-12-31` : `${options.year}-01-01`} /></label>
          <p className="form-wide">Epsilon fajlovi nemaju naziv firme ni datum. Provjerite ih u Epsilonu prije izvoza. Svi izvještaji moraju pripadati istoj firmi i istom presjeku. Tekući i ukupan promet se ne prenose.</p>
          <label className="form-wide"><span>Epsilon zaključni list — obavezno</span><small>Prva kolona KONTO, zatim NAZIV KONTA; grupe POČETNO STANJE, TEKUĆI PROMET, UKUPAN PROMET i SALDO. Zbirni redovi i ručno izmijenjene kolone nijesu podržani.</small>
            <input key="epsilon-ledger" type="file" name="ledger" accept=".xls,.xlsx" required disabled={busy} /></label>
          <label className="form-wide"><span>Zbirni dobavljači — obavezno kada konto dobavljača ima saldo</span><small>Kolone I.D., NAZIV-GRAD i iste grupe iznosa. I.D. je interna šifra, nije PIB. Prenose se samo nenulta salda partnera; zbirni saldo konta se zamjenjuje razradom.</small>
            <input key="epsilon-suppliers" type="file" name="suppliers" accept=".xls,.xlsx" disabled={busy} /></label>
          <label>Konto dobavljača u Epsilonu<input name="supplierAccount" defaultValue="4330" pattern="[0-9]{4,12}" disabled={busy} /></label>
          <label className="form-wide"><span>Zbirni kupci — obavezno kada konto kupaca ima saldo</span><small>Isti Epsilon raspored I.D., NAZIV-GRAD. Ako nedostaje potrebna razrada, pregled je moguć, ali čuvanje je blokirano.</small>
            <input key="epsilon-customers" type="file" name="customers" accept=".xls,.xlsx" disabled={busy} /></label>
          <label>Konto kupaca u Epsilonu<input name="customerAccount" defaultValue="2020" pattern="[0-9]{4,12}" disabled={busy} /></label>
          <label className="form-wide"><input type="checkbox" name="sourceConfirmed" required disabled={busy} /> Potvrđujem da svi Epsilon izvještaji pripadaju firmi {options.company} i izabranom datumu.</label>
        </>}
        <p className="form-wide">Excel .xls/.xlsx, do 5 MB po fajlu i 10 MB ukupno; do 1.000 stavki naloga. Analitika prometa dobavljača nije potrebna za ovaj uvoz.</p>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Obrada…" : "Pregledaj fajlove"}</button>
      </form>
    </section>
    {error && !preview ? <p className="admin-message" role="alert">{error}</p> : null}
    {preview ? <form onSubmit={commit} className="admin-stack">
      <section className="admin-panel">
        <h2>2. Provjerite podatke i povežite konta</h2>
        <p>Izvor: <strong>{preview.data.company}</strong> · {preview.data.date} · nalog {preview.data.number} · {preview.data.lines.length} stavki</p>
        <p>Cilj: <strong>{options.company} / {options.year}</strong>. Pregled važi 30 minuta.</p>
        <p>Duguje <strong>{money(preview.totals.debit)} €</strong> · Potražuje <strong>{money(preview.totals.credit)} €</strong> · Razlika <strong>{money(preview.totals.difference)} €</strong></p>
        {preview.warnings.map(w => <p key={w}>{w}</p>)}
        <p>Ista šifra je samo predlog. Provjerite naziv i namjenu svakog ciljnog konta. Nedostajući konto prvo dodajte kroz kontni plan pa ponovite pregled.</p>
        <div className="table-wrap"><table className="admin-table"><thead><tr><th>Izvorno konto</th><th>Naš konto</th></tr></thead><tbody>
          {sourceAccounts.map(([code, name]) => <tr key={code}><td>{code} · {name}</td><td><AccountSearchSelect name={`account-${code}`} required disabled={busy} value={accountMap[code] ?? ""} onChange={e => { setAccountMap(p => ({ ...p, [code]: e.target.value })); setConfirmed(false); }}>
            <option value="">Izaberite konto</option>{options.accounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}{a.partnerRequired ? " (partner obavezan)" : ""}</option>)}
          </AccountSearchSelect></td></tr>)}
        </tbody></table></div>
        {options.units.length ? <label>Poslovna jedinica za cijeli nalog<select value={unitId} disabled={busy} onChange={e => { setUnitId(e.target.value); setConfirmed(false); }}><option value="">Bez poslovne jedinice</option>{options.units.map(u => <option key={u.id} value={u.id}>{u.sifra} · {u.naziv}</option>)}</select></label> : null}
      </section>
      <section className="admin-panel"><h2>3. Povežite partnere</h2>
        <p>{epsilon ? "Epsilon I.D. i naziv su prikazani zajedno. I.D. nije PIB: izaberite stvarnog partnera kroz pretragu. Isti naziv sa različitim I.D. ostaje odvojen dok ne provjerite identitet." : "Automatski predlog postoji samo za jedan dostupan pogodak po PIB-u. Više pogodaka, nedostajući PIB i različiti nazivi traže ručni izbor."} Za novog partnera koristite pretragu i brzi unos.</p>
        {preview.partnerSuggestions.map(p => <div className="admin-form-section" key={p.name}>
          <p><strong>{p.name}</strong> · {p.pib ? `PIB ${p.pib}` : epsilon ? "Epsilon šifra · ručno povezivanje" : "PIB nije jednoznačno pronađen"}{p.ambiguous ? " · Potrebna provjera više pogodaka" : ""}</p>
          <PartnerSearchInput name={`partner-${p.name}`} initialPartner={p.partner} required disabled={busy} onPartnerChange={partner => { setPartnerMap(m => ({ ...m, [p.name]: partner?.id ?? "" })); setConfirmed(false); }} />
        </div>)}
        {missingPartners.map(l => epsilon ? <p role="alert" key={l.row}>Konto {l.account} zahtijeva izvorni zbirni pregled po partnerima. Dodajte odgovarajući fajl i ponovite pregled; zbirni saldo se ne dodjeljuje proizvoljnom partneru.</p> : <div key={l.row}><p>Stavka {l.row}, konto {l.account}: partner nije naveden u fajlu.</p><PartnerSearchInput name={`row-${l.row}`} required disabled={busy} onPartnerChange={p => { setPartnerMap(m => ({ ...m, [`row:${l.row}`]: p?.id ?? "" })); setConfirmed(false); }} /></div>)}
        {!preview.partnerSuggestions.length && !missingPartners.length ? <p>Nema partnera za povezivanje.</p> : null}
      </section>
      <section className="admin-panel"><h2>4. Pregled stavki</h2>
        <div className="table-wrap"><table className="admin-table"><thead><tr><th>R. br.</th><th>Izvorno → ciljno konto</th><th>Opis / izvorni partner</th><th>Duguje</th><th>Potražuje</th></tr></thead><tbody>
          {preview.data.lines.map(l => <tr key={l.row}><td>{l.row}</td><td>{l.account} → {accountMap[l.account] || "Nije povezano"}</td><td style={{ whiteSpace: "pre-line" }}>{l.description}</td><td>{money(l.debit)}</td><td>{money(l.credit)}</td></tr>)}
        </tbody></table></div>
        {preview.data.epsilon?.controls.length ? <><h3>Kontrola razrade partnera</h3><div className="table-wrap"><table><thead><tr><th>Konto</th><th>Saldo konta D−P</th><th>Zbir partnera D−P</th><th>Razlika</th></tr></thead><tbody>{preview.data.epsilon.controls.map(r => <tr key={r.account}><td>{r.account}</td><td>{money(r.expected)}</td><td>{money(r.actual)}</td><td>{money(r.actual - r.expected)}</td></tr>)}</tbody></table></div></> : null}
        {preview.data.closing.length ? <><h3>{epsilon ? "Kontrola prenosa po izvornim kontima" : "Razlike prema zaključnom listu — izvorne šifre"}</h3>{preview.comparison.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Konto</th><th>Izvorni saldo D−P</th><th>Početni saldo D−P</th><th>Razlika</th></tr></thead><tbody>{preview.comparison.map(r => <tr key={r.account}><td>{r.account}</td><td>{money(r.closing)}</td><td>{money(r.opening)}</td><td>{money(r.opening - r.closing)}</td></tr>)}</tbody></table></div> : <p>Salda se poklapaju po izvornim šiframa konta, nakon zaokruživanja na cente.</p>}</> : null}
      </section>
      <section className="admin-panel"><h2>5. Sačuvajte nacrt</h2>
        {error ? <p className="admin-message" role="alert">{error}</p> : null}
        <label><input type="checkbox" checked={confirmed} disabled={busy} required onChange={e => setConfirmed(e.target.checked)} /> Provjerio/la sam firmu, datum, stavke, povezivanje konta i partnera i prikazana upozorenja. Sačuvaj izvorne iznose kao nacrt.</label>
        {!canSave ? <p role="status">Povežite sva konta i partnere i izaberite obaveznu poslovnu jedinicu.</p> : null}
        <p>Nacrt ne ulazi u bruto bilans. Knjiženje se potvrđuje zasebno na nalogu, nakon ispravki i provjere ravnoteže.</p>
        <button type="submit" className="primary-button" disabled={busy || !confirmed || !canSave}>{busy ? "Obrada…" : "Uvezi kao nacrt početnog stanja"}</button>
      </section>
    </form> : null}
  </>;
}
