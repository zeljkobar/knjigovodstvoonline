"use client";

import { useEffect, useState } from "react";

type PayrollCalculationFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  defaultMonth: number;
  defaultYear: number;
};

const payrollCategoryOptions = [
  { value: "REDOVAN_RAD", label: "Redovan rad" },
  { value: "UGOVOR_O_DJELU", label: "Ugovor o djelu" },
  { value: "ZAKUP", label: "Zakup" },
  { value: "OSTALI_UGOVORI", label: "Ostali ugovori" }
];

function monthBoundaryDates(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return {
      from: "",
      to: ""
    };
  }

  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  };
}

export function PayrollCalculationForm({
  action,
  defaultMonth,
  defaultYear
}: PayrollCalculationFormProps) {
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [{ from, to }, setDates] = useState(() => monthBoundaryDates(defaultYear, defaultMonth));

  useEffect(() => {
    setDates(monthBoundaryDates(year, month));
  }, [month, year]);

  return (
    <form className="admin-form" action={action}>
      <label>
        <span>Kategorija obračuna</span>
        <select name="kategorija" defaultValue="REDOVAN_RAD">
          {payrollCategoryOptions.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Mjesec</span>
        <input
          name="mjesec"
          type="number"
          value={month}
          min="1"
          max="12"
          required
          onChange={(event) => setMonth(Number(event.target.value))}
        />
      </label>
      <label>
        <span>Godina</span>
        <input
          name="godina"
          type="number"
          value={year}
          required
          onChange={(event) => setYear(Number(event.target.value))}
        />
      </label>
      <label>
        <span>Datum od</span>
        <input name="datum_od" type="date" value={from} required readOnly />
      </label>
      <label>
        <span>Datum do</span>
        <input name="datum_do" type="date" value={to} required readOnly />
      </label>
      <label>
        <span>Datum obračuna</span>
        <input name="datum_obracuna" type="date" value={to} required readOnly />
      </label>
      <label>
        <span>Datum isplate</span>
        <input name="datum_isplate" type="date" />
      </label>
      <label>
        <span>Fond sati</span>
        <input name="fond_sati" type="number" defaultValue="176" min="1" required />
      </label>
      <label>
        <span>Napomena</span>
        <textarea name="napomena" rows={3} />
      </label>
      <button type="submit">Kreiraj obračun</button>
    </form>
  );
}
