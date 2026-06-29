"use client";

import { useRef, useState } from "react";
import { JournalPartnerCell } from "@/components/JournalPartnerCell";

type AccountOption = {
  analitika_obavezna: boolean;
  naziv: string;
  sifra: string;
};

export type JournalLineInitialValue = {
  accountCode?: string;
  documentDate?: string;
  documentDueDate?: string;
  documentNumber?: string;
  credit?: string;
  debit?: string;
  description?: string;
  partnerId?: string;
  partnerNaziv?: string;
  partnerPib?: string | null;
};

type JournalLinesEditorProps = {
  accounts: AccountOption[];
  datalistId: string;
  initialLines?: JournalLineInitialValue[];
  minimumRows?: number;
};

type OpenItem = {
  documentDate: string | null;
  documentNumber: string;
  dueDate: string | null;
  openAmountCents: number;
};

type OpenItemsModalState = {
  accountCode: string;
  closeSide: "D" | "P" | null;
  error: string | null;
  items: OpenItem[];
  loading: boolean;
  partnerLabel: string;
  rowIndex: number;
};

function createEmptyRows(count: number) {
  return Array.from({ length: count });
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) {
    return;
  }

  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function JournalLinesEditor({
  accounts,
  datalistId,
  initialLines = [],
  minimumRows = 5
}: JournalLinesEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rowCount, setRowCount] = useState(
    Math.max(initialLines.length + 5, minimumRows)
  );
  const [totals, setTotals] = useState(() => calculateInitialTotals(initialLines));
  const [openItemsModal, setOpenItemsModal] =
    useState<OpenItemsModalState | null>(null);
  const rows = createEmptyRows(rowCount);

  function defaultLineDescription(index: number) {
    const wrapper = wrapperRef.current;
    const form = wrapper?.closest("form");
    const journalDescription = form
      ?.querySelector<HTMLInputElement>('input[name="opis"]')
      ?.value.trim();
    const lineDescription = wrapper?.querySelector<HTMLInputElement>(
      `input[name="stavka_opis"][data-row-index="${index}"]`
    );

    if (journalDescription && lineDescription && !lineDescription.value.trim()) {
      lineDescription.value = journalDescription;
    }
  }

  function touchRow(index: number) {
    defaultLineDescription(index);

    if (index >= rowCount - 1) {
      setRowCount((current) => current + 5);
    }
  }

  function recalculateTotals() {
    const wrapper = wrapperRef.current;

    if (!wrapper) {
      return;
    }

    const debit = sumMoneyInputs(wrapper.querySelectorAll<HTMLInputElement>('input[name="duguje"]'));
    const credit = sumMoneyInputs(
      wrapper.querySelectorAll<HTMLInputElement>('input[name="potrazuje"]')
    );

    setTotals({
      credit,
      debit
    });
  }

  function getRow(index: number) {
    return wrapperRef.current?.querySelectorAll<HTMLTableRowElement>("tbody tr")[
      index
    ] ?? null;
  }

  async function openItemsForRow(index: number) {
    const row = getRow(index);
    const accountCode =
      row?.querySelector<HTMLInputElement>('input[name="konto_sifra"]')?.value.trim() ??
      "";
    const partnerId =
      row?.querySelector<HTMLInputElement>('input[name="komitent_id"]')?.value.trim() ??
      "";
    const partnerLabel =
      row
        ?.querySelector<HTMLInputElement>('input[data-partner-input="true"]')
        ?.value.trim() ?? "";

    touchRow(index);

    if (!accountCode || !partnerId) {
      setOpenItemsModal({
        accountCode,
        closeSide: null,
        error: "Prvo unesite konto i izaberite partnera.",
        items: [],
        loading: false,
        partnerLabel,
        rowIndex: index
      });
      return;
    }

    const closeSide = accountCode.startsWith("2")
      ? "P"
      : accountCode.startsWith("4")
        ? "D"
        : null;

    if (!closeSide) {
      setOpenItemsModal({
        accountCode,
        closeSide: null,
        error: "Otvorene stavke se za sada nude za kupce i dobavljače.",
        items: [],
        loading: false,
        partnerLabel,
        rowIndex: index
      });
      return;
    }

    setOpenItemsModal({
      accountCode,
      closeSide,
      error: null,
      items: [],
      loading: true,
      partnerLabel,
      rowIndex: index
    });

    try {
      const params = new URLSearchParams({
        konto_sifra: accountCode,
        komitent_id: partnerId
      });
      const response = await fetch(`/api/nalozi/open-items?${params.toString()}`);
      const data = (await response.json()) as {
        closeSide?: "D" | "P" | null;
        items?: OpenItem[];
        message?: string;
      };

      if (!response.ok) {
        throw new Error(data.message || "Otvorene stavke nisu dostupne.");
      }

      setOpenItemsModal({
        accountCode,
        closeSide: data.closeSide ?? closeSide,
        error: null,
        items: data.items ?? [],
        loading: false,
        partnerLabel,
        rowIndex: index
      });
    } catch (error) {
      setOpenItemsModal({
        accountCode,
        closeSide,
        error:
          error instanceof Error
            ? error.message
            : "Otvorene stavke nisu dostupne.",
        items: [],
        loading: false,
        partnerLabel,
        rowIndex: index
      });
    }
  }

  function applyOpenItem(item: OpenItem) {
    if (!openItemsModal?.closeSide) {
      return;
    }

    const row = getRow(openItemsModal.rowIndex);
    const amount = (item.openAmountCents / 100).toFixed(2);

    setInputValue(
      row?.querySelector<HTMLInputElement>('input[name="broj_dokumenta"]') ?? null,
      item.documentNumber
    );
    setInputValue(
      row?.querySelector<HTMLInputElement>('input[name="datum_dokumenta"]') ?? null,
      item.documentDate ?? ""
    );
    setInputValue(
      row?.querySelector<HTMLInputElement>('input[name="datum_valute"]') ?? null,
      item.dueDate ?? item.documentDate ?? ""
    );

    if (openItemsModal.closeSide === "P") {
      setInputValue(row?.querySelector<HTMLInputElement>('input[name="duguje"]') ?? null, "");
      setInputValue(
        row?.querySelector<HTMLInputElement>('input[name="potrazuje"]') ?? null,
        amount
      );
    } else {
      setInputValue(row?.querySelector<HTMLInputElement>('input[name="potrazuje"]') ?? null, "");
      setInputValue(
        row?.querySelector<HTMLInputElement>('input[name="duguje"]') ?? null,
        amount
      );
    }

    recalculateTotals();
    setOpenItemsModal(null);
  }

  return (
    <>
      <datalist id={datalistId}>
        {accounts.map((account) => (
          <option
            key={account.sifra}
            label={`${account.sifra} - ${account.naziv}${
              account.analitika_obavezna ? " *" : ""
            }`}
            value={account.sifra}
          />
        ))}
      </datalist>

      <div className="table-wrap" ref={wrapperRef}>
        <table className="journal-lines-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Konto</th>
              <th>Partner</th>
              <th>Opis</th>
              <th>Broj dok.</th>
              <th>Datum dok.</th>
              <th>Valuta</th>
              <th>Duguje</th>
              <th>Potražuje</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((_, index) => {
              const initialLine = initialLines[index] ?? null;

              return (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <input
                      autoComplete="off"
                      defaultValue={initialLine?.accountCode ?? ""}
                      list={datalistId}
                      name="konto_sifra"
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      placeholder="npr. 2020"
                    />
                  </td>
                  <td className="journal-partner-td">
                    <JournalPartnerCell
                      initialId={initialLine?.partnerId ?? ""}
                      initialNaziv={initialLine?.partnerNaziv ?? ""}
                      initialPib={initialLine?.partnerPib ?? null}
                      onActivity={() => touchRow(index)}
                    />
                  </td>
                  <td>
                    <input
                      data-row-index={index}
                      defaultValue={initialLine?.description ?? ""}
                      name="stavka_opis"
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      placeholder="Opis stavke"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={initialLine?.documentNumber ?? ""}
                      name="broj_dokumenta"
                      onDoubleClick={() => openItemsForRow(index)}
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      placeholder="Broj"
                      title="Dupli klik za otvorene stavke partnera"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={initialLine?.documentDate ?? ""}
                      name="datum_dokumenta"
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      type="date"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={initialLine?.documentDueDate ?? ""}
                      name="datum_valute"
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      type="date"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={initialLine?.debit ?? ""}
                      min="0"
                      name="duguje"
                      onChange={() => {
                        touchRow(index);
                        recalculateTotals();
                      }}
                      onFocus={() => touchRow(index)}
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={initialLine?.credit ?? ""}
                      min="0"
                      name="potrazuje"
                      onChange={() => {
                        touchRow(index);
                        recalculateTotals();
                      }}
                      onFocus={() => touchRow(index)}
                      step="0.01"
                      type="number"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="journal-balance-summary">
        <div>
          <span>Ukupno duguje</span>
          <strong>{formatMoney(totals.debit)}</strong>
        </div>
        <div>
          <span>Ukupno potražuje</span>
          <strong>{formatMoney(totals.credit)}</strong>
        </div>
        <div className={totals.debit === totals.credit ? "balanced" : "unbalanced"}>
          <span>Razlika</span>
          <strong>{formatMoney(Math.abs(totals.debit - totals.credit))}</strong>
        </div>
      </div>
      {openItemsModal ? (
        <div
          className="journal-open-items-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpenItemsModal(null);
            }
          }}
        >
          <section
            aria-modal="true"
            className="journal-open-items-modal"
            role="dialog"
          >
            <div className="panel-header">
              <div>
                <h3>Otvorene stavke</h3>
                <span>
                  {openItemsModal.partnerLabel || "Partner"} / konto{" "}
                  {openItemsModal.accountCode || "-"}
                </span>
              </div>
              <button
                className="secondary-button"
                onClick={() => setOpenItemsModal(null)}
                type="button"
              >
                Zatvori
              </button>
            </div>

            {openItemsModal.error ? (
              <p className="admin-message">{openItemsModal.error}</p>
            ) : openItemsModal.loading ? (
              <p className="empty-state">Učitavam otvorene stavke...</p>
            ) : openItemsModal.items.length === 0 ? (
              <p className="empty-state">Nema otvorenih stavki za ovaj konto i partnera.</p>
            ) : (
              <div className="table-wrap">
                <table className="admin-table journal-open-items-table">
                  <thead>
                    <tr>
                      <th>Broj dokumenta</th>
                      <th>Datum dok.</th>
                      <th>Valuta</th>
                      <th>Otvoreno</th>
                      <th>Akcija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openItemsModal.items.map((item) => (
                      <tr key={`${item.documentNumber}-${item.documentDate ?? ""}`}>
                        <td>{item.documentNumber}</td>
                        <td>{formatDateValue(item.documentDate)}</td>
                        <td>{formatDateValue(item.dueDate)}</td>
                        <td>{formatCents(item.openAmountCents)}</td>
                        <td>
                          <button
                            className="table-button"
                            onClick={() => applyOpenItem(item)}
                            type="button"
                          >
                            Izaberi
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function parseMoney(value: string | undefined) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function calculateInitialTotals(initialLines: JournalLineInitialValue[]) {
  return initialLines.reduce(
    (totals, line) => ({
      credit: totals.credit + parseMoney(line.credit),
      debit: totals.debit + parseMoney(line.debit)
    }),
    {
      credit: 0,
      debit: 0
    }
  );
}

function sumMoneyInputs(inputs: NodeListOf<HTMLInputElement>) {
  return Array.from(inputs).reduce((sum, input) => sum + parseMoney(input.value), 0);
}

function formatMoney(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCents(value: number) {
  return (value / 100).toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDateValue(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00`);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("sr-Latn");
}
