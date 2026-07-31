"use client";

import { useMemo, useState } from "react";
import {
  pazarPaymentMethods,
  pazarPeriodTypes,
  pazarPostingSchemeFields
} from "@/lib/kif-pazar";

type VatRate = {
  id: string;
  naziv: string;
  procenat: string;
};

type RevenueAccount = {
  sifra: string;
  naziv: string;
};

type InitialPazar = {
  id: string;
  periodType: string;
  periodFrom: string;
  periodTo: string;
  reportNumber: string;
  cashRegister: string;
  total: string;
  revenueAccountCode: string;
  note: string;
  taxLines: Array<{
    vatRateId: string;
    taxBase: string;
  }>;
  payments: Array<{
    method: string;
    amount: string;
  }>;
};

type KifPazarFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  bookId: string;
  defaultDailyDate: string;
  defaultMonth: string;
  disabled?: boolean;
  initial?: InitialPazar | null;
  rates: VatRate[];
  revenueAccountRequired: boolean;
  revenueAccounts: RevenueAccount[];
  defaultRevenueAccount: string;
};

function parseMoneyToCents(input: string) {
  const normalized = input.trim().replace(",", ".");
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function centsInput(cents: number) {
  if (!cents) {
    return "";
  }

  return (cents / 100).toFixed(2).replace(".", ",");
}

function money(cents: number) {
  return (cents / 100).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function KifPazarForm({
  action,
  bookId,
  defaultDailyDate,
  defaultMonth,
  disabled = false,
  initial = null,
  rates,
  revenueAccountRequired,
  revenueAccounts,
  defaultRevenueAccount
}: KifPazarFormProps) {
  const [periodType, setPeriodType] = useState(
    initial?.periodType ?? pazarPeriodTypes.daily
  );
  const [total, setTotal] = useState(initial?.total ?? "");
  const [bases, setBases] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial?.taxLines.map((line) => [line.vatRateId, line.taxBase]) ?? [])
  );
  const [payments, setPayments] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial?.payments.map((line) => [line.method, line.amount]) ?? [])
  );
  const [paymentsTouched, setPaymentsTouched] = useState(Boolean(initial));

  const totalCents = parseMoneyToCents(total);
  const effectivePayments = useMemo(() => {
    if (paymentsTouched) {
      return payments;
    }

    return {
      ...payments,
      [pazarPaymentMethods.cash]: centsInput(totalCents)
    };
  }, [payments, paymentsTouched, totalCents]);
  const calculatedTaxLines = useMemo(() => {
    let remainingTotalCents = totalCents;

    return rates.map((rate) => {
      const percent = Number(rate.procenat);
      const safePercent = Number.isFinite(percent) ? percent : 0;
      const manualBase = bases[rate.id];
      const baseCents =
        manualBase !== undefined
          ? parseMoneyToCents(manualBase)
          : safePercent > 0
            ? Math.round((remainingTotalCents * 100) / (100 + safePercent))
            : remainingTotalCents;
      const vatCents =
        safePercent > 0
          ? manualBase === undefined
            ? Math.max(0, remainingTotalCents - baseCents)
            : Math.round((baseCents * safePercent) / 100)
          : 0;

      remainingTotalCents = Math.max(
        0,
        remainingTotalCents - baseCents - vatCents
      );

      return {
        ...rate,
        baseCents,
        vatCents
      };
    });
  }, [bases, rates, totalCents]);
  const taxTotals = useMemo(
    () =>
      calculatedTaxLines.reduce(
        (sum, line) => ({
          base: sum.base + line.baseCents,
          vat: sum.vat + line.vatCents
        }),
        {
          base: 0,
          vat: 0
        }
      ),
    [calculatedTaxLines]
  );
  const paymentTotal = useMemo(
    () =>
      pazarPostingSchemeFields.reduce(
        (sum, [, , method]) => sum + parseMoneyToCents(effectivePayments[method] ?? ""),
        0
      ),
    [effectivePayments]
  );

  return (
    <form className="admin-form kif-pazar-form" action={action}>
      <input name="kif_book_id" type="hidden" value={bookId} />
      {initial ? <input name="kif_entry_id" type="hidden" value={initial.id} /> : null}

      <label>
        <span>Vrsta izvještaja</span>
        <select
          name="pazar_period_type"
          value={periodType}
          disabled={disabled}
          onChange={(event) => setPeriodType(event.target.value)}
        >
          <option value={pazarPeriodTypes.daily}>Dnevni</option>
          <option value={pazarPeriodTypes.monthly}>Mjesečni</option>
        </select>
      </label>

      {periodType === pazarPeriodTypes.monthly ? (
        <label>
          <span>Mjesec pazara</span>
          <input
            name="pazar_month"
            type="month"
            defaultValue={
              initial?.periodFrom ? initial.periodFrom.slice(0, 7) : defaultMonth
            }
            required
            disabled={disabled}
          />
        </label>
      ) : (
        <label>
          <span>Datum pazara</span>
          <input
            name="pazar_date"
            type="date"
            defaultValue={initial?.periodFrom ?? defaultDailyDate}
            required
            disabled={disabled}
          />
        </label>
      )}

      <label>
        <span>Broj izvještaja</span>
        <input
          name="pazar_report_number"
          defaultValue={initial?.reportNumber ?? ""}
          placeholder="npr. Z-31/07/2026"
          disabled={disabled}
        />
      </label>

      <label>
        <span>Kasa / poslovna jedinica</span>
        <input
          name="pazar_cash_register"
          defaultValue={initial?.cashRegister ?? ""}
          placeholder="Opciono"
          disabled={disabled}
        />
      </label>

      {revenueAccountRequired ? (
        <label>
          <span>Konto prihoda/osnovice</span>
          <select
            name="revenue_account_code"
            defaultValue={initial?.revenueAccountCode ?? defaultRevenueAccount}
            required
            disabled={disabled}
          >
            <option value="">Izaberite konto</option>
            {revenueAccounts.map((account) => (
              <option key={account.sifra} value={account.sifra}>
                {account.sifra} - {account.naziv}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input
          name="revenue_account_code"
          type="hidden"
          value={initial?.revenueAccountCode ?? defaultRevenueAccount}
        />
      )}

      <label className="form-wide">
        <span>Napomena</span>
        <input
          name="note"
          defaultValue={initial?.note ?? ""}
          placeholder="Opis ili interna napomena"
          disabled={disabled}
        />
      </label>

      <div className="form-wide kuf-tax-section">
        <label>
          <span>Ukupan pazar</span>
          <input
            name="invoice_total"
            inputMode="decimal"
            min="0"
            placeholder="0,00"
            required
            value={total}
            disabled={disabled}
            onChange={(event) => setTotal(event.target.value)}
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
              {calculatedTaxLines.map((rate) => (
                <tr key={rate.id}>
                  <td>
                    <strong>
                      {Number(rate.procenat).toFixed(2).replace(".", ",")}%
                    </strong>
                    <small>{rate.naziv}</small>
                    <input name="vat_rate_id" type="hidden" value={rate.id} />
                  </td>
                  <td>
                    <input
                      name="tax_base"
                      inputMode="decimal"
                      min="0"
                      placeholder="0,00"
                      value={bases[rate.id] ?? centsInput(rate.baseCents)}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextValue = event.target.value;

                        setBases((current) => {
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
                      value={centsInput(rate.vatCents)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="kuf-tax-totals">
          <span>Kontrola osnovica {money(taxTotals.base)}</span>
          <span>Kontrola PDV {money(taxTotals.vat)}</span>
          <span>
            Kontrola ukupno {money(taxTotals.base + taxTotals.vat)}
          </span>
        </div>
      </div>

      <div className="form-wide pazar-payments">
        <div className="panel-header">
          <div>
            <h4>Način naplate</h4>
            <span>Zbir naplate mora biti jednak ukupnom pazaru.</span>
          </div>
          <strong>{money(paymentTotal)} / {money(totalCents)}</strong>
        </div>
        <div className="pazar-payment-grid">
          {pazarPostingSchemeFields.map(([, label, method]) => (
            <label key={method}>
              <span>{label}</span>
              <input name="pazar_payment_method" type="hidden" value={method} />
              <input
                name="pazar_payment_amount"
                inputMode="decimal"
                min="0"
                placeholder="0,00"
                value={effectivePayments[method] ?? ""}
                disabled={disabled}
                onChange={(event) => {
                  setPaymentsTouched(true);
                  setPayments((current) => ({
                    ...current,
                    [method]: event.target.value
                  }));
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="kuf-form-actions">
        <button
          type="submit"
          disabled={
            disabled ||
            rates.length === 0 ||
            totalCents <= 0 ||
            Math.abs(taxTotals.base + taxTotals.vat - totalCents) > 1 ||
            paymentTotal !== totalCents
          }
        >
          {initial ? "Sačuvaj pazar" : "Unesi pazar u KIF"}
        </button>
      </div>
    </form>
  );
}
