import { decimalToScaled } from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";

export const posPaymentLabels: Record<string, string> = {
  CASH: "Gotovina",
  CARD: "Kartica",
  BANK_TRANSFER: "Virman",
  OTHER: "Ostalo"
};

export function posMoney(cents: bigint) {
  return (Number(cents) / 100).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function posQuantity(milli: bigint) {
  return (Number(milli) / 1000).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

export function posReportDates(year: number, from?: string, to?: string) {
  const today = new Date();
  const defaultDate = today.getFullYear() === year
    ? `${year}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    : `${year}-01-01`;
  const valid = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.startsWith(`${year}-`) ? value : defaultDate;
  const fromValue = valid(from)!;
  const toValue = valid(to)!;
  const start = new Date(`${fromValue}T00:00:00`);
  const end = new Date(`${toValue}T23:59:59.999`);
  return start <= end
    ? { from: fromValue, to: toValue, start, end }
    : { from: toValue, to: fromValue, start: new Date(`${toValue}T00:00:00`), end: new Date(`${fromValue}T23:59:59.999`) };
}

export async function loadPosReport(input: {
  agencijaId: string;
  firmaId: string;
  yearId: string;
  start: Date;
  end: Date;
  registerId?: string;
}) {
  const invoices = await prisma.fiskalniIzlazniRacun.findMany({
    where: {
      agencija_id: input.agencijaId,
      firma_id: input.firmaId,
      poslovna_godina_id: input.yearId,
      sales_channel: "POS",
      document_type: { in: ["POS_RECEIPT", "POS_RETURN"] },
      fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
      issued_at: { gte: input.start, lte: input.end },
      ...(input.registerId ? { pos_register_id: input.registerId } : {}),
      is_deleted: false
    },
    include: {
      pos_register: { select: { id: true, naziv: true, sifra: true } },
      placanja: true,
      poreske_stavke: true,
      stavke: { include: { artikal: { select: { id: true } } } }
    },
    orderBy: { issued_at: "asc" }
  });

  let base = BigInt(0), vat = BigInt(0), gross = BigInt(0);
  const payments = new Map<string, bigint>();
  const taxes = new Map<string, { rate: string; base: bigint; vat: bigint; gross: bigint }>();
  const registers = new Map<string, { name: string; count: number; gross: bigint }>();
  const items = new Map<string, { code: string; name: string; unit: string; quantity: bigint; gross: bigint }>();

  for (const invoice of invoices) {
    base += decimalToScaled(invoice.ukupno_osnovica, 2);
    vat += decimalToScaled(invoice.ukupno_izlazni_pdv, 2);
    gross += decimalToScaled(invoice.ukupno_sa_pdv, 2);
    for (const payment of invoice.placanja) {
      payments.set(payment.payment_method, (payments.get(payment.payment_method) ?? BigInt(0)) + decimalToScaled(payment.amount, 2));
    }
    for (const tax of invoice.poreske_stavke) {
      const key = tax.vat_rate_percent.toString();
      const row = taxes.get(key) ?? { rate: key, base: BigInt(0), vat: BigInt(0), gross: BigInt(0) };
      row.base += decimalToScaled(tax.tax_base, 2);
      row.vat += decimalToScaled(tax.output_vat_amount, 2);
      row.gross += decimalToScaled(tax.total_with_vat, 2);
      taxes.set(key, row);
    }
    const registerKey = invoice.pos_register?.id ?? "bez-kase";
    const register = registers.get(registerKey) ?? { name: invoice.pos_register?.naziv ?? "Bez kase", count: 0, gross: BigInt(0) };
    register.count += 1;
    register.gross += decimalToScaled(invoice.ukupno_sa_pdv, 2);
    registers.set(registerKey, register);
    for (const line of invoice.stavke) {
      const item = items.get(line.artikal_id) ?? { code: line.sifra_artikla, name: line.naziv_artikla, unit: line.jedinica_mjere, quantity: BigInt(0), gross: BigInt(0) };
      item.quantity += decimalToScaled(line.kolicina, 3);
      item.gross += decimalToScaled(line.ukupno_sa_pdv, 2);
      items.set(line.artikal_id, item);
    }
  }

  return {
    invoices,
    totals: {
      count: invoices.length,
      sales: invoices.filter((invoice) => invoice.document_type === "POS_RECEIPT").length,
      returns: invoices.filter((invoice) => invoice.document_type === "POS_RETURN").length,
      base, vat, gross
    },
    payments: [...payments].map(([method, amount]) => ({ method, amount })).sort((a, b) => a.method.localeCompare(b.method)),
    taxes: [...taxes.values()].sort((a, b) => Number(b.rate) - Number(a.rate)),
    registers: [...registers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    items: [...items.values()].sort((a, b) => a.gross === b.gross ? 0 : a.gross > b.gross ? -1 : 1)
  };
}
