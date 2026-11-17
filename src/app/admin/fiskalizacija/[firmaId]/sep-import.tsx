"use client";

import { useEffect, useState } from "react";
import { SUMMA_FISCAL_SOFTWARE } from "@/lib/fiscal-setup";
import type { SepFiscalResults, SepFiscalSnapshot } from "@/lib/sep-fiscal-setup";
import { importFiscalSetupFromSep } from "./sep-actions";
import styles from "./setup.module.css";

const maxAge = 20 * 60 * 1000;
const environments = [["test", "Testni SEP"], ["production", "Produkcioni SEP"]] as const;

function readSaved(storageKey: string): SepFiscalResults | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { expires: number; data: SepFiscalResults } | null;
    if (saved && Date.now() < saved.expires) return saved.data;
    sessionStorage.removeItem(storageKey);
  } catch { /* Manual setup remains available if browser storage is disabled. */ }
  return null;
}

export function SepSetupImport({ firmaId, storageKey, hasFiscalProfile }: { firmaId: string; storageKey: string; hasFiscalProfile: boolean }) {
  const [results, setResults] = useState<SepFiscalResults | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState<{ ok: boolean; message: string }>();
  useEffect(() => setResults(readSaved(storageKey)), [storageKey]);

  return <section className="admin-panel" aria-label="Preuzimanje podataka iz SEP-a">
    <form className="admin-form" method="post" encType="multipart/form-data" onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      const form = event.currentTarget;
      const data = new FormData(form);
      const file = data.get("certificate");
      if (!(file instanceof File) || file.size > 512 * 1024) {
        setError("Izaberi PFX/P12 fajl do 512 KB.");
        return;
      }
      form.reset();
      setPending(true); setError(""); setResults(null); setSigning(undefined);
      try {
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
        const result = await importFiscalSetupFromSep(firmaId, data);
        if ("error" in result) { setError(result.error); return; }
        setResults(result.results);
        setSigning(result.signing);
        try { sessionStorage.setItem(storageKey, JSON.stringify({ expires: Date.now() + maxAge, data: result.results })); }
        catch { setError("Pregled je dostupan na ovoj stranici. Preglednik nije dozvolio da se prijedlozi prenesu u naredne korake."); }
      } catch { setError("Preuzimanje nije završeno. Pokušajte ponovo ili unesite podatke ručno."); }
      finally { data.delete("certificate"); data.delete("password"); setPending(false); }
    }}>
      <label><span>Sertifikat klijenta (PFX/P12, do 512 KB)</span><input type="file" name="certificate" accept=".pfx,.p12" required disabled={pending} /></label>
      <label><span>Lozinka sertifikata</span><input type="password" name="password" autoComplete="new-password" required disabled={pending} maxLength={1024} /></label>
      <div className={styles.sepSigning}>
        <label><input type="checkbox" name="save_for_signing" disabled={pending} /> Sačuvaj isti sertifikat za potpisivanje računa</label>
        <small>{hasFiscalProfile ? "Ako firma još nema aktivan sertifikat, čuva se u šifrovanom trezoru i aktivira se u koraku „Sertifikat“."
          : "Ova opcija kreira i početni testni profil, koristeći podatke firme iz aplikacije i testne kodove softvera Summa Fiscal. Sertifikat se aktivira kasnije."}</small>
      </div>
      <button type="submit" disabled={pending}>{pending ? "Preuzimanje je u toku…" : "Preuzmi iz testnog i produkcionog SEP-a"}</button>
    </form>
    <p>Koristi sertifikat kojim klijent na oba SEP portala bira „Nastavi kao korisnik“. PIB ne unosiš. Ako ne označiš čuvanje za potpisivanje, fajl i lozinka služe samo za prijavu.</p>
    {error ? <p role="alert" className="status-banner error">{error}</p> : null}
    {pending ? <p role="status">Čitam podatke iz oba okruženja…</p> : null}
    {results ? <div className={styles.sepResults} aria-live="polite">
      {environments.map(([key, title]) => {
        const result = results[key];
        return <div key={key}>
          <h4>{title}</h4>
          {"error" in result ? <p>{result.error}</p> : <SepResultOverview data={result.data} softwareCode={SUMMA_FISCAL_SOFTWARE[key].softwareCode} />}
        </div>;
      })}
      {signing ? <p role={signing.ok ? "status" : "alert"}>{signing.message}</p> : null}
      <p>U narednim koracima klikni <strong>Popuni iz SEP-a</strong>, provjeri predložena polja i sačuvaj ih.</p>
    </div> : null}
  </section>;
}

function SepResultOverview({ data, softwareCode }: { data: SepFiscalSnapshot; softwareCode: string }) {
  const hasOtherVersion = data.devices.some(device => device.software.code && device.software.code !== softwareCode);
  return <>
    <p>{[data.identity.name, data.identity.address, data.identity.town].filter(Boolean).join(" · ")}</p>
    <p>Poslovne jedinice: {data.units.length} · ENU za Summa Fiscal: {data.devices.length} · Operateri: {data.operators.length}</p>
    {hasOtherVersion ? <p>Neki ENU uređaji koriste drugu verziju Summa Fiscal. Prije povezivanja provjeri da izabrani ENU odgovara kodu softvera u profilu.</p> : null}
    {data.warnings.length ? <ul>{data.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
  </>;
}

type Section = "firma" | "novi-profil" | "jedinica" | "enu" | "operater" | "produkcioni-profil" | "produkcioni-enu";
type Fields = Record<string, string | boolean | undefined>;
type Choice = { key: string; title: string; fields: Fields };
export function SepPrefill({ storageKey, section, units, unitCode }: {
  storageKey: string; section: Section; units?: { id: string; code: string }[]; unitCode?: string;
}) {
  const [saved, setSaved] = useState<SepFiscalResults | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  useEffect(() => setSaved(readSaved(storageKey)), [storageKey]);
  const test = saved?.test && "data" in saved.test ? saved.test.data : undefined;
  const production = saved?.production && "data" in saved.production ? saved.production.data : undefined;
  const data = section === "firma" ? production ?? test : section.startsWith("produkcioni") ? production : test;
  if (!data && !(section === "novi-profil" && production)) return null;

  const groups: { label: string; options: Choice[] }[] = [];
  const unitOptions = (production: boolean): Choice[] => (data?.units ?? []).map(unit => ({
    key: unit.code, title: `${unit.name} · ${unit.code}`, fields: production
      ? { business_unit_code: unit.code, business_unit_name: unit.name, business_unit_address: unit.address, business_unit_town: unit.town }
      : { code: unit.code, name: unit.name, address: unit.address, town: unit.town },
  }));
  const operatorOptions = (production: boolean): Choice[] => (data?.operators ?? []).map(operator => ({
    key: operator.code, title: [operator.firstName, operator.lastName, operator.code].filter(Boolean).join(" "),
    fields: production ? { operator_code: operator.code, operator_first_name: operator.firstName, operator_last_name: operator.lastName }
      : { operator_code: operator.code, first_name: operator.firstName, last_name: operator.lastName },
  }));
  const selected = (label: string, options: Choice[]) => options.find(option => option.key === choice[label]) ?? (options.length === 1 ? options[0] : undefined);

  if (section === "jedinica" || section === "produkcioni-profil") {
    groups.push({ label: "Poslovna jedinica", options: unitOptions(section === "produkcioni-profil") });
  }
  if (section === "operater" || section === "produkcioni-profil") {
    groups.push({ label: "Operater", options: operatorOptions(section === "produkcioni-profil") });
  }
  if (section === "enu" || section === "produkcioni-enu") {
    groups.push({ label: "ENU", options: (data?.devices ?? []).flatMap(device => {
      const matchingId = units?.find(unit => unit.code === device.unitCode)?.id;
      if (section === "enu" ? !matchingId : device.unitCode !== unitCode) return [];
      return [{ key: device.code, title: [`${device.label} · ${device.code} · jedinica ${device.unitCode}`, device.software.code].filter(Boolean).join(" · "),
        fields: { tcr_code: device.code, internal_code: device.label, ...(matchingId ? { business_unit_id: matchingId } : {}) } }];
    }) });
  }

  const identity = (section === "firma" || section === "novi-profil") ? production?.identity ?? test?.identity : undefined;
  const fields: Fields = {
    legal_name: identity?.name, short_name: identity?.shortName, address: identity?.address,
    town: identity?.town, is_vat_payer: identity?.vat,
    ...Object.assign({}, ...groups.map(group => selected(group.label, group.options)?.fields ?? {})),
  };
  const hasValues = Object.values(fields).some(value => value !== undefined);
  return <div className={styles.sepPrefill}>
    {groups.filter(group => group.options.length > 1).map(group => <label key={group.label}><span>{group.label} iz SEP-a</span>
      <select value={selected(group.label, group.options)?.key ?? ""} onChange={event => {
        const key = event.target.value;
        setChoice(previous => ({ ...previous, [group.label]: key }));
        setNotice("");
      }}>
        <option value="">Izaberi iz SEP-a</option>
        {group.options.map(option => <option key={option.key} value={option.key}>{option.title}</option>)}
      </select>
    </label>)}
    {hasValues ? <button className="table-link" type="button" onClick={event => {
      const form = event.currentTarget.form;
      if (!readSaved(storageKey)) { setSaved(null); return; }
      for (const [name, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        const input = form?.elements.namedItem(name);
        if (input instanceof HTMLInputElement && input.type === "checkbox" && typeof value === "boolean") input.checked = value;
        else if ((input instanceof HTMLInputElement || input instanceof HTMLSelectElement) && typeof value === "string") input.value = value;
      }
      setNotice("Provjeri popunjena polja i sačuvaj ih.");
    }}>Popuni iz SEP-a</button> : <p>{groups.some(group => group.options.length) ? "Izaberi podatke koje želiš prenijeti." : "SEP nema prijedlog za ovaj korak. Unesi podatke ručno."}</p>}
    {notice ? <p role="status">{notice}</p> : null}
  </div>;
}
