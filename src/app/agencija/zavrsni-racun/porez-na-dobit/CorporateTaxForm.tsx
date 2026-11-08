"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { calculateCorporateTax, corporateTaxFields, editableTaxKeys, lossKeys, parseCorporateTaxInput, taxDecimal } from "@/lib/corporate-tax";
import type { CorporateTaxData } from "@/lib/corporate-tax-service";
import { taxAccountFields } from "@/lib/corporate-tax-accounts";

const endpoint = "/agencija/zavrsni-racun/porez-na-dobit/podaci";
const sections = [
  { title: "A. Poslovna dobit i gubici", min: 1, max: 41 },
  { title: "B. Kapitalni dobici i gubici", min: 42, max: 47 },
  { title: "C. Poreska osnovica i obračun poreza", min: 48, max: 52 },
  { title: "D. Umanjenja i poreska obaveza", min: 53, max: 59 }
];
const money = (cents: number) => (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CorporateTaxForm({ data }: { data: CorporateTaxData }) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(editableTaxKeys.map(k => [k, data.inputs[k] ? taxDecimal(data.inputs[k]) : ""])));
  const [amended, setAmended] = useState(data.amended);
  const [revision, setRevision] = useState(data.revision);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const canSave = data.canSave && (revision === 0 || data.canUpdate);
  let calculated: Record<string, number> | null = null, calculationError = "";
  try { calculated = calculateCorporateTax(parseCorporateTaxInput(fields)); }
  catch (e) { calculationError = e instanceof Error ? e.message : "Provjerite iznose."; }
  function change(key: string, value: string) {
    setFields(previous => ({ ...previous, [key]: value })); setDirty(true); setMessage(""); setError("");
  }
  async function send(intent: "save" | "export") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-corporate-tax": "1" },
        body: JSON.stringify({ intent, companyId: data.companyId, yearId: data.yearId, revision, ...(intent === "save" ? { fields, amended } : {}) }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error ?? "Obrada nije uspjela."); }
      if (intent === "save") {
        const result = await response.json(); setRevision(result.revision); setDirty(false); setMessage("Prijava je sačuvana. Knjiženja i podnošenje prijave potvrđuju se odvojeno.");
      } else {
        const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
        link.href = url; link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `PD_${data.year}.xml`;
        link.click(); URL.revokeObjectURL(url); setMessage("XML je preuzet iz sačuvane prijave.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Obrada nije uspjela."); }
    finally { setBusy(false); }
  }
  function nextInput(key: string, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const next = editableTaxKeys.slice(editableTaxKeys.indexOf(key) + 1)
      .map(k => inputRefs.current[k]).find(element => element && !element.disabled);
    next?.focus();
    next?.select();
  }
  const input = (key: string, label: string) => <input ref={element => { inputRefs.current[key] = element; }} id={`tax-${key}`} aria-label={label} type="text" inputMode="decimal" value={fields[key] ?? ""} disabled={!canSave || busy} onChange={e => change(key, e.target.value)} onKeyDown={e => nextInput(key, e)} />;

  return <>
    <section className="admin-panel">
      <h2>Prijava PD sa dodacima PG1 i PG2</h2>
      {data.accountPrefill.details.length ? <div>
        <p>Preuzimanje sa podešenih konta · verzija podešavanja {data.accountPrefill.revision}. Prihodi klase 6: <strong>{money(data.accountPrefill.revenueCents)} €</strong>.</p>
        <details><summary>Pregled iznosa sa konta</summary><ul>{data.accountPrefill.details.map(row => <li key={row.key}>
          {taxAccountFields.find(field => field.key === row.key)!.label}: <strong>{money(row.amount)} €</strong>
          {row.limit !== null ? ` (trošak ${money(row.expense)} € − limit ${money(row.limit)} €; najmanje nula)` : null}
        </li>)}</ul></details>
        <button type="button" className="secondary-button" disabled={!canSave || busy} onClick={() => {
          setFields(previous => ({ ...previous, ...Object.fromEntries(Object.entries(data.accountPrefill.inputs).map(([key, cents]) => [key, taxDecimal(cents)])) }));
          setDirty(true); setMessage(""); setError("");
        }}>Preuzmi iz podešenih konta</button>
        <p>Preuzimanje mijenja samo podešene pozicije. Nakon preuzimanja sačuvajte prijavu.</p>
      </div> : null}
      <p>Poreski period: <strong>{data.dateFrom} — {data.dateTo}</strong>. Iznosi su u eurima; unosite najviše dvije decimale bez razdvajanja hiljada.</p>
      <p>Dobit ili gubitak nove prijave preuzima se iz bilansa uspjeha za izabranu firmu i godinu, iz reda 244 — rezultat prije oporezivanja, sa sačuvanim korekcijama bilansa. Ostale poreske korekcije unesite ručno. Kapitalni iznosi 42/43 su poreski iznosi i mogu se razlikovati od računovodstvenih 3/4.</p>
      {data.statementResult ? <>
        <p>Bilans uspjeha, AOP 244: <strong>{data.statementResult.x02 ? `gubitak ${money(data.statementResult.x02)}` : `dobit ${money(data.statementResult.x01)}`} €</strong>. Sačuvana prijava zadržava svoje iznose; preuzimanje zamjenjuje samo redove 1 i 2.</p>
        <button type="button" className="secondary-button" disabled={!canSave || busy} onClick={() => {
          setFields(previous => ({ ...previous, x01: taxDecimal(data.statementResult!.x01), x02: taxDecimal(data.statementResult!.x02) }));
          setDirty(true); setMessage(""); setError("");
        }}>Preuzmi dobit/gubitak iz bilansa</button>
      </> : <p role="status">Bilans uspjeha nema red AOP 244. Dobit ili gubitak unesite ručno.</p>}
      <p>Red 5 — računovodstvena amortizacija iz bilansa uspjeha, AOP 210a: <strong>{data.accountingDepreciation === null ? "nije dostupna za automatsko preuzimanje" : `${money(data.accountingDepreciation)} €`}</strong>.</p>
      <p>Red 6 — poreska amortizacija: <strong>{data.taxDepreciation === null ? "nije dostupna za automatsko preuzimanje" : `${money(data.taxDepreciation)} €`}</strong>.
        {data.taxDepreciationStatus === "confirmed" ? ` Potvrđen OA obračun, revizija ${data.taxDepreciationRevision}; uključuje amortizaciju tekuće godine i poseban otpis salda grupa.`
          : data.taxDepreciationStatus === "forbidden" ? " Za preuzimanje je potrebno pravo pregleda osnovnih sredstava. Iznos možete unijeti ručno."
          : data.taxDepreciationStatus === "missing" ? " Nema potvrđenog poreskog obračuna za ovu godinu. Potvrdite obračun u Osnovnim sredstvima ili unesite provjeren iznos ručno."
          : " Potvrđeni obračun nema ispravan rezultat za ovaj period. Provjerite obračun ili unesite iznos ručno."}</p>
      <p>Nove prijave automatski preuzimaju dostupne iznose amortizacije. Na postojećoj prijavi dugme zamjenjuje samo dostupna polja 5/6; ostala polja ostaju sačuvana.</p>
      <button type="button" className="secondary-button" disabled={!canSave || busy || Object.keys(data.depreciationInputs).length === 0} onClick={() => {
        setFields(previous => ({ ...previous, ...Object.fromEntries(Object.entries(data.depreciationInputs).map(([key, cents]) => [key, taxDecimal(cents)])) }));
        setDirty(true); setMessage(""); setError("");
      }}>Preuzmi amortizaciju u polja 5 i 6</button>
      <label><input type="checkbox" checked={amended} disabled={!canSave || busy} onChange={e => { setAmended(e.target.checked); setDirty(true); setMessage(""); }} /> Izmijenjena prijava</label>
      <p className="muted">XML prenosi iznose i period u PD/PG1/PG2 formatu. Vrstu prijave i podatke obveznika potvrdite na poreskom portalu. Preuzimanje ne podnosi prijavu.</p>
      {data.locked ? <p role="status">Godina je zaključana. Dostupni su pregled i izvoz sačuvane prijave.</p> : !canSave ? <p role="status">Nemate pravo čuvanja ove prijave.</p> : null}
    </section>
    <div className="admin-panel tax-actions">
      <div><strong>Ukupna poreska obaveza: {calculated ? `${money(calculated.x59)} €` : "provjerite unos"}</strong><p>{dirty ? "Postoje nesačuvane izmjene." : revision ? `Sačuvana verzija ${revision}.` : "Prijava još nije sačuvana."}</p></div>
      <button type="button" className="primary-button" disabled={busy || !canSave || Boolean(calculationError)} onClick={() => send("save")}>Sačuvaj prijavu</button>
      <button type="button" className="secondary-button" disabled={busy || !data.canExport || dirty || revision === 0 || Boolean(calculationError)} onClick={() => send("export")}>Preuzmi XML</button>
      {calculationError || error ? <p className="form-wide" role="alert">{error || calculationError}</p> : null}
      {message ? <p className="form-wide" role="status">{message}</p> : null}
    </div>
    {sections.map(section => <section className="admin-panel" key={section.title}><h2>{section.title}</h2>
      <div className="table-wrap"><table className="tax-table"><thead><tr><th>Red i opis</th><th>Iznos EUR</th></tr></thead><tbody>
        {corporateTaxFields.filter(f => { const n = Number(f.key.match(/\d+/)![0]); return n >= section.min && n <= section.max; }).map(f => <tr key={f.key} className={f.computed ? "tax-computed" : ""}>
          <td><label htmlFor={`tax-${f.key}`}>{f.label}</label>{f.computed ? <small>Automatski obračun</small> : null}</td>
          <td>{f.computed ? <output id={`tax-${f.key}`}>{calculated ? money(calculated[f.key]) : "—"}</output> : input(f.key, f.label)}</td>
        </tr>)}
      </tbody></table></div>
    </section>)}
    {["pg1", "pg2"].map((group, index) => <section className="admin-panel" key={group}>
      <h2>{index === 0 ? "Dodatak PG1 — prenos poslovnih gubitaka" : "Dodatak PG2 — prenos kapitalnih gubitaka"}</h2>
      <p>Unesite preostale raspoložive poreske gubitke prethodnih pet godina, bez već iskorišćenih iznosa. Pokriće je ograničeno na dobit iz reda {index === 0 ? "38" : "44"}.</p>
      <div className="table-wrap"><table className="tax-table"><thead><tr><th>Godina / opis</th><th>Iznos EUR</th></tr></thead><tbody>
        {lossKeys.slice(index * 5, index * 5 + 5).map((key, offset) => <tr key={key}><td><label htmlFor={`tax-${key}`}>{data.year - offset - 1}. godina</label></td><td>{input(key, `${group.toUpperCase()} gubitak ${data.year - offset - 1}`)}</td></tr>)}
        {[{ key: `${group}_1`, label: "Dobit za pokriće" }, { key: `${group}_2`, label: "Ukupno raspoloživi gubici" }, { key: `${group}_3`, label: "Iznos gubitka za pokriće" }].map(f => <tr className="tax-computed" key={f.key}><td>{f.label}</td><td><output>{calculated ? money(calculated[f.key]) : "—"}</output></td></tr>)}
      </tbody></table></div>
    </section>)}
    <p className="muted">XML treba potvrditi probnim uvozom na poreski portal prije korišćenja za predaju.</p>
  </>;
}
