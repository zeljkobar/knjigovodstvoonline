"use client";

import { useEffect, useState } from "react";
import {
  vatTransactionLabels,
  vatTransactionOptions,
  vatTransactionTypes,
  type VatTransactionType
} from "@/lib/vat-transaction";

type VatTransactionTypeSelectProps = {
  disabled?: boolean;
  documentType: "KUF" | "KIF";
  initialValue?: string | null;
};

function suggestedType(documentType: "KUF" | "KIF", partnerIsForeign: boolean) {
  if (!partnerIsForeign) {
    return vatTransactionTypes.domestic;
  }

  return documentType === "KUF" ? vatTransactionTypes.import : vatTransactionTypes.export;
}

export function VatTransactionTypeSelect({
  disabled = false,
  documentType,
  initialValue
}: VatTransactionTypeSelectProps) {
  const fallback = suggestedType(documentType, false);
  const [value, setValue] = useState<VatTransactionType>(
    (initialValue as VatTransactionType | null) ?? fallback
  );
  const [warning, setWarning] = useState("");

  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent("vat-transaction-type-changed", {
        detail: { documentType, value }
      })
    );
  }, [documentType, value]);

  useEffect(() => {
    function handlePartnerSelected(event: Event) {
      const detail = (event as CustomEvent<{ isForeign?: boolean }>).detail;
      const partnerIsForeign = Boolean(detail?.isForeign);
      const nextValue = suggestedType(documentType, partnerIsForeign);

      setValue(nextValue);
      setWarning(
        partnerIsForeign
          ? documentType === "KUF"
            ? "Dobavljač je označen kao ino, predložen je uvoz."
            : "Kupac je označen kao ino, predložen je izvoz."
          : ""
      );
    }

    document.addEventListener("partner-selected", handlePartnerSelected);
    return () => document.removeEventListener("partner-selected", handlePartnerSelected);
  }, [documentType]);

  return (
    <label>
      <span>Tip PDV prometa</span>
      <select
        disabled={disabled}
        name="vat_transaction_type"
        value={value}
        onChange={(event) => {
          setValue(event.target.value as VatTransactionType);
          setWarning("");
        }}
      >
        {vatTransactionOptions(documentType).map((option) => (
          <option key={option} value={option}>
            {vatTransactionLabels[option]}
          </option>
        ))}
      </select>
      {warning ? <small>{warning}</small> : null}
    </label>
  );
}
