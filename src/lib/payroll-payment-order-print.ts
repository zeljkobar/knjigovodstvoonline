import type { PayrollPaymentOrder } from "./payroll-documents";

export type PayrollPaymentOrderPrintRow = Omit<PayrollPaymentOrder, "paymentDate"> & {
  paymentDate: string | null;
};

const EDITABLE_FIELDS = [
  "payerName",
  "payerLocation",
  "payerAccount",
  "purpose",
  "recipientName",
  "recipientLocation",
  "recipientAccount",
  "amountCent",
  "paymentCode",
  "debitReferenceModel",
  "debitReference",
  "creditReferenceModel",
  "creditReference",
  "paymentDate"
] as const;

export function serializePayrollPaymentOrder(
  order: PayrollPaymentOrder
): PayrollPaymentOrderPrintRow {
  return {
    ...order,
    paymentDate: order.paymentDate?.toISOString().slice(0, 10) ?? null
  };
}

export function payrollPaymentOrderStorageKey(calculationId: string) {
  return `payroll-payment-orders-print-v1:${calculationId}`;
}

export function mergeStoredPayrollPaymentOrders(
  initialOrders: PayrollPaymentOrderPrintRow[],
  storedValue: unknown
) {
  if (!Array.isArray(storedValue)) return initialOrders;

  const storedById = new Map(
    storedValue
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
      .map((row) => [String(row.id ?? ""), row])
  );

  return initialOrders.map((initial) => {
    const stored = storedById.get(initial.id);
    if (!stored) return initial;

    const merged = { ...initial } as PayrollPaymentOrderPrintRow;
    for (const field of EDITABLE_FIELDS) {
      const value = stored[field];
      if (field === "amountCent") {
        const amount = Number(value);
        if (Number.isFinite(amount)) merged.amountCent = Math.round(amount);
        continue;
      }
      if (typeof value === "string" || value === null) {
        (merged as Record<string, unknown>)[field] = value;
      }
    }
    return merged;
  });
}

export function payrollPaymentOrderErrors(order: PayrollPaymentOrderPrintRow) {
  const errors = order.errors.filter(
    (error) =>
      error !== "Firma nema aktivan bankovni račun." &&
      error !== "Nedostaje račun primaoca."
  );

  if (!order.payerAccount?.trim()) errors.push("Nedostaje račun nalogodavca.");
  if (!order.recipientAccount?.trim()) errors.push("Nedostaje račun primaoca.");
  if (!order.payerName.trim()) errors.push("Nedostaje naziv nalogodavca.");
  if (!order.recipientName.trim()) errors.push("Nedostaje naziv primaoca.");
  if (!order.purpose.trim()) errors.push("Nedostaje svrha plaćanja.");
  if (order.amountCent <= 0) errors.push("Iznos mora biti veći od nule.");

  return Array.from(new Set(errors));
}
