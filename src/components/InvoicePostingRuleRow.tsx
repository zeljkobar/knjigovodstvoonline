"use client";

import { AccountSearchSelect } from "@/components/AccountSearchSelect";


import { useState } from "react";
import { invoicePostingAccountSources, invoicePostingForeignTotalField } from "@/lib/account-plan";

type AccountOption = {
  sifra: string;
  naziv: string;
};

type InvoicePostingRuleRowProps = {
  accountOptions: AccountOption[];
  accountValue: string;
  foreignAccountValue?: string;
  code: string;
  direction: string;
  label: string;
  source: string;
};

export function InvoicePostingRuleRow({
  accountOptions,
  accountValue,
  foreignAccountValue = "",
  code,
  direction,
  label,
  source
}: InvoicePostingRuleRowProps) {
  const isPartnerTotal = code === "UKUPAN_IZNOS";
  const [accountSource, setAccountSource] = useState(isPartnerTotal ? invoicePostingAccountSources.fixed : source);
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
          <option value={invoicePostingAccountSources.fixed}>{isPartnerTotal ? "Prema partneru (domaći / ino)" : "Izabrano konto"}</option>
          {!isPartnerTotal ? <option value={invoicePostingAccountSources.inputExpense}>
            Konto iz unosa računa
          </option> : null}
        </select>
      </td>
      <td>
        {isPartnerTotal ? <span className="posting-account-label">Domaći partner</span> : null}
        <AccountSearchSelect
          aria-label={isPartnerTotal ? "Konto domaćeg partnera" : `Konto: ${label}`}
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
        </AccountSearchSelect>
        {isPartnerTotal ? <>
          <span className="posting-account-label">Ino partner</span>
          <AccountSearchSelect
            aria-label="Konto ino partnera"
            name={`sifra_konta_${invoicePostingForeignTotalField}`}
            defaultValue={foreignAccountValue}
          >
            <option value="">-</option>
            {accountOptions.map(account => <option key={`ino-${account.sifra}`} value={account.sifra}>
              {account.sifra} - {account.naziv}
            </option>)}
          </AccountSearchSelect>
          <small className="muted-text">Obavezno za knjiženje računa ino partnera.</small>
        </> : null}
      </td>
    </tr>
  );
}

