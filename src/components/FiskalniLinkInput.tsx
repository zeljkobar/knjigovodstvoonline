"use client";

import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { useState } from "react";

type Status = { type: "ok" | "warn" | "error" | ""; message: string };

function setFormValue(form: HTMLFormElement, name: string, value?: string) {
  const field = form.elements.namedItem(name);
  const cleanValue = String(value ?? "").trim();

  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    field.value = cleanValue;
  }
}

function fiscalSearchParams(url: URL) {
  const queryFromSearch = url.search ? url.search.slice(1) : "";
  const hashQueryIndex = url.hash.indexOf("?");
  const queryFromHash = hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "";
  const query = queryFromSearch || queryFromHash;

  return query ? new URLSearchParams(query) : null;
}

export function FiskalniLinkInput({ formId }: { formId: string }) {
  const [status, setStatus] = useState<Status>({ type: "", message: "" });

  function parse(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setStatus({ type: "", message: "" });
      clearFormDataset();
      return;
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      setStatus({ type: "error", message: "Neispravan fiskalni link." });
      clearFormDataset();
      return;
    }

    if (url.hostname !== "mapr.tax.gov.me") {
      setStatus({ type: "error", message: "Link nije sa mapr.tax.gov.me." });
      clearFormDataset();
      return;
    }

    const params = fiscalSearchParams(url);
    if (!params) {
      setStatus({ type: "error", message: "Neispravan fiskalni link." });
      clearFormDataset();
      return;
    }

    const iic = params.get("iic");
    const tin = params.get("tin");
    const prc = params.get("prc");
    const crtd = params.get("crtd");
    const ord = params.get("ord");
    const bu = params.get("bu");
    const cr = params.get("cr");

    if (!iic || !tin || !prc || !crtd) {
      setStatus({ type: "error", message: "Link ne sadrži iic, PIB, datum ili iznos." });
      clearFormDataset();
      return;
    }

    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    // Sačuvaj URL u dataset da ga FiskalniUcitajButton može koristiti
    form.dataset.fiskalniUrl = trimmed;

    setFormValue(form, "fiscal_iic", iic);
    setFormValue(form, "fiscal_seller_tin", tin);
    setFormValue(form, "fiscal_datetime", crtd);
    setFormValue(form, "fiscal_source_url", trimmed);

    document.dispatchEvent(
      new CustomEvent("fiscal-supplier-detected", { detail: { tin } })
    );

    // Datum
    const dateStr = crtd.slice(0, 10);
    const invoiceDateInput = form.querySelector<HTMLInputElement>('input[name="invoice_date"]');
    if (invoiceDateInput) invoiceDateInput.value = dateStr;
    const receiptDateInput = form.querySelector<HTMLInputElement>('input[name="receipt_date"]');
    if (receiptDateInput) receiptDateInput.value = dateStr;

    // Broj računa
    const year = crtd.slice(0, 4);
    const invoiceNumber = normalizeFiscalInvoiceNumber(`${bu}/${ord}/${year}/${cr}`);
    const invNumInput = form.querySelector<HTMLInputElement>('input[name="supplier_invoice_number"]');
    if (invNumInput) invNumInput.value = invoiceNumber;

    // Pošalji ukupan iznos KufTaxLinesForm-u (bez PDV raščlambe)
    document.dispatchEvent(
      new CustomEvent("fiscal-link-parsed", { detail: { total: prc } })
    );

    setStatus({
      type: "ok",
      message: `Link je učitan. Dobavljač se traži po PIB-u ${tin}. Za tačan PDV kliknite F8.`
    });
  }

  function clearFormDataset() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (form) {
      delete form.dataset.fiskalniUrl;
      setFormValue(form, "fiscal_iic", "");
      setFormValue(form, "fiscal_fic", "");
      setFormValue(form, "fiscal_seller_tin", "");
      setFormValue(form, "fiscal_datetime", "");
      setFormValue(form, "fiscal_source_url", "");
    }
  }

  return (
    <div className="fiskalni-link-section form-wide">
      <label>
        <span>Fiskalni link (QR kod)</span>
        <input
          autoComplete="off"
          placeholder="Nalijepite ili skenirajte fiskalni link..."
          type="url"
          onChange={(e) => parse(e.target.value)}
        />
      </label>
      {status.message ? (
        <p className={`fiskalni-status fiskalni-status--${status.type}`}>{status.message}</p>
      ) : null}
    </div>
  );
}
