"use client";

import { useMemo, useState } from "react";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { createCalculation } from "@/app/agencija/robno/kalkulacije/actions";
import { calculationSaleTypes } from "@/lib/inventory-calculation";

type Option = { id: string; label: string };

type ItemOption = {
  id: string;
  sifra: string;
  naziv: string;
  unitId: string;
  unitCode: string;
  vatRateId: string | null;
  vatPercent: string;
  saleGrossPrice: string;
};

type Partner = {
  id: string;
  label: string;
  naziv: string;
  pib: string | null;
  scope: string;
};

type PreviewRow = {
  sourceLineKey: string;
  externalKey: string;
  id: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceBeforeVat: number;
  unitPriceAfterVat: number;
  rebate: number;
  rebateReducing: boolean;
  priceBeforeVat: number;
  vatRate: number;
  vatAmount: number;
  priceAfterVat: number;
  status: "MAPPED" | "SUGGESTED" | "NEW" | "NEEDS_DECISION" | "NEEDS_UNIT" | "NEEDS_VAT";
  mappedItemId: string | null;
  suggestedItemId: string | null;
  selectedItemId: string | null;
  selectedItemPrice: string;
  unitId: string | null;
  vatRateId: string | null;
  candidateCount: number;
};

type EditablePreviewRow = PreviewRow & {
  resolution: "EXISTING" | "NEW" | "";
  confirmed: boolean;
  saleGrossPrice: string;
  newCode: string;
  newName: string;
  groupId: string;
};

type PreviewResponse = {
  message?: string;
  supplier: Partner | null;
  invoice: {
    seller: { name: string; tin: string };
    identifiers: {
      iic: string;
      fic: string;
      tin: string;
      dateTimeCreated: string;
      qrDateTimeCreated: string;
      qrUrl: string;
    };
    invoiceNumber: string;
    invoiceDate: string;
    totalWithoutVat: number;
    totalVat: number;
    total: number;
    itemCount: number;
  };
  rows: PreviewRow[];
};

type Props = {
  firmaId: string;
  groups: Option[];
  items: ItemOption[];
  units: Option[];
  vatRates: Option[];
  warehouses: Option[];
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function inputNumber(value: number, digits = 4) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function money(value: number) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const statusLabels: Record<PreviewRow["status"], string> = {
  MAPPED: "Povezan",
  SUGGESTED: "Predlog",
  NEW: "Novi artikal",
  NEEDS_DECISION: "Potrebna odluka",
  NEEDS_UNIT: "Nova JM",
  NEEDS_VAT: "Nova PDV stopa"
};

export function MaprCalculationCreateForm({
  firmaId,
  groups,
  items,
  units,
  vatRates,
  warehouses
}: Props) {
  const [qrUrl, setQrUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<EditablePreviewRow[]>([]);
  const [supplier, setSupplier] = useState<Partner | null>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [calculationDate, setCalculationDate] = useState(today());

  const counts = useMemo(
    () => ({
      mapped: rows.filter((row) => row.status === "MAPPED").length,
      suggested: rows.filter((row) => row.status === "SUGGESTED").length,
      newItems: new Set(
        rows.filter((row) => row.resolution === "NEW").map((row) => row.externalKey)
      ).size,
      unresolved: rows.filter(
        (row) =>
          !row.confirmed ||
          !row.resolution ||
          !row.saleGrossPrice.trim() ||
          Number(row.saleGrossPrice.replace(",", ".")) <= 0 ||
          (row.resolution === "EXISTING" && !row.selectedItemId) ||
          (row.resolution === "NEW" && (!row.newName.trim() || !row.unitId || !row.vatRateId))
      ).length
    }),
    [rows]
  );
  const unmappedSourceUnits = useMemo(
    () =>
      [...new Set(
        rows
          .filter((row) => row.resolution === "NEW" && !row.unitId)
          .map((row) => row.unit || "Bez oznake")
      )],
    [rows]
  );

  async function loadPreview() {
    const cleanUrl = qrUrl.trim();
    if (!cleanUrl) {
      setStatus("Unesite fiskalni MAPR link.");
      return;
    }
    setIsLoading(true);
    setStatus("Učitavam račun i stavke sa MAPR portala...");
    setPreview(null);
    setRows([]);

    try {
      const response = await fetch("/api/inventory/calculations/mapr-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrUrl: cleanUrl })
      });
      const data = (await response.json()) as PreviewResponse;
      if (!response.ok || !data.invoice) {
        setStatus(data.message ?? "MAPR račun nije učitan.");
        return;
      }

      const editableRows = data.rows.map<EditablePreviewRow>((row) => ({
        ...row,
        resolution:
          row.selectedItemId
            ? "EXISTING"
            : row.status === "NEEDS_DECISION"
              ? ""
              : "NEW",
        confirmed:
          row.status === "MAPPED" ||
          row.status === "NEW" ||
          row.status === "NEEDS_UNIT" ||
          row.status === "NEEDS_VAT",
        saleGrossPrice: row.selectedItemPrice,
        newCode: "",
        newName: row.name,
        groupId: ""
      }));
      setPreview(data);
      setRows(editableRows);
      setSupplier(data.supplier);
      setInvoiceNumber(data.invoice.invoiceNumber);
      setInvoiceDate(data.invoice.invoiceDate);
      setCalculationDate(data.invoice.invoiceDate);
      setStatus(
        data.supplier
          ? `MAPR račun je učitan. Dobavljač: ${data.supplier.naziv}.`
          : `MAPR račun je učitan, ali dobavljač PIB ${data.invoice.seller.tin} nije pronađen. Dodajte ga dugmetom +.`
      );

      if (!data.supplier) {
        window.setTimeout(() => {
          document.dispatchEvent(
            new CustomEvent("fiscal-supplier-detected", {
              detail: { tin: data.invoice.seller.tin, name: data.invoice.seller.name }
            })
          );
        }, 0);
      }
    } catch {
      setStatus("Greška pri komunikaciji sa serverom.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateRowsByExternalKey(
    rowIndex: number,
    updater: (row: EditablePreviewRow) => EditablePreviewRow
  ) {
    setRows((current) => {
      const externalKey = current[rowIndex].externalKey;
      return current.map((row, index) => {
        if (row.externalKey !== externalKey) return row;
        const updated = updater(row);
        return {
          ...updated,
          saleGrossPrice: index === rowIndex ? updated.saleGrossPrice : row.saleGrossPrice
        };
      });
    });
  }

  function chooseItem(rowIndex: number, value: string) {
    if (value === "__NEW__") {
      updateRowsByExternalKey(rowIndex, (row) => ({
        ...row,
        resolution: "NEW",
        selectedItemId: null,
        confirmed: true,
        saleGrossPrice: row.saleGrossPrice
      }));
      return;
    }

    const item = items.find((candidate) => candidate.id === value);
    if (!item) return;
    updateRowsByExternalKey(rowIndex, (row) => ({
      ...row,
      resolution: "EXISTING",
      selectedItemId: item.id,
      unitId: item.unitId,
      vatRateId: item.vatRateId,
      confirmed: true,
      saleGrossPrice: row.saleGrossPrice || item.saleGrossPrice
    }));
  }

  function updateOne(rowIndex: number, values: Partial<EditablePreviewRow>) {
    setRows((current) =>
      current.map((row, index) => (index === rowIndex ? { ...row, ...values } : row))
    );
  }

  function updateNewItem(rowIndex: number, values: Partial<EditablePreviewRow>) {
    updateRowsByExternalKey(rowIndex, (row) => ({ ...row, ...values }));
  }

  function mapSourceUnit(sourceUnit: string, unitId: string) {
    setRows((current) =>
      current.map((row) =>
        row.resolution === "NEW" &&
        (row.unit || "Bez oznake") === sourceUnit
          ? { ...row, unitId }
          : row
      )
    );
  }

  const payload = preview
    ? JSON.stringify({
        version: 1,
        qrUrl: preview.invoice.identifiers.qrUrl,
        lines: rows.map((row) => ({
          sourceLineKey: row.sourceLineKey,
          externalKey: row.externalKey,
          resolution: row.resolution,
          artikalId: row.selectedItemId,
          saleGrossPrice: row.saleGrossPrice,
          newCode: row.newCode,
          newName: row.newName,
          groupId: row.groupId,
          unitId: row.unitId,
          vatRateId: row.vatRateId
        }))
      })
    : "";
  const canSubmit =
    warehouses.length > 0 &&
    warehouseId &&
    (!qrUrl.trim() || Boolean(preview)) &&
    (!preview || (rows.length > 0 && counts.unresolved === 0));

  return (
    <form action={createCalculation} className="admin-form calculation-header-form">
      <input type="hidden" name="firma_id" value={firmaId} />
      <input type="hidden" name="mapr_import_payload" value={payload} />

      <div className="form-wide calculation-mapr-link">
        <label>
          <span>Fiskalni MAPR link</span>
          <input
            type="url"
            value={qrUrl}
            placeholder="https://mapr.tax.gov.me/ic/#/verify?..."
            onChange={(event) => {
              setQrUrl(event.target.value);
              if (preview) {
                setPreview(null);
                setRows([]);
                setStatus("Link je promijenjen. Ponovo učitajte MAPR račun.");
              }
            }}
          />
        </label>
        <button
          className="secondary-button"
          disabled={isLoading}
          type="button"
          onClick={() => void loadPreview()}
        >
          {isLoading ? "Učitavam..." : "Učitaj kalkulaciju"}
        </button>
      </div>
      {status ? <p className="admin-hint form-wide">{status}</p> : null}

      <PartnerSearchInput
        initialPartner={supplier}
        label="Dobavljač"
        name="dobavljac_id"
        required
      />
      <label>
        <span>Magacin</span>
        <select
          name="magacin_id"
          required
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="" disabled>
            {warehouses.length ? "Izaberite magacin" : "Prvo kreirajte magacin"}
          </option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>{warehouse.label}</option>
          ))}
        </select>
        {warehouses.length === 1 ? <small>Automatski izabran jedini aktivni magacin.</small> : null}
      </label>
      <label>
        <span>Broj računa dobavljača</span>
        <input
          name="broj_racuna_dobavljaca"
          required
          readOnly={Boolean(preview)}
          value={invoiceNumber}
          onChange={(event) => setInvoiceNumber(event.target.value)}
        />
      </label>
      <label>
        <span>Datum računa</span>
        <input
          type="date"
          name="datum_racuna_dobavljaca"
          required
          readOnly={Boolean(preview)}
          value={invoiceDate}
          onChange={(event) => setInvoiceDate(event.target.value)}
        />
      </label>
      <label>
        <span>Datum kalkulacije</span>
        <input
          type="date"
          name="datum_kalkulacije"
          required
          value={calculationDate}
          onChange={(event) => setCalculationDate(event.target.value)}
        />
      </label>
      <label><span>Datum valute</span><input type="date" name="datum_valute" /></label>
      <label>
        <span>Tip prodaje</span>
        <select name="tip_prodaje" defaultValue={calculationSaleTypes.retail}>
          <option value={calculationSaleTypes.retail}>Maloprodaja</option>
          <option value={calculationSaleTypes.wholesale}>Veleprodaja</option>
        </select>
      </label>
      <label className="form-wide"><span>Napomena</span><input name="napomena" /></label>

      {preview ? (
        <div className="form-wide mapr-calculation-preview">
          <div className="panel-header">
            <div>
              <h3>Pregled MAPR stavki</h3>
              <p className="muted-text">
                {preview.invoice.seller.name} · račun {preview.invoice.invoiceNumber}
              </p>
            </div>
            <div className="mapr-preview-header-actions">
              <strong>{money(preview.invoice.total)} EUR</strong>
              <button className="primary-button" disabled={!canSubmit} type="submit">
                Kreiraj nacrt kalkulacije
              </button>
            </div>
          </div>
          <div className="mapr-preview-summary">
            <span>{rows.length} stavki</span>
            <span>{counts.mapped} povezano</span>
            <span>{counts.suggested} predloga</span>
            <span>{counts.newItems} novih artikala</span>
            {counts.unresolved ? (
              <strong className="mapr-preview-unresolved">
                {counts.unresolved} zahtijeva unos
              </strong>
            ) : (
              <strong>Sve spremno</strong>
            )}
          </div>
          <p className="mapr-preview-instructions">
            Za svaki novi artikal provjerite naziv, izaberite jedinicu mjere i
            unesite prodajnu cijenu sa PDV-om. Grupa i ručna šifra nijesu
            obavezne. Kada broj „zahtijeva unos“ bude nula, kreirajte nacrt
            kalkulacije.
          </p>
          {unmappedSourceUnits.length ? (
            <div className="mapr-unit-mapping">
              <strong>Povežite MAPR jedinice mjere</strong>
              <div>
                {unmappedSourceUnits.map((sourceUnit) => (
                  <label key={sourceUnit}>
                    <span>MAPR JM {sourceUnit}</span>
                    <select
                      value=""
                      onChange={(event) =>
                        mapSourceUnit(sourceUnit, event.target.value)
                      }
                    >
                      <option value="">Izaberite našu JM</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="admin-table mapr-preview-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>MAPR stavka</th>
                  <th>Količina / JM</th>
                  <th>Fakturna cijena</th>
                  <th>Rabat / PDV</th>
                  <th>Naš artikal</th>
                  <th>Prodajna cijena sa PDV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.sourceLineKey}>
                    <td>
                      <span className={`mapr-row-status mapr-row-status-${row.status.toLowerCase()}`}>
                        {row.resolution === "NEW" ? "Novi artikal" : statusLabels[row.status]}
                      </span>
                      {row.status === "SUGGESTED" && !row.confirmed ? (
                        <button
                          className="table-action"
                          type="button"
                          onClick={() => updateNewItem(index, { confirmed: true })}
                        >
                          Potvrdi predlog
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <strong>{row.code || "Bez šifre"}</strong>
                      <small className="table-secondary">{row.name}</small>
                    </td>
                    <td className="numeric-cell">
                      {inputNumber(row.quantity, 3)}
                      <small className="table-secondary">{row.unit || "—"}</small>
                    </td>
                    <td className="numeric-cell">
                      {inputNumber(row.unitPriceBeforeVat)}
                      <small className="table-secondary">Osnovica {money(row.priceBeforeVat)}</small>
                    </td>
                    <td className="numeric-cell">
                      {inputNumber(row.rebate, 2)}%
                      <small className="table-secondary">PDV {inputNumber(row.vatRate, 2)}%</small>
                    </td>
                    <td>
                      <select
                        value={row.resolution === "NEW" ? "__NEW__" : row.selectedItemId ?? ""}
                        onChange={(event) => chooseItem(index, event.target.value)}
                      >
                        <option value="">Izaberite artikal</option>
                        <option value="__NEW__">+ Kreiraj novi artikal</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.sifra} · {item.naziv} · {item.unitCode} · {item.vatPercent}%
                          </option>
                        ))}
                      </select>
                      {row.resolution === "NEW" ? (
                        <div className="mapr-new-item-fields">
                          <input
                            value={row.newCode}
                            placeholder="Šifra: AUTO"
                            onChange={(event) => updateNewItem(index, { newCode: event.target.value })}
                          />
                          <input
                            value={row.newName}
                            placeholder="Naziv artikla"
                            onChange={(event) => updateNewItem(index, { newName: event.target.value })}
                          />
                          <select
                            value={row.groupId}
                            onChange={(event) => updateNewItem(index, { groupId: event.target.value })}
                          >
                            <option value="">Bez grupe</option>
                            {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                          </select>
                          <select
                            value={row.unitId ?? ""}
                            onChange={(event) => updateNewItem(index, { unitId: event.target.value })}
                          >
                            <option value="">Izaberite JM</option>
                            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
                          </select>
                          <select
                            value={row.vatRateId ?? ""}
                            onChange={(event) => updateNewItem(index, { vatRateId: event.target.value })}
                          >
                            <option value="">Izaberite PDV</option>
                            {vatRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}
                          </select>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="calculation-table-input"
                        inputMode="decimal"
                        value={row.saleGrossPrice}
                        placeholder="Obavezno"
                        onChange={(event) => updateOne(index, { saleGrossPrice: event.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="form-actions form-wide">
        <button className="primary-button" disabled={!canSubmit} type="submit">
          {preview
            ? `Kreiraj nacrt kalkulacije sa ${rows.length} stavki`
            : "Otvori kalkulaciju"}
        </button>
      </div>
    </form>
  );
}
