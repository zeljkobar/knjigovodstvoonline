"use client";

import { useState, type FormEvent } from "react";

type Props = { firmaId: string; godinaId: string; defaults: Record<string, string> };
const fields = [
  ["SjedisteObveznika", "Sjedište obveznika", "text", true],
  ["SifraDjelatnosti", "Šifra djelatnosti", "text", true],
  ["MaticniBroj", "Identifikator obveznika (XML: MaticniBroj)", "text", true],
  ["LiceKojeSastavljaIskaz_Naziv", "Lice koje sastavlja iskaz — naziv", "text", false],
  ["LiceKojeSastavljaIskaz_JMBG", "JMBG sastavljača (opciono)", "text", false],
  ["LiceKojeSastavljaIskaz_Email", "E-mail sastavljača (opciono)", "email", false],
  ["OdgovornoLice_Ime", "Ime odgovornog lica (opciono)", "text", false],
  ["OdgovornoLice_Prezime", "Prezime odgovornog lica (opciono)", "text", false],
  ["OdgovornoLice_JMBG", "JMBG odgovornog lica (opciono)", "text", false],
  ["FinansijskiIzvestajSastavljenNaDan", "Datum sastavljanja", "date", true],
  ["FinansijskiIzvestajPodnesenNaDan", "Datum podnošenja (opciono)", "date", false]
] as const;

export default function ExportForm({ firmaId, godinaId, defaults }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const body = new FormData(event.currentTarget);
    try {
      const response = await fetch("/agencija/zavrsni-racun/xml/preuzmi", {
        method: "POST", headers: { "X-Financial-XML": "1" }, body
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/xml")) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Sesija je istekla ili izvoz nije dostupan. Osvježite ekran.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "FinansijskiIskazi.xml";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage("XML je pripremljen za preuzimanje. Nije poslat Poreskoj upravi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Izvoz nije uspio.");
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="final-xml-form">
    <input type="hidden" name="firmaId" value={firmaId} />
    <input type="hidden" name="godinaId" value={godinaId} />
    <fieldset disabled={busy} className="final-xml-fields">
      <legend>Zaglavlje XML-a</legend>
      <div className="final-xml-grid">
        {fields.map(([name, label, type, required]) => <label key={name}>
          <span>{label}</span>
          <input name={name} type={type} required={required} defaultValue={defaults[name] ?? ""}
            maxLength={name.includes("JMBG") ? 13 : 500} pattern={name.includes("JMBG") ? "[0-9]{13}" : undefined} />
        </label>)}
      </div>
      <p className="muted">Provjerite identifikator prema prijavi na portalu. U XML polju MaticniBroj predložen je PIB firme; po potrebi ga ispravite prema zahtjevu portala. Podaci ovog zaglavlja koriste se samo za ovo preuzimanje i ne mijenjaju karticu firme.</p>
      <label className="final-xml-confirm">
        <input type="checkbox" name="potvrda" required />
        <span>Provjerio/la sam obrasce i zaglavlje. Tokovi gotovine, obrazac 3a, promjene kapitala i obračun amortizacije nijesu obuhvaćeni ovim iskazom i izvoze se sa svim iznosima 0.</span>
      </label>
      <button type="submit" className="primary-button">{busy ? "Pripremam XML…" : "Preuzmi XML"}</button>
    </fieldset>
    {message && <p role="status" className="admin-message">{message}</p>}
  </form>;
}
