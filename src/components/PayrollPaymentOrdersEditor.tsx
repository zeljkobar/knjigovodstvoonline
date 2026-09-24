"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  mergeStoredPayrollPaymentOrders,
  payrollPaymentOrderErrors,
  payrollPaymentOrderStorageKey,
  type PayrollPaymentOrderPrintRow
} from "@/lib/payroll-payment-order-print";

type TextField = Exclude<
  keyof PayrollPaymentOrderPrintRow,
  "amountCent" | "errors" | "id" | "type" | "typeLabel"
>;

function textValue(value: string | null) {
  return value ?? "";
}

export function PayrollPaymentOrdersEditor({
  calculationId,
  initialOrders,
  printUrl,
  backUrl,
  canEdit
}: {
  calculationId: string;
  initialOrders: PayrollPaymentOrderPrintRow[];
  printUrl: string;
  backUrl: string;
  canEdit: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [loaded, setLoaded] = useState(false);
  const storageKey = payrollPaymentOrderStorageKey(calculationId);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      setOrders(mergeStoredPayrollPaymentOrders(initialOrders, stored));
    } catch {
      setOrders(initialOrders);
    } finally {
      setLoaded(true);
    }
  }, [initialOrders, storageKey]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(storageKey, JSON.stringify(orders));
  }, [loaded, orders, storageKey]);

  const readiness = useMemo(
    () => orders.map((order) => payrollPaymentOrderErrors(order)),
    [orders]
  );
  const readyCount = readiness.filter((errors) => errors.length === 0).length;

  const updateText = (orderId: string, field: TextField, value: string) => {
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? ({ ...order, [field]: value || null } as PayrollPaymentOrderPrintRow)
          : order
      )
    );
  };

  const updateAmount = (orderId: string, value: string) => {
    const amount = Number(value.replace(",", "."));
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? { ...order, amountCent: Number.isFinite(amount) ? Math.round(amount * 100) : 0 }
          : order
      )
    );
  };

  const reset = () => {
    window.localStorage.removeItem(storageKey);
    setOrders(initialOrders);
  };

  const openPrint = () => {
    window.localStorage.setItem(storageKey, JSON.stringify(orders));
    window.open(printUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="admin-panel payroll-payment-orders-editor">
      <div className="payroll-payment-orders-editor-toolbar">
        <div>
          <h3>Priprema virmana</h3>
          <p>
            {orders.length} ukupno · {readyCount} spremno · {orders.length - readyCount} za dopunu
          </p>
        </div>
        <div className="button-row">
          {canEdit ? (
            <>
              <button className="primary-button" disabled={readyCount === 0} onClick={openPrint} type="button">
                Priprema štampe
              </button>
              <button className="secondary-button" onClick={reset} type="button">
                Vrati podatke obračuna
              </button>
            </>
          ) : null}
          <Link className="secondary-button" href={backUrl}>
            Nazad na obračun
          </Link>
        </div>
      </div>

      <p className="compact-note payroll-payment-orders-editor-note">
        Polja možete korigovati prije štampe. Izmjene važe samo za virmane i ne
        mijenjaju obračun plata niti podatke u bazi.
      </p>

      <div className="payroll-payment-order-cards">
        {orders.map((order, index) => {
          const errors = readiness[index];
          return (
            <article className="payroll-payment-order-card" key={order.id}>
              <header>
                <div>
                  <span>Virman {index + 1}</span>
                  <strong>{order.typeLabel}</strong>
                </div>
                {errors.length === 0 ? (
                  <span className="status-pill status-pill--success">Spremno</span>
                ) : (
                  <span className="status-pill status-pill--warning">Za dopunu</span>
                )}
              </header>

              <div className="payroll-payment-order-form">
                <div className="payroll-payment-order-form-title">KREDITNI NALOG</div>

                <div className="payroll-payment-order-form-group payroll-payment-order-form-payer">
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "payerName", event.target.value)} value={order.payerName} />
                    <span>Nalogodavac — naziv</span>
                  </label>
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "payerLocation", event.target.value)} value={textValue(order.payerLocation)} />
                    <span>Nalogodavac — mjesto</span>
                  </label>
                </div>

                <label className="payroll-payment-order-form-payer-account">
                  <input disabled={!canEdit} onChange={(event) => updateText(order.id, "payerAccount", event.target.value)} value={textValue(order.payerAccount)} />
                  <span>Broj računa nalogodavca</span>
                </label>

                <label className="payroll-payment-order-form-purpose">
                  <textarea disabled={!canEdit} onChange={(event) => updateText(order.id, "purpose", event.target.value)} rows={3} value={order.purpose} />
                  <span>Svrha plaćanja</span>
                </label>

                <div className="payroll-payment-order-form-row payroll-payment-order-form-debit">
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "debitReferenceModel", event.target.value)} value={textValue(order.debitReferenceModel)} />
                    <span>Model</span>
                  </label>
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "debitReference", event.target.value)} value={textValue(order.debitReference)} />
                    <span>Poziv na broj zaduženja</span>
                  </label>
                </div>

                <div className="payroll-payment-order-form-row payroll-payment-order-form-amount">
                  <label>
                    <input disabled={!canEdit} inputMode="decimal" onChange={(event) => updateAmount(order.id, event.target.value)} step="0.01" type="number" value={(order.amountCent / 100).toFixed(2)} />
                    <span>Iznos (EUR)</span>
                  </label>
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "paymentCode", event.target.value)} value={textValue(order.paymentCode)} />
                    <span>Šifra transakcije</span>
                  </label>
                </div>

                <div className="payroll-payment-order-form-group payroll-payment-order-form-recipient">
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "recipientName", event.target.value)} value={order.recipientName} />
                    <span>Primalac — naziv</span>
                  </label>
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "recipientLocation", event.target.value)} value={textValue(order.recipientLocation)} />
                    <span>Primalac — mjesto</span>
                  </label>
                </div>

                <label className="payroll-payment-order-form-recipient-account">
                  <input disabled={!canEdit} onChange={(event) => updateText(order.id, "recipientAccount", event.target.value)} value={textValue(order.recipientAccount)} />
                  <span>Broj računa primaoca</span>
                </label>

                <div className="payroll-payment-order-form-row payroll-payment-order-form-credit">
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "creditReferenceModel", event.target.value)} value={textValue(order.creditReferenceModel)} />
                    <span>Model</span>
                  </label>
                  <label>
                    <input disabled={!canEdit} onChange={(event) => updateText(order.id, "creditReference", event.target.value)} value={textValue(order.creditReference)} />
                    <span>Poziv na broj odobrenja</span>
                  </label>
                </div>

                <label className="payroll-payment-order-form-date">
                  <input disabled={!canEdit} onChange={(event) => updateText(order.id, "paymentDate", event.target.value)} type="date" value={textValue(order.paymentDate)} />
                  <span>Datum valute</span>
                </label>
              </div>

              {errors.length > 0 ? (
                <div className="control-issues">
                  {errors.map((error) => <small key={error}>{error}</small>)}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
