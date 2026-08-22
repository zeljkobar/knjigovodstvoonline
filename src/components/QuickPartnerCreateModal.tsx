"use client";

import { useState } from "react";

export type QuickPartnerResult = {
  id: string;
  label: string;
  naziv: string;
  pib: string | null;
  scope: string;
  isForeign?: boolean;
  countryCode?: string | null;
  countryName?: string | null;
  defaultKufAccountCode?: string | null;
  defaultKufVatRateCode?: string | null;
};

type QuickPartnerCreateModalProps = {
  companyOnly?: boolean;
  endpoint?: string;
  initialName: string;
  initialPib?: string;
  onClose: () => void;
  onCreated: (partner: QuickPartnerResult) => void;
};

function normalizePib(value: string) {
  const digits = value.replace(/\D/g, "");

  return digits.length === 7 ? `0${digits}` : digits;
}

export function QuickPartnerCreateModal({
  companyOnly = false,
  endpoint = "/api/partners/quick-create",
  initialName,
  initialPib = "",
  onClose,
  onCreated
}: QuickPartnerCreateModalProps) {
  const [name, setName] = useState(initialName.trim());
  const [pib, setPib] = useState(initialPib);
  const [type, setType] = useState("kupac_dobavljac");
  const [scope, setScope] = useState("AGENCY");
  const [accountNumber, setAccountNumber] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Crna Gora");
  const [isForeign, setIsForeign] = useState(false);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    const cleanName = name.trim();
    const cleanPib = normalizePib(pib);

    if (!cleanName) {
      setStatus("Naziv partnera je obavezan.");
      return;
    }

    if (cleanPib && cleanPib.length !== 8) {
      setStatus("PIB mora imati 8 cifara.");
      return;
    }

    setIsSaving(true);
    setStatus("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          accountNumber,
          city,
          country,
          isForeign,
          name: cleanName,
          pib: cleanPib,
          scope: companyOnly ? "COMPANY" : scope,
          type
        })
      });
      const data = (await response.json()) as {
        message?: string;
        partner?: QuickPartnerResult;
      };

      if (!response.ok || !data.partner) {
        setStatus(data.message ?? "Partner nije sačuvan.");
        return;
      }

      onCreated(data.partner);
    } catch {
      setStatus("Greška pri čuvanju partnera.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div aria-modal="true" className="quick-partner-modal" role="dialog">
      <div className="quick-partner-panel">
        <div className="panel-header">
          <div>
            <h3>Novi partner</h3>
            <p>Partner će biti odmah izabran u polju iz kog je dodat.</p>
          </div>
          <button type="button" onClick={onClose}>
            Zatvori
          </button>
        </div>

        <div className="quick-partner-form">
          <label>
            <span>Naziv</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>PIB</span>
            <input
              inputMode="numeric"
              value={pib}
              onChange={(event) => setPib(event.target.value)}
            />
          </label>
          <label>
            <span>Tip</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="kupac">Kupac</option>
              <option value="dobavljac">Dobavljač</option>
              <option value="kupac_dobavljac">Kupac i dobavljač</option>
              <option value="ostalo">Ostalo</option>
            </select>
          </label>
          {companyOnly ? (
            <label>
              <span>Vidljivost</span>
              <input disabled value="Samo aktivna firma" />
            </label>
          ) : (
            <label>
              <span>Vidljivost</span>
              <select value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="AGENCY">Cijela agencija</option>
                <option value="COMPANY">Samo aktivna firma</option>
              </select>
            </label>
          )}
          <label>
            <span>Žiro račun</span>
            <input
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
            />
          </label>
          <label>
            <span>Grad</span>
            <input value={city} onChange={(event) => setCity(event.target.value)} />
          </label>
          <label>
            <span>Država</span>
            <input value={country} onChange={(event) => setCountry(event.target.value)} />
          </label>
          <label className="quick-partner-checkbox">
            <input
              checked={isForeign}
              type="checkbox"
              onChange={(event) => setIsForeign(event.target.checked)}
            />
            <span>Ino komitent</span>
          </label>
        </div>

        {status ? <p className="partner-search-status">{status}</p> : null}

        <div className="company-form-actions">
          <button disabled={isSaving} type="button" onClick={onClose}>
            Odustani
          </button>
          <button disabled={isSaving} type="button" onClick={() => void submit()}>
            {isSaving ? "Čuvam..." : "Sačuvaj partnera"}
          </button>
        </div>
      </div>
    </div>
  );
}
