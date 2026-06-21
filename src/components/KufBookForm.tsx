"use client";

import { useMemo, useState } from "react";
import { createKufBook } from "@/app/agencija/racuni/actions";

type KufBookFormProps = {
  disabled?: boolean;
  invoiceTypes: {
    id: string;
    sifra: string;
    naziv: string;
  }[];
  year: number;
};

const months = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

function inputDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

export function KufBookForm({ disabled = false, invoiceTypes, year }: KufBookFormProps) {
  const currentMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 1;
  const [month, setMonth] = useState(currentMonth);

  const kufDate = useMemo(() => inputDate(lastDayOfMonth(year, month)), [month, year]);

  return (
    <form className="admin-form" action={createKufBook}>
      <label>
        <span>Vrsta KUF-a</span>
        <select name="racun_vrsta_id" disabled={disabled} required>
          {invoiceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.naziv}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Mjesec</span>
        <select
          name="mjesec"
          value={month}
          disabled={disabled}
          onChange={(event) => setMonth(Number(event.target.value))}
        >
          {months.map((name, index) => (
            <option key={name} value={index + 1}>
              {name} {year}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Datum KUF-a</span>
        <input name="kuf_date" type="date" value={kufDate} readOnly tabIndex={-1} />
      </label>
      <button type="submit" disabled={disabled}>
        Novi KUF
      </button>
    </form>
  );
}
