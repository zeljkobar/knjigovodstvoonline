"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  mergeStoredPayrollPaymentOrders,
  payrollPaymentOrderErrors,
  payrollPaymentOrderStorageKey,
  type PayrollPaymentOrderPrintRow
} from "@/lib/payroll-payment-order-print";

const MARGIN_STORAGE_KEY = "payroll-virman-print-settings-v1";
const DEFAULT_TOP_MARGIN = 7;
const DEFAULT_LEFT_MARGIN = 7;
const DEFAULT_SLOT_STEP = 101.21;

type SavedSettings = {
  topMargin: number;
  leftMargin: number;
  slotStep: number;
};

function safeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value / 100);
}

function chunkOrders(orders: PayrollPaymentOrderPrintRow[]) {
  const pages: PayrollPaymentOrderPrintRow[][] = [];
  for (let index = 0; index < orders.length; index += 3) {
    pages.push(orders.slice(index, index + 3));
  }
  return pages;
}

function VirmanField({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`payroll-virman-field ${className}`}>{children}</span>;
}

function Virman({
  order,
  slot,
  isPreview
}: {
  order: PayrollPaymentOrderPrintRow;
  slot: number;
  isPreview: boolean;
}) {
  return (
    <section className="payroll-virman-slot" data-slot={slot}>
      {isPreview ? <span className="payroll-virman-watermark">NACRT</span> : null}

      <VirmanField className="payroll-virman-payer-account">{order.payerAccount}</VirmanField>
      <VirmanField className="payroll-virman-payer">
        <span>{order.payerName}</span>
        {order.payerLocation ? <span>{order.payerLocation}</span> : null}
      </VirmanField>

      {order.debitReferenceModel ? (
        <VirmanField className="payroll-virman-debit-model">{order.debitReferenceModel}</VirmanField>
      ) : null}
      {order.debitReference ? (
        <VirmanField className="payroll-virman-debit-reference">{order.debitReference}</VirmanField>
      ) : null}

      <VirmanField className="payroll-virman-amount">= {money(order.amountCent)} -</VirmanField>
      {order.paymentCode ? (
        <VirmanField className="payroll-virman-payment-code">{order.paymentCode}</VirmanField>
      ) : null}

      <VirmanField className="payroll-virman-purpose">{order.purpose}</VirmanField>
      <VirmanField className="payroll-virman-recipient-account">{order.recipientAccount}</VirmanField>
      <VirmanField
        className={`payroll-virman-recipient${
          order.type === "NET_SALARY" ? " payroll-virman-uppercase" : ""
        }`}
      >
        <span>{order.recipientName}</span>
        {order.recipientLocation ? <span>{order.recipientLocation}</span> : null}
      </VirmanField>

      {order.creditReferenceModel ? (
        <VirmanField className="payroll-virman-credit-model">{order.creditReferenceModel}</VirmanField>
      ) : null}
      {order.creditReference ? (
        <VirmanField className="payroll-virman-credit-reference">{order.creditReference}</VirmanField>
      ) : null}
    </section>
  );
}

export function PayrollVirmanPrintControls({
  backHref,
  calculationId,
  initialOrders,
  isPreview
}: {
  backHref: string;
  calculationId: string;
  initialOrders: PayrollPaymentOrderPrintRow[];
  isPreview: boolean;
}) {
  const [topMargin, setTopMargin] = useState(DEFAULT_TOP_MARGIN);
  const [leftMargin, setLeftMargin] = useState(DEFAULT_LEFT_MARGIN);
  const [slotStep, setSlotStep] = useState(DEFAULT_SLOT_STEP);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [orders, setOrders] = useState(initialOrders);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(MARGIN_STORAGE_KEY) ?? "null") as
        | Partial<SavedSettings>
        | null;
      if (saved) {
        setTopMargin(safeNumber(saved.topMargin, DEFAULT_TOP_MARGIN));
        setLeftMargin(safeNumber(saved.leftMargin, DEFAULT_LEFT_MARGIN));
        setSlotStep(safeNumber(saved.slotStep, DEFAULT_SLOT_STEP));
      }
    } catch {
      // Neispravna lokalna postavka ne smije blokirati stampu.
    } finally {
      setSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(payrollPaymentOrderStorageKey(calculationId)) ?? "null"
      );
      setOrders(mergeStoredPayrollPaymentOrders(initialOrders, stored));
    } catch {
      setOrders(initialOrders);
    }
  }, [calculationId, initialOrders]);

  useEffect(() => {
    if (!settingsLoaded) return;
    window.localStorage.setItem(
      MARGIN_STORAGE_KEY,
      JSON.stringify({ topMargin, leftMargin, slotStep } satisfies SavedSettings)
    );
  }, [leftMargin, settingsLoaded, slotStep, topMargin]);

  const readyOrders = useMemo(
    () => orders.filter((order) => payrollPaymentOrderErrors(order).length === 0),
    [orders]
  );
  const pages = chunkOrders(readyOrders);
  const omittedCount = orders.length - readyOrders.length;

  const resetMargins = () => {
    setTopMargin(DEFAULT_TOP_MARGIN);
    setLeftMargin(DEFAULT_LEFT_MARGIN);
    setSlotStep(DEFAULT_SLOT_STEP);
  };

  const style = {
    "--virman-margin-top": `${topMargin}mm`,
    "--virman-margin-left": `${leftMargin}mm`,
    "--virman-slot-two": `${slotStep}mm`,
    "--virman-slot-three": `${slotStep * 2}mm`
  } as CSSProperties;

  return (
    <main className="print-page payroll-virman-print-page" style={style}>
      <div className="print-toolbar payroll-virman-toolbar">
        <Link className="print-button print-back-button" href={backHref}>
          Nazad na pregled
        </Link>
        <label>
          <span>Gornja margina (mm)</span>
          <input max="40" min="-20" onChange={(event) => setTopMargin(safeNumber(event.target.value, DEFAULT_TOP_MARGIN))} step="0.5" type="number" value={topMargin} />
        </label>
        <label>
          <span>Lijeva margina (mm)</span>
          <input max="40" min="-20" onChange={(event) => setLeftMargin(safeNumber(event.target.value, DEFAULT_LEFT_MARGIN))} step="0.5" type="number" value={leftMargin} />
        </label>
        <label>
          <span>Razmak virmana (mm)</span>
          <input max="110" min="95" onChange={(event) => setSlotStep(safeNumber(event.target.value, DEFAULT_SLOT_STEP))} step="0.1" type="number" value={slotStep} />
        </label>
        <button className="print-button print-back-button" onClick={resetMargins} type="button">
          Vrati 7 / 7 mm
        </button>
        {omittedCount > 0 ? <span className="payroll-payment-order-omitted">Preskočeno: {omittedCount}</span> : null}
        <button className="print-button" disabled={readyOrders.length === 0} onClick={() => window.print()} type="button">
          Štampaj virmane
        </button>
      </div>
      <p className="payroll-virman-print-note">
        Štampajte na 100%, bez zaglavlja i podnožja browsera. Margine browsera postavite na
        „Nema”; korekciju položaja uradite poljima iznad.
      </p>

      {pages.length === 0 ? (
        <section className="payroll-virman-empty">
          <h1>Nema naloga spremnih za štampu</h1>
          <p>Vratite se na pregled i dopunite obavezna polja.</p>
        </section>
      ) : null}

      {pages.map((pageOrders, pageIndex) => (
        <div className="payroll-virman-sheet" key={`virman-page-${pageIndex + 1}`}>
          {pageOrders.map((order, slot) => (
            <Virman isPreview={isPreview} key={order.id} order={order} slot={slot} />
          ))}
        </div>
      ))}
    </main>
  );
}
