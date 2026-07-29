import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";

export type MaprInvoiceItem = {
  sourceLineKey: string;
  externalKey: string;
  id: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceBeforeVat: number;
  unitPriceAfterVat: number;
  rebate: number;
  rebateReducing: boolean;
  priceBeforeVat: number;
  vatRate: number;
  vatAmount: number;
  priceAfterVat: number;
};

export type MaprInvoice = {
  seller: {
    name: string;
    tin: string;
  };
  buyer: {
    name: string;
    tin: string;
  } | null;
  identifiers: {
    iic: string;
    fic: string;
    tin: string;
    dateTimeCreated: string;
    qrDateTimeCreated: string;
    qrUrl: string;
  };
  taxes: {
    vatRate: number;
    priceBeforeVat: number;
    vatAmount: number;
  }[];
  totalWithoutVat: number;
  totalVat: number;
  total: number;
  invoiceNumber: string;
  items: MaprInvoiceItem[];
};

export class MaprInvoiceError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = "MaprInvoiceError";
  }
}

function normalizePib(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

export function normalizeMaprItemText(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function maprExternalItemKey(input: {
  code: unknown;
  name: unknown;
  unit: unknown;
  vatRate: unknown;
}) {
  const code = normalizeMaprItemText(input.code);
  if (code) return `CODE:${code}`;

  return [
    "ITEM",
    normalizeMaprItemText(input.name),
    normalizeMaprItemText(input.unit),
    Number(input.vatRate ?? 0).toFixed(2)
  ].join(":");
}

function fiscalSearchParams(qrUrl: string) {
  let url: URL;
  try {
    url = new URL(qrUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "mapr.tax.gov.me") return null;
  const queryFromSearch = url.search ? url.search.slice(1) : "";
  const hashQueryIndex = url.hash.indexOf("?");
  const queryFromHash = hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "";
  const query = queryFromSearch || queryFromHash;

  return query ? new URLSearchParams(query) : null;
}

function dateTimeForMapr(crtd: string) {
  return crtd.replace(/\+(\d{2}:\d{2})$/, " $1");
}

function party(invoice: Record<string, unknown>, key: string) {
  const value = invoice[key] as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;

  const name = String(value.name ?? value.nameAddress ?? "").trim();
  const tin = normalizePib(value.idNum ?? value.tin);
  return name || tin ? { name, tin } : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchMaprInvoice(qrUrl: string, timeoutMs = 20000): Promise<MaprInvoice> {
  const cleanUrl = qrUrl.trim();
  const params = fiscalSearchParams(cleanUrl);
  if (!params) throw new MaprInvoiceError("Neispravan fiskalni MAPR link.", 400);

  const iic = params.get("iic");
  const tin = params.get("tin");
  const crtd = params.get("crtd");
  if (!iic || !tin || !crtd) {
    throw new MaprInvoiceError("MAPR link ne sadrži iic, PIB ili datum računa.", 400);
  }

  const formBody = new URLSearchParams();
  formBody.append("iic", iic);
  formBody.append("tin", tin);
  formBody.append("dateTimeCreated", dateTimeForMapr(crtd));

  let response: Response;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    response = await fetch("https://mapr.tax.gov.me/ic/api/verifyInvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: formBody,
      signal: controller.signal,
      cache: "no-store"
    });
  } catch {
    throw new MaprInvoiceError("Greška pri komunikaciji sa MAPR servisom.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new MaprInvoiceError("MAPR servis nije dostupan.");
  }

  const invoice = (await response.json()) as Record<string, unknown>;
  const seller = party(invoice, "seller") ?? { name: "", tin: normalizePib(tin) };
  const buyer = party(invoice, "buyer");
  const sameTaxes = Array.isArray(invoice.sameTaxes)
    ? (invoice.sameTaxes as Array<Record<string, unknown>>)
    : [];
  const rawItems = Array.isArray(invoice.items)
    ? (invoice.items as Array<Record<string, unknown>>)
    : [];
  const items = rawItems.map((item, index) => {
    const code = String(item.code ?? "").trim();
    const name = String(item.name ?? "").trim();
    const unit = String(item.unit ?? "").trim();
    const vatRate = number(item.vatRate);
    const id = String(item.id ?? "");

    return {
      sourceLineKey: id ? `ID:${id}` : `ROW:${index + 1}`,
      externalKey: maprExternalItemKey({ code, name, unit, vatRate }),
      id,
      code,
      name,
      unit,
      quantity: number(item.quantity),
      unitPriceBeforeVat: number(item.unitPriceBeforeVat),
      unitPriceAfterVat: number(item.unitPriceAfterVat),
      rebate: number(item.rebate),
      rebateReducing: Boolean(item.rebateReducing),
      priceBeforeVat: number(item.priceBeforeVat),
      vatRate,
      vatAmount: number(item.vatAmount),
      priceAfterVat: number(item.priceAfterVat)
    };
  });

  if (!items.length) {
    throw new MaprInvoiceError("MAPR račun nema stavke koje se mogu prenijeti u kalkulaciju.", 422);
  }

  return {
    seller: {
      name: seller.name,
      tin: normalizePib(seller.tin || tin)
    },
    buyer,
    identifiers: {
      iic: String(invoice.iic ?? iic),
      fic: String(invoice.fic ?? ""),
      tin: normalizePib(tin),
      dateTimeCreated: String(invoice.dateTimeCreated ?? crtd),
      qrDateTimeCreated: crtd,
      qrUrl: cleanUrl
    },
    taxes: sameTaxes.map((tax) => ({
      vatRate: number(tax.vatRate),
      priceBeforeVat: number(tax.priceBeforeVat),
      vatAmount: number(tax.vatAmount)
    })),
    totalWithoutVat: number(invoice.totalPriceWithoutVAT),
    totalVat: number(invoice.totalVATAmount),
    total: number(invoice.totalPriceToPay ?? invoice.totalPrice),
    invoiceNumber: normalizeFiscalInvoiceNumber(String(invoice.invoiceNumber ?? "")),
    items
  };
}
