// MAPR rejects fractional seconds (HTTP 404), including Date.toISOString()'s .000Z.
// Keep the original offset and instant; only adapt the wire format.
export function dateTimeForMapr(crtd: string) {
  return crtd.trim().replace(/\.\d+(?=Z$|[+ -]\d{2}:\d{2}$)/, "").replace(/\+(\d{2}:\d{2})$/, " $1");
}

export function maprHttpError(status: number) {
  if (status === 404) return "MAPR nije pronašao račun ili nije prihvatio podatke za provjeru (HTTP 404). Provjerite fiskalni link.";
  if (status === 429) return "MAPR je privremeno ograničio broj zahtjeva (HTTP 429). Pokušajte kasnije.";
  return `MAPR provjera nije uspjela (HTTP ${status}). Pokušajte kasnije.`;
}

// SEP invoices issued outside VAT legitimately omit sameTaxes. Only reconstruct
// the zero-VAT row when the response itself explicitly confirms that treatment
// and all independently reported totals agree; missing tax data alone is not proof.
export function maprTaxRows(invoice: Record<string, unknown>) {
  const rows = Array.isArray(invoice.sameTaxes)
    ? invoice.sameTaxes as Array<Record<string, unknown>>
    : [];
  if (rows.length) {
    return rows.map((tax) => ({
      vatRate: Number(tax.vatRate),
      priceBeforeVat: Number(tax.priceBeforeVat),
      vatAmount: Number(tax.vatAmount)
    }));
  }

  const amount = (value: unknown) =>
    (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
      && Number.isFinite(Number(value)) ? Number(value) : null;
  const total = amount(invoice.totalPrice);
  const base = amount(invoice.totalPriceWithoutVAT);
  const taxFree = amount(invoice.taxFreeAmt);
  const vat = invoice.totalVATAmount == null ? 0 : amount(invoice.totalVATAmount);
  if (invoice.issuerInVat === false && total !== null && total !== 0
    && base === total && taxFree === total && vat === 0) {
    return [{ vatRate: 0, priceBeforeVat: total, vatAmount: 0 }];
  }
  return [];
}
