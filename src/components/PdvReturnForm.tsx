"use client";

import { useMemo, useState } from "react";

type PdvReturnRow = {
  id: string;
  sifra: string;
  opis: string;
  kolona: string;
  sistemska_vrijednost: string;
  rucna_vrijednost: string | null;
};

type PdvReturnFormProps = {
  locked: boolean;
  month: number;
  prijavaId: string;
  rows: PdvReturnRow[];
};

const sections = [
  {
    title: "",
    rows: ["9", "10", "11", "12", "13", "14", "15"]
  },
  {
    title: "Izlazni PDV na isporuke proizvoda i usluga",
    rows: ["16", "17", "18"]
  },
  {
    title: "Ulazni PDV (pretporez) pri nabavci proizvoda i usluga",
    rows: ["19", "20", "21", "22", "23"]
  },
  {
    title: "Obračun obaveze / kredit",
    rows: ["24", "25", "26", "27", "28", "29", "30"]
  }
];

function initialValue(row: PdvReturnRow) {
  return row.rucna_vrijednost ?? row.sistemska_vrijednost ?? "0";
}

function parseValue(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatValue(value: number) {
  return value.toFixed(2);
}

function valueKey(row: Pick<PdvReturnRow, "sifra" | "kolona">) {
  return `${row.sifra}_${row.kolona}`;
}

function vatFromGross(gross: number, rate: number) {
  return Math.round((gross * rate * 100) / (100 + rate)) / 100;
}

function recalculate(values: Record<string, string>, changedCode: string) {
  const next = { ...values };
  const get = (code: string, column: string) => parseValue(next[`${code}_${column}`] ?? "0");
  const set = (code: string, column: string, value: number) => {
    next[`${code}_${column}`] = formatValue(value);
  };

  if (["10", "11", "12"].includes(changedCode)) {
    set("16", "OUTPUT", vatFromGross(get("10", "OUTPUT"), 21));
    set("17", "OUTPUT", vatFromGross(get("11", "OUTPUT"), 15));
    set("18", "OUTPUT", vatFromGross(get("12", "OUTPUT"), 7));
  }

  const outputTotal = get("16", "OUTPUT") + get("17", "OUTPUT") + get("18", "OUTPUT") + get("21", "OUTPUT");
  const inputTotal = get("19", "INPUT") + get("20", "INPUT") + get("21", "INPUT") + get("22", "INPUT");
  const nonDeductible = get("26", "INPUT");
  const deductible = Math.max(inputTotal - nonDeductible, 0);
  const payable = Math.max(outputTotal - deductible, 0);
  const credit = Math.max(deductible - outputTotal, 0);

  set("24", "OUTPUT", outputTotal);
  set("25", "INPUT", inputTotal);
  set("27", "INPUT", deductible);
  set("28", "OUTPUT", payable);
  set("29", "INPUT", credit);

  return next;
}

export function PdvReturnForm({ locked, month, prijavaId, rows }: PdvReturnFormProps) {
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.sifra, row])), [rows]);
  const [values, setValues] = useState(() => {
    const result: Record<string, string> = {};

    for (const row of rows) {
      result[valueKey(row)] = initialValue(row);
    }

    return recalculate(result, "");
  });

  function updateValue(row: PdvReturnRow, nextValue: string) {
    setValues((current) =>
      recalculate(
        {
          ...current,
          [valueKey(row)]: nextValue
        },
        row.sifra
      )
    );
  }

  function inputFor(row: PdvReturnRow | undefined, column: "OUTPUT" | "INPUT") {
    if (!row || row.kolona !== column) {
      return <span className="pdv-empty-cell" />;
    }

    const key = valueKey(row);
    const readOnly = locked || ["16", "17", "18", "24", "25", "27", "28", "29"].includes(row.sifra);

    return (
      <input
        className="pdv-return-input"
        name={`vrijednost_${key}`}
        value={values[key] ?? "0.00"}
        onChange={(event) => updateValue(row, event.target.value)}
        readOnly={readOnly}
      />
    );
  }

  function checkboxFor(row: PdvReturnRow) {
    const key = valueKey(row);
    const checked = parseValue(values[key] ?? "0") > 0;

    return (
      <label className="pdv-return-check">
        <input name={`vrijednost_${key}`} type="hidden" value={checked ? "1" : "0"} />
        <input
          checked={checked}
          disabled={locked}
          onChange={(event) => updateValue(row, event.target.checked ? "1" : "0")}
          type="checkbox"
        />
      </label>
    );
  }

  return (
    <div className="pdv-return-form">
      <input name="mjesec" type="hidden" value={month} />
      <input name="prijava_id" type="hidden" value={prijavaId} />
      {sections.map((section) => (
        <section className="pdv-return-section" key={section.rows.join("-")}>
          {section.title ? (
            <div className="pdv-return-section-header">
              <strong>{section.title}</strong>
              <span>Izlazni PDV</span>
              <span>Ulazni PDV</span>
            </div>
          ) : null}

          {section.rows.map((code) => {
            const row = rowMap.get(code);

            if (!row) {
              return null;
            }

            return (
              <div className="pdv-return-row" key={row.id}>
                <label>
                  <span>{row.sifra}. {row.opis}</span>
                </label>
                {row.kolona === "CHECK" ? (
                  <>
                    {checkboxFor(row)}
                    <span className="pdv-empty-cell" />
                  </>
                ) : (
                  <>
                    {inputFor(row, "OUTPUT")}
                    {inputFor(row, "INPUT")}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
