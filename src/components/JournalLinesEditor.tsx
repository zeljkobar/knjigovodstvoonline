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
                  <td>
                    <select
                      defaultValue={initialLine?.partnerId ?? ""}
                      name="komitent_id"
                      onChange={() => touchRow(index)}
                      onFocus={() => touchRow(index)}
                    >
                      <option value="">-</option>
                      {partners.map((partner) => (
                        <option key={partner.id} value={partner.id}>
                          {partner.naziv}
                          {partner.pib ? ` (${partner.pib})` : ""}
                        </option>
                      ))}
                    </select>
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
                      defaultValue={initialLine?.debit ?? ""}
                      min="0"
                      name="duguje"
                      onChange={() => touchRow(index)}
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
                      onChange={() => touchRow(index)}
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
    </>
  );
}
