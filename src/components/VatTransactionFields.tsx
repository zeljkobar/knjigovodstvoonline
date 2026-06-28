"use client";

import { useEffect, useState, type ReactNode } from "react";

type VatTransactionFieldsProps = {
  documentType: "KUF" | "KIF";
  showFor?: string;
  hideFor?: string;
  initialValue?: string | null;
  children: ReactNode;
};

export function VatTransactionFields({
  documentType,
  showFor,
  hideFor,
  initialValue,
  children
}: VatTransactionFieldsProps) {
  const [value, setValue] = useState(initialValue ?? "DOMESTIC");

  useEffect(() => {
    function handleChange(event: Event) {
      const detail = (event as CustomEvent<{ documentType?: string; value?: string }>).detail;

      if (detail?.documentType === documentType && detail.value) {
        setValue(detail.value);
      }
    }

    document.addEventListener("vat-transaction-type-changed", handleChange);
    return () => document.removeEventListener("vat-transaction-type-changed", handleChange);
  }, [documentType]);

  if (showFor !== undefined && value !== showFor) {
    return null;
  }

  if (hideFor !== undefined && value === hideFor) {
    return null;
  }

  return <>{children}</>;
}
