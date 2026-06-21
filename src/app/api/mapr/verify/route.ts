import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

function fiscalSearchParams(qrUrl: string) {
  let url: URL;

  try {
    url = new URL(qrUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "mapr.tax.gov.me") {
    return null;
  }

  const queryFromSearch = url.search ? url.search.slice(1) : "";
  const hashQueryIndex = url.hash.indexOf("?");
  const queryFromHash = hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "";
  const query = queryFromSearch || queryFromHash;

  return query ? new URLSearchParams(query) : null;
}

function dateTimeForMapr(crtd: string) {
  return crtd.replace(/\+(\d{2}:\d{2})$/, " $1");
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) {
    return NextResponse.json({ success: false, message: "Niste prijavljeni." }, { status: 401 });
  }

  let qrUrl: string;
  try {
    const body = await req.json();
    qrUrl = String(body?.qrUrl ?? "").trim();
  } catch {
    return NextResponse.json({ success: false, message: "Neispravan zahtjev." }, { status: 400 });
  }

  if (!qrUrl) {
    return NextResponse.json({ success: false, message: "Nedostaje qrUrl." }, { status: 400 });
  }

  const params = fiscalSearchParams(qrUrl);
  if (!params) {
    return NextResponse.json({ success: false, message: "Neispravan fiskalni URL." }, { status: 400 });
  }

  const iic = params.get("iic");
  const tin = params.get("tin");
  const crtd = params.get("crtd");

  if (!iic || !tin || !crtd) {
    return NextResponse.json({ success: false, message: "URL ne sadrži iic, tin ili crtd." }, { status: 400 });
  }

  const formBody = new URLSearchParams();
  formBody.append("iic", iic);
  formBody.append("tin", tin);
  formBody.append("dateTimeCreated", dateTimeForMapr(crtd));

  let invoice: Record<string, unknown>;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const maprRes = await fetch("https://mapr.tax.gov.me/ic/api/verifyInvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!maprRes.ok) {
      return NextResponse.json(
        { success: false, message: "MAPR servis nije dostupan." },
        { status: 502 }
      );
    }

    invoice = await maprRes.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Greška pri komunikaciji sa MAPR-om." },
      { status: 502 }
    );
  }

  type SameTax = { vatRate: unknown; priceBeforeVat: unknown; vatAmount: unknown };
  const sameTaxes = Array.isArray(invoice.sameTaxes) ? (invoice.sameTaxes as SameTax[]) : [];
  const seller = invoice.seller as Record<string, unknown> | null;

  return NextResponse.json({
    success: true,
    seller: {
      name: String(seller?.name ?? ""),
      tin: String(seller?.idNum ?? tin),
    },
    identifiers: {
      iic: String(invoice.iic ?? iic),
      fic: String(invoice.fic ?? ""),
      tin,
      dateTimeCreated: String(invoice.dateTimeCreated ?? crtd),
      qrUrl
    },
    taxes: sameTaxes.map((t) => ({
      vatRate: Number(t.vatRate),
      priceBeforeVat: Number(t.priceBeforeVat),
      vatAmount: Number(t.vatAmount),
    })),
    total: Number(invoice.totalPriceToPay ?? invoice.totalPrice ?? 0),
    invoiceNumber: String(invoice.invoiceNumber ?? ""),
  });
}
