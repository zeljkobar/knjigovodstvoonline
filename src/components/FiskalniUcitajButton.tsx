"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = "idle" | "loading" | "ok" | "error";

function setFormValue(form: HTMLFormElement, name: string, value?: string | number | null) {
  const field = form.elements.namedItem(name);

  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    field.value = String(value ?? "").trim();
  }
}

export function FiskalniUcitajButton({ formId }: { formId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const ucitajRef = useRef<() => void>(() => undefined);

  const ucitaj = useCallback(async () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const url = form?.dataset.fiskalniUrl;

    if (!url) {
      setStatus("error");
      setMessage("Prvo nalijepite fiskalni link u polje iznad.");
      return;
    }

    setStatus("loading");
    setMessage("Učitavam PDV podatke iz MAPR-a...");

    try {
      const res = await fetch("/api/mapr/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrUrl: url }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message?: string;
        seller?: { name: string; tin: string };
        identifiers?: {
          iic?: string;
          fic?: string;
          tin?: string;
          dateTimeCreated?: string;
          qrUrl?: string;
        };
        taxes?: {
          vatRate: number;
          priceBeforeVat: number;
          vatAmount: number;
        }[];
        total?: number;
        invoiceNumber?: string;
      };

      if (!data.success) {
        setStatus("error");
        setMessage(data.message ?? "Greška pri učitavanju.");
        return;
      }

      document.dispatchEvent(
        new CustomEvent("fiscal-pdv-loaded", {
          detail: { total: data.total, taxes: data.taxes ?? [] },
        }),
      );

      if (form) {
        setFormValue(form, "fiscal_iic", data.identifiers?.iic);
        setFormValue(form, "fiscal_fic", data.identifiers?.fic);
        setFormValue(form, "fiscal_seller_tin", data.identifiers?.tin ?? data.seller?.tin);
        setFormValue(form, "fiscal_datetime", data.identifiers?.dateTimeCreated);
        setFormValue(form, "fiscal_source_url", data.identifiers?.qrUrl ?? url);
        if (data.invoiceNumber) {
          setFormValue(form, "supplier_invoice_number", data.invoiceNumber);
        }
      }

      setStatus("ok");
      setMessage(
        `PDV učitan${data.seller?.name ? ` · ${data.seller.name}` : ""}. Provjerite iznose.`,
      );
    } catch {
      setStatus("error");
      setMessage("Greška pri komunikaciji sa serverom.");
    }
  }, [formId]);

  useEffect(() => {
    ucitajRef.current = () => void ucitaj();
  }, [ucitaj]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F8" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        ucitajRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onMaprLoadRequested() {
      ucitajRef.current();
    }

    document.addEventListener("fiscal-mapr-load-requested", onMaprLoadRequested);
    return () =>
      document.removeEventListener("fiscal-mapr-load-requested", onMaprLoadRequested);
  }, []);

  return (
    <div className="mapr-ucitaj-section">
      {message ? (
        <p
          className={`fiskalni-status fiskalni-status--${status === "loading" ? "" : status === "ok" ? "ok" : "error"}`}
        >
          {message}
        </p>
      ) : null}
      <button
        className="secondary-button"
        disabled={status === "loading"}
        type="button"
        onClick={() => void ucitaj()}
      >
        {status === "loading" ? "Učitavam MAPR..." : "Učitaj PDV iz MAPR-a  F8"}
      </button>
    </div>
  );
}
