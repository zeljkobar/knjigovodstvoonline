"use client";

import { useId, useMemo, useState } from "react";
import { importBankStatement } from "./actions";

type BankAccountOption = {
  id: string;
  label: string;
  bankAccountKontoCode: string;
};

type AccountOption = {
  id: string;
  label: string;
  sifra: string;
};

type BankStatementImportFormProps = {
  accountOptions: AccountOption[];
  bankAccounts: BankAccountOption[];
  defaultBankAccountId: string;
  businessUnits: Array<{ id: string; sifra: string; naziv: string }>;
};

export function BankStatementImportForm({
  accountOptions,
  bankAccounts,
  defaultBankAccountId,
  businessUnits
}: BankStatementImportFormProps) {
  const [selectedBankAccountId, setSelectedBankAccountId] = useState(defaultBankAccountId);
  const [fileSummary, setFileSummary] = useState("Nijedan fajl nije izabran");
  const fileInputId = useId();
  const settingByBankAccount = useMemo(
    () => new Map(bankAccounts.map((account) => [account.id, account])),
    [bankAccounts]
  );
  const selectedBankSetting = settingByBankAccount.get(selectedBankAccountId);
  const [selectedAccountCode, setSelectedAccountCode] = useState(
    selectedBankSetting?.bankAccountKontoCode ?? ""
  );

  function handleBankAccountChange(value: string) {
    setSelectedBankAccountId(value);
    setSelectedAccountCode(settingByBankAccount.get(value)?.bankAccountKontoCode ?? "");
  }

  function handleFileChange(files: FileList | null) {
    if (!files || files.length === 0) {
      setFileSummary("Nijedan fajl nije izabran");

      return;
    }

    if (files.length === 1) {
      setFileSummary(files[0]?.name ?? "1 fajl izabran");

      return;
    }

    setFileSummary(`${files.length} fajlova izabrano`);
  }

  return (
    <form action={importBankStatement} className="admin-form">
      <label>
        <span>Bankovni račun firme</span>
        <select
          name="company_bank_account_id"
          onChange={(event) => handleBankAccountChange(event.target.value)}
          required
          value={selectedBankAccountId}
        >
          <option value="">Izaberite bankovni račun</option>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Konto banke za nalog</span>
        <select
          name="bank_account_konto_code"
          onChange={(event) => setSelectedAccountCode(event.target.value)}
          required
          value={selectedAccountCode}
        >
          <option value="">Izaberite konto</option>
          {accountOptions.map((account) => (
            <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
              {account.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Broj izvoda</span>
        <input name="statement_number" placeholder="popunjava XML ili unesite ručno" />
      </label>
      {businessUnits.length > 0 ? (
        <label>
          <span>Poslovna jedinica (opciono)</span>
          <select name="poslovna_jedinica_id" defaultValue="">
            <option value="">Bez poslovne jedinice</option>
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.sifra} — {unit.naziv}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>Datum izvoda</span>
        <input name="statement_date" type="date" />
      </label>
      <label>
        <span>Početno stanje</span>
        <input name="opening_balance" placeholder="popunjava XML ili unesite ručno" />
      </label>
      <label>
        <span>Krajnje stanje</span>
        <input name="closing_balance" placeholder="popunjava XML ili unesite ručno" />
      </label>
      <div className="full-span file-picker-field">
        <span>Fajl izvoda</span>
        <div className="file-picker-control">
          <input
            accept=".xml,.htm,.html,.pdf,text/xml,application/xml,text/html,application/pdf"
            className="file-picker-input"
            id={fileInputId}
            multiple
            name="statement_file"
            onChange={(event) => handleFileChange(event.target.files)}
            type="file"
          />
          <label className="file-picker-button" htmlFor={fileInputId}>
            Izaberi izvode
          </label>
          <span className="file-picker-summary">{fileSummary}</span>
        </div>
      </div>
      <label className="full-span">
        <span>Tekst izvoda</span>
        <textarea
          name="raw_text"
          placeholder="XML/HTM/PDF fajl se čita automatski. Za ručni tekst koristite: datum; opis; žiro račun; odliv; priliv"
          rows={6}
        />
      </label>
      <button className="primary-button" type="submit">
        Uvezi izvod(e)
      </button>
    </form>
  );
}
