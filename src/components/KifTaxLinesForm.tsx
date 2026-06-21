"use client";

import { useMemo, useState } from "react";

type VatRate = {
  id: string;
  naziv: string;
  procenat: string;
};

type KifTaxLinesFormProps = {
  disabled?: boolean;
  rates: VatRate[];
};

function parseMoney(input: string) {
  const normalized = input.trim().replace(",", ".");

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function inputMoney(value: number) {
  if (!value) {
    return "";
  }

  return value.toFixed(2).replace(".", ",");
}

function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function KifTaxLinesForm({ disabled = false, rates }: KifTaxLinesFormProps) {
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [manualBases, setManualBases] = useState<Record<string, string>>({});

  const calculatedLines = useMemo(() => {
    const total = parseMoney(invoiceTotal);
    let remainingTotal = total;

    return rates.map((rate) => {
      const percent = parseMoney(rate.procenat);
      const manualBase = manualBases[rate.id];
      const base =
        manualBase !== undefined
          ? parseMoney(manualBase)
          : percent > 0
            ? remainingTotal / (1 + percent / 100)
            : remainingTotal;
      const vat = percent > 0 ? base * (percent / 100) : 0;
      const lineTotal = base + vat;

      remainingTotal = Math.max(0, remainingTotal - lineTotal);

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
        (sum, line) => ({
          base: sum.base + line.base,
          vat: sum.vat + line.vat,
          total: sum.total + line.base + line.vat
        }),
        {
          base: 0,
          vat: 0,
          total: 0
        }
      ),
    [calculatedLines]
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
              <th>Izlazni PDV</th>
            </tr>
          </thead>
          <tbody>
            {calculatedLines.map((rate) => (
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
                    name="output_vat_amount"
                    inputMode="decimal"
                    readOnly
                    tabIndex={-1}
                    value={inputMoney(rate.vat)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="kuf-tax-totals">
        <span>Kontrola osnovica {money(totals.base)}</span>
        <span>Kontrola PDV {money(totals.vat)}</span>
        <span>Kontrola ukupno {money(totals.total)}</span>
      </div>
    </div>
  );
}
