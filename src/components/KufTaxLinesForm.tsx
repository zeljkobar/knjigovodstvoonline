"use client";

import { useMemo, useState } from "react";

type VatRate = {
  id: string;
  naziv: string;
  procenat: string;
};

type KufTaxLinesFormProps = {
  disabled?: boolean;
  initialInvoiceTotal?: string;
  initialLines?: {
    vatRateId: string;
    taxBase: string;
    nonDeductibleVat: string;
  }[];
  rates: VatRate[];
};

function parseAmount(value: string) {
  const normalized = value.trim().replace(",", ".");

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputMoney(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return "";
  }

  return value.toFixed(2);
}

function grossFromBase(base: number, percent: number) {
  return Math.round(base * (100 + percent)) / 100;
}

function baseFromGross(gross: number, percent: number) {
  if (percent === 0) {
    return gross;
  }

  return Math.round((gross * 10000) / (100 + percent)) / 100;
}

export function KufTaxLinesForm({
  disabled = false,
  initialInvoiceTotal = "",
  initialLines = [],
  rates
}: KufTaxLinesFormProps) {
  const [invoiceTotal, setInvoiceTotal] = useState(initialInvoiceTotal);
  const [manualBases, setManualBases] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialLines
        .filter((line) => line.taxBase)
        .map((line) => [line.vatRateId, line.taxBase])
    )
  );
  const [nonDeductible, setNonDeductible] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialLines
        .filter((line) => line.nonDeductibleVat)
        .map((line) => [line.vatRateId, line.nonDeductibleVat])
    )
  );

  const calculatedLines = useMemo(() => {
    let remainingGross = parseAmount(invoiceTotal);
    let autoFilled = false;

    return rates.map((rate) => {
      const percent = Number(rate.procenat);
      const manualValue = manualBases[rate.id];
      const hasManualValue = manualValue !== undefined;
      const base = hasManualValue
        ? parseAmount(manualValue)
        : !autoFilled && remainingGross > 0
          ? baseFromGross(remainingGross, percent)
          : 0;
      const vat = Math.round(base * percent) / 100;
      const gross = grossFromBase(base, percent);

      if (hasManualValue) {
        remainingGross = Math.max(0, Math.round((remainingGross - gross) * 100) / 100);
      } else if (!autoFilled && remainingGross > 0) {
        autoFilled = true;
        remainingGross = 0;
      }

      return {
        ...rate,
        base,
        vat
      };
    });
  }, [invoiceTotal, manualBases, rates]);

  const totals = useMemo(
    () =>
      calculatedLines.reduce(
        (sum, line) => {
          const nonDeductibleVat = parseAmount(nonDeductible[line.id] ?? "");

          return {
            base: sum.base + line.base,
            vat: sum.vat + line.vat,
            nonDeductibleVat: sum.nonDeductibleVat + nonDeductibleVat,
            total: sum.total + line.base + line.vat
          };
        },
        {
          base: 0,
          vat: 0,
          nonDeductibleVat: 0,
          total: 0
        }
      ),
    [calculatedLines, nonDeductible]
  );

  return (
    <div className="form-wide kuf-tax-section">
      <label>
        <span>Ukupno račun</span>
        <input
          name="invoice_total"
          inputMode="decimal"
          placeholder="0,00"
          required
          value={invoiceTotal}
          disabled={disabled}
          onChange={(event) => setInvoiceTotal(event.target.value)}
        />
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PDV stopa</th>
              <th>Osnovica</th>
              <th>Ulazni PDV</th>
              <th>Neodbitni PDV</th>
            </tr>
          </thead>
          <tbody>
            {calculatedLines.map((rate) => {
              return (
                <tr key={rate.id}>
                  <td>
                    <strong>{money(Number(rate.procenat))}%</strong>
                    <small>{rate.naziv}</small>
                    <input name="vat_rate_id" type="hidden" value={rate.id} />
                  </td>
                  <td>
                    <input
                      name="tax_base"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={manualBases[rate.id] ?? inputMoney(rate.base)}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        setManualBases((current) => {
                          const next = {
                            ...current
                          };

                          if (nextValue.trim() === "") {
                            delete next[rate.id];
                          } else {
                            next[rate.id] = nextValue;
                          }

                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      name="input_vat_amount"
                      inputMode="decimal"
                      readOnly
                      tabIndex={-1}
                      value={inputMoney(rate.vat)}
                    />
                  </td>
                  <td>
                    <input
                      name="non_deductible_vat_amount"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={nonDeductible[rate.id] ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        setNonDeductible((current) => ({
                          ...current,
                          [rate.id]: event.target.value
                        }))
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="kuf-tax-totals">
        <span>Kontrola osnovica {money(totals.base)}</span>
        <span>Kontrola PDV {money(totals.vat)}</span>
        <span>Neodbitni PDV {money(totals.nonDeductibleVat)}</span>
        <span>Kontrola ukupno {money(totals.total)}</span>
      </div>
    </div>
  );
}
