"use client";

import { useState } from "react";

export type QuickItemResult = {
  id: string;
  sifra: string;
  naziv: string;
  unitCode: string;
  vatPercent: string;
  saleGrossPrice: string;
  service?: boolean;
};

type Option = {
  id: string;
  label: string;
};

type QuickItemCreateModalProps = {
  groups: Option[];
  units: Option[];
  vatRates: Option[];
  onClose: () => void;
  onCreated: (item: QuickItemResult) => void;
  endpoint?: string;
};

export function QuickItemCreateModal({
  groups,
  units,
  vatRates,
  onClose,
  onCreated,
  endpoint = "/api/inventory/items/quick-create"
}: QuickItemCreateModalProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [groupId, setGroupId] = useState("");
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [vatRateId, setVatRateId] = useState(vatRates[0]?.id ?? "");
  const [saleGrossPrice, setSaleGrossPrice] = useState("");
  const [service, setService] = useState(false);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!name.trim() || !unitId || !vatRateId || !saleGrossPrice.trim()) {
      setStatus("Naziv, jedinica mjere, PDV stopa i prodajna cijena su obavezni.");
      return;
    }

    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode,
          code,
          groupId,
          name,
          saleGrossPrice,
          service,
          unitId,
          vatRateId
        })
      });
      const data = (await response.json()) as {
        item?: QuickItemResult;
        message?: string;
      };
      if (!response.ok || !data.item) {
        setStatus(data.message ?? "Artikal nije sačuvan.");
        return;
      }
      onCreated(data.item);
    } catch {
      setStatus("Greška pri čuvanju artikla.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div aria-modal="true" className="quick-partner-modal" role="dialog">
      <div className="quick-partner-panel">
        <div className="panel-header">
          <div>
            <h3>Novi artikal / usluga</h3>
            <p>Novi zapis će odmah biti dostupan i izabran u dokumentu.</p>
          </div>
          <button type="button" onClick={onClose}>Zatvori</button>
        </div>
        <div className="quick-partner-form">
          <label>
            <span>Naziv *</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>Šifra</span>
            <input
              value={code}
              placeholder="Automatska ako je prazno"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label>
            <span>Barkod</span>
            <input value={barcode} onChange={(event) => setBarcode(event.target.value)} />
          </label>
          <label>
            <span>Grupa</span>
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">Bez grupe</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
            </select>
          </label>
          <label>
            <span>Jedinica mjere *</span>
            <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
            </select>
          </label>
          <label>
            <span>PDV stopa *</span>
            <select value={vatRateId} onChange={(event) => setVatRateId(event.target.value)}>
              {vatRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}
            </select>
          </label>
          <label>
            <span>Prodajna cijena sa PDV *</span>
            <input
              inputMode="decimal"
              value={saleGrossPrice}
              onChange={(event) => setSaleGrossPrice(event.target.value)}
            />
          </label>
          <label className="checkbox-card">
            <input checked={service} type="checkbox" onChange={(event) => setService(event.target.checked)} />
            <span>Usluga — ne prati zalihe i ne zahtijeva magacin</span>
          </label>
        </div>
        {status ? <p className="partner-search-status">{status}</p> : null}
        <div className="company-form-actions">
          <button disabled={isSaving} type="button" onClick={onClose}>Odustani</button>
          <button disabled={isSaving} type="button" onClick={() => void submit()}>
            {isSaving ? "Čuvam..." : service ? "Sačuvaj uslugu" : "Sačuvaj artikal"}
          </button>
        </div>
      </div>
    </div>
  );
}
