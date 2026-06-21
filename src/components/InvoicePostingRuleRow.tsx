"use client";

import { useState } from "react";
import { invoicePostingAccountSources } from "@/lib/account-plan";

type AccountOption = {
  sifra: string;
  naziv: string;
};

type InvoicePostingRuleRowProps = {
  accountOptions: AccountOption[];
  accountValue: string;
  code: string;
  direction: string;
  label: string;
  source: string;
};

export function InvoicePostingRuleRow({
  accountOptions,
  accountValue,
  code,
  direction,
  label,
  source
}: InvoicePostingRuleRowProps) {
  const [accountSource, setAccountSource] = useState(source);
  const needsFixedAccount = accountSource === invoicePostingAccountSources.fixed;

  return (
    <tr>
      <td>
        <strong>{label}</strong>
        <small>{code}</small>
      </td>
      <td>
        <select name={`smjer_${code}`} defaultValue={direction}>
          <option value="D">Duguje</option>
          <option value="P">Potražuje</option>
        </select>
      </td>
      <td>
        <select
          name={`konto_izvor_${code}`}
          value={accountSource}
          onChange={(event) => setAccountSource(event.target.value)}
        >
          <option value={invoicePostingAccountSources.fixed}>Izabrano konto</option>
          <option value={invoicePostingAccountSources.inputExpense}>
            Konto iz unosa računa
          </option>
        </select>
      </td>
      <td>
        <select
          name={`sifra_konta_${code}`}
          defaultValue={accountValue}
          disabled={!needsFixedAccount}
          required={needsFixedAccount}
        >
          <option value="">-</option>
          {accountOptions.map((account) => (
            <option key={`${code}-${account.sifra}`} value={account.sifra}>
              {account.sifra} - {account.naziv}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

