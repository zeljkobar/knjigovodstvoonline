"use client";

import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import { PazarImportPanel, type ImportedPazarForm } from "@/components/PazarImportPanel";


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
  sourceImported?: boolean;
  id: string;
  periodType: string;
  periodFrom: string;
  periodTo: string;
  reportNumber: string;
  cashRegister: string;
  total: string;
  revenueAccountCode: string;
  note: string;
  businessUnitId: string;
  taxLines: Array<{
    vatRateId: string;
    taxBase: string;
    vatAmount?: string;
  }>;
  payments: Array<{
    method: string;
    amount: string;
  }>;
};

type KifPazarFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  bookId: string;
  companyId: string;
  defaultDailyDate: string;
  defaultMonth: string;
  disabled?: boolean;
  initial?: InitialPazar | null;
  rates: VatRate[];
  revenueAccountRequired: boolean;
  revenueAccounts: RevenueAccount[];
  defaultRevenueAccount: string;
  businessUnits: Array<{ id: string; sifra: string; naziv: string }>;
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
  companyId,
  defaultDailyDate,
  defaultMonth,
  disabled = false,
  initial = null,
  rates,
  revenueAccountRequired,
  revenueAccounts,
  defaultRevenueAccount,
  businessUnits
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
  const [importToken, setImportToken] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const imported = Boolean(importToken || initial?.sourceImported);
  const [vatOverrides, setVatOverrides] = useState<Record<string, string>>(() => Object.fromEntries(initial?.taxLines.filter(t => t.vatAmount !== undefined).map(t => [t.vatRateId, t.vatAmount!]) ?? []));
  const [periodFrom, setPeriodFrom] = useState(initial?.periodFrom ?? defaultDailyDate), [periodTo, setPeriodTo] = useState(initial?.periodTo ?? defaultDailyDate);
  const [month, setMonth] = useState(initial?.periodFrom.slice(0, 7) ?? defaultMonth);
  const [reportNumber, setReportNumber] = useState(initial?.reportNumber ?? ""), [cashRegister, setCashRegister] = useState(initial?.cashRegister ?? "");
  function applyImport(data: ImportedPazarForm, token: string) {
    setPeriodType(data.periodType); setPeriodFrom(data.periodFrom); setPeriodTo(data.periodTo); setMonth(data.periodFrom.slice(0, 7));
    setTotal(data.total); setCashRegister(data.cashRegister); setReportNumber(data.reportNumber);
    setBases(Object.fromEntries(rates.map(r => [r.id, data.taxLines.find(t => t.vatRateId === r.id)?.taxBase ?? "0,00"])));
    setVatOverrides(Object.fromEntries(rates.map(r => [r.id, data.taxLines.find(t => t.vatRateId === r.id)?.vatAmount ?? "0,00"])));
    setPayments(Object.fromEntries(data.payments.map(p => [p.method, p.amount]))); setPaymentsTouched(true); setImportToken(token);
  }

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
      const vatCents = vatOverrides[rate.id] !== undefined ? parseMoneyToCents(vatOverrides[rate.id]) :
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
  }, [bases, rates, totalCents, vatOverrides]);
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
    <form className="admin-form kif-pazar-form" action={action} aria-busy={importBusy} onSubmit={event => { if (importBusy) event.preventDefault(); }}>
      <input name="kif_book_id" type="hidden" value={bookId} />
      <input name="pazar_import_token" type="hidden" value={importToken}/>
      {!initial ? <PazarImportPanel bookId={bookId} companyId={companyId} month={defaultMonth} disabled={disabled} onImport={applyImport} onBusyChange={setImportBusy}/> : null}
      {initial ? <input name="kif_entry_id" type="hidden" value={initial.id} /> : null}

      <label>
        <span>Vrsta izvještaja</span>
        <select
          name="pazar_period_type"
          value={periodType}
          disabled={disabled || imported}
          onChange={(event) => setPeriodType(event.target.value)}
        >
          <option value={pazarPeriodTypes.daily}>Dnevni</option>
          <option value={pazarPeriodTypes.monthly}>Mjesečni</option>
          <option value={pazarPeriodTypes.range}>Period</option>
        </select>
      </label>
      {imported ? <input type="hidden" name="pazar_period_type" value={periodType}/> : null}

      {periodType === pazarPeriodTypes.monthly ? (
        <label>
          <span>Mjesec pazara</span>
          <input
            name="pazar_month"
            type="month"
            value={month} onChange={event => setMonth(event.target.value)} readOnly={imported}
            required
            disabled={disabled}
          />
        </label>
      ) : periodType === pazarPeriodTypes.range ? <>
        <label>Od<input name="pazar_from" type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} readOnly={imported} disabled={disabled} required/></label>
        <label>Do<input name="pazar_to" type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} readOnly={imported} disabled={disabled} required/></label>
      </> : (
        <label>
          <span>Datum pazara</span>
          <input
            name="pazar_date"
            type="date"
            value={periodFrom} onChange={e => { setPeriodFrom(e.target.value); setPeriodTo(e.target.value); }} readOnly={imported}
            required
            disabled={disabled}
          />
        </label>
      )}

      <label>
        <span>Broj izvještaja</span>
        <input
          name="pazar_report_number"
          value={reportNumber} onChange={e => setReportNumber(e.target.value)}
          placeholder="npr. Z-31/07/2026"
          disabled={disabled}
        />
      </label>

      <label>
        <span>Kasa / poslovna jedinica</span>
        <input
          name="pazar_cash_register"
          value={cashRegister} onChange={e => setCashRegister(e.target.value)} readOnly={imported}
          placeholder="Opciono"
          disabled={disabled}
        />
      </label>
      {businessUnits.length > 0 ? (
        <label>
          <span>Poslovna jedinica (opciono)</span>
          <select name="poslovna_jedinica_id" defaultValue={initial?.businessUnitId ?? ""} disabled={disabled}>
            <option value="">Bez poslovne jedinice</option>
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.sifra} — {unit.naziv}</option>
            ))}
          </select>
        </label>
      ) : null}

      {revenueAccountRequired ? (
        <label>
          <span>Konto prihoda/osnovice</span>
          <AccountSearchSelect
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
          </AccountSearchSelect>
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
                        setVatOverrides(current => { const next = { ...current }; delete next[rate.id]; return next; });

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
                      onChange={event => setVatOverrides(current => ({ ...current, [rate.id]: event.target.value }))}
                      disabled={disabled}
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
            importBusy ||
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
