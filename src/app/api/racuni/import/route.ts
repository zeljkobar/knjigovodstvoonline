import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { importInvoiceLinks, InvoiceImportError } from "@/lib/invoice-import-service";
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.agencija_id || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  const work = await readWorkContext();
  if (!work.firmaId || !work.poslovnaGodinaId) return NextResponse.json({ message: "Izaberite firmu i poslovnu godinu." }, { status: 400 });
  try {
    const result = await importInvoiceLinks({ ...await request.json(), automation: false }, { userId: user.id, agencyId: user.agencija_id, companyId: work.firmaId, yearId: work.poslovnaGodinaId, expectedRole: user.rola });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InvoiceImportError) return NextResponse.json({ message: error.message }, { status: error.status });
    if (error instanceof Error && error.message === "INVOICE_ACCESS_DENIED") return NextResponse.json({ message: "Aktivni pristup je promijenjen. Osvježite stranicu." }, { status: 400 });
    throw error;
  }
}
