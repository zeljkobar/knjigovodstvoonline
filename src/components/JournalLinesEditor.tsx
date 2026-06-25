"use client";

import { useRef, useState } from "react";

type AccountOption = {
  analitika_obavezna: boolean;
  naziv: string;
  sifra: string;
};

type PartnerOption = {
  id: string;
  naziv: string;
  pib: string | null;
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
};

type JournalLinesEditorProps = {
  accounts: AccountOption[];
  datalistId: string;
  initialLines?: JournalLineInitialValue[];
  minimumRows?: number;
  partners: PartnerOption[];
};

function createEmptyRows(count: number) {
  return Array.from({ length: count });
}

function partnerDisplay(partner: PartnerOption) {
  return `${partner.naziv}${partner.pib ? ` (${partner.pib})` : ""}`;
}

export function JournalLinesEditor({
  accounts,
  datalistId,
  initialLines = [],
  minimumRows = 5,
  partners
}: JournalLinesEditorProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [rowCount, setRowCount] = useState(
    Math.max(initialLines.length + 5, minimumRows)
  );
  const [totals, setTotals] = useState(() => calculateInitialTotals(initialLines));
  const rows = createEmptyRows(rowCount);
  const partnerDatalistId = `${datalistId}-partneri`;

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

  function resolvePartnerId(value: string) {
    const searchValue = value.trim().toLowerCase();

    if (!searchValue) {
      return "";
    }

    const partner = partners.find((item) => {
      const displayValue = partnerDisplay(item).toLowerCase();
      const nameValue = item.naziv.toLowerCase();
      const pibValue = item.pib?.toLowerCase();

      return (
        displayValue === searchValue ||
        nameValue === searchValue ||
        pibValue === searchValue ||
        item.id === value
      );
    });

    return partner?.id ?? "";
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
      <datalist id={partnerDatalistId}>
        {partners.map((partner) => (
          <option
            key={partner.id}
            label={partner.pib ? `${partner.pib} - ${partner.naziv}` : partner.naziv}
            value={partnerDisplay(partner)}
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
              const initialPartner = initialLine?.partnerId
                ? partners.find((partner) => partner.id === initialLine.partnerId)
                : null;

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
                  <td>
                    <input
                      data-partner-input="true"
                      defaultValue={initialPartner ? partnerDisplay(initialPartner) : ""}
                      list={partnerDatalistId}
                      name="komitent_pretraga"
                      onChange={(event) => {
                        const hiddenInput =
                          event.currentTarget.parentElement?.querySelector<HTMLInputElement>(
                            'input[name="komitent_id"]'
                          );

                        if (hiddenInput) {
                          hiddenInput.value = resolvePartnerId(event.currentTarget.value);
                        }

                        touchRow(index);
                      }}
                      onFocus={() => touchRow(index)}
                      placeholder="Naziv ili PIB"
                    />
                    <input
                      defaultValue={initialLine?.partnerId ?? ""}
                      name="komitent_id"
                      type="hidden"
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
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                      placeholder="Broj"
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
