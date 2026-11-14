import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { dokumentaContext, DokumentaError, linkKufDocument, readFiscalLink, uuidPattern } from "@/lib/dokumentacija";
import { importInvoiceLinks, InvoiceImportError } from "@/lib/invoice-import-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyId, yearId, userId } = body ?? {};
    const explicitScope = companyId !== undefined || yearId !== undefined || userId !== undefined;
    if (explicitScope && (typeof companyId !== "string" || !uuidPattern.test(companyId) ||
        typeof yearId !== "string" || !uuidPattern.test(yearId))) {
      throw new DokumentaError("Firma ili poslovna godina nije dostupna.");
    }
    const context = await dokumentaContext("update", yearId, companyId);
    if (explicitScope && userId !== context.user.id) throw new DokumentaError("Sesija je promijenjena.", 403);
    const { user, scope } = context;
    if (context.client || !await hasPermission(user, { firmaId: scope.firma_id, modul: "ulazni_racuni", akcija: "create" })) {
      throw new DokumentaError("Nemate pravo obrade KUF računa.", 403);
    }
    if (typeof body?.id !== "string" || !uuidPattern.test(body.id)) throw new DokumentaError("Dokument nije dostupan.");
    const doc = await prisma.primljeniDokument.findFirst({ where: { ...scope, id: body.id, status: "PRIMLJENO" } });
    if (!doc || (doc.kuf_entry_id && !body.entryId)) {
      throw new DokumentaError("Dokument nije dostupan za obradu.");
    }
    const qr = readFiscalLink(doc.qr_link ?? body.qr);
    const accountOverrides = body.supplierAccountCodes;
    if (accountOverrides && (typeof accountOverrides !== "object" ||
        Object.entries(accountOverrides).some(([key, code]) => !/^\d{1,20}$/.test(key) || typeof code !== "string" || code.length > 30))) {
      throw new DokumentaError("Konto nije ispravno unesen.");
    }
    if (!qr) throw new DokumentaError("QR nije pročitan. Otvorite ručni unos.");
    if (body.entryId) {
      if (typeof body.entryId !== "string" || !uuidPattern.test(body.entryId)) throw new DokumentaError("KUF račun nije dostupan.");
      await prisma.$transaction(async tx => {
        const entry = await tx.kufEntry.findFirst({ where: { ...scope, id: body.entryId, is_deleted: false } });
        const link = new URL(qr);
        const params = new URLSearchParams(link.search.slice(1) || link.hash.split("?")[1]);
        if (!entry || entry.fiscal_iic?.toUpperCase() !== params.get("iic")?.toUpperCase() ||
            entry.fiscal_seller_tin !== params.get("tin")?.replace(/\D/g, "")) {
          throw new DokumentaError("Fiskalni podaci postojećeg računa ne odgovaraju dokumentu.");
        }
        await linkKufDocument(tx, scope, doc.id, entry.id, user.id);
      });
      return NextResponse.json({ status: "success", message: "Original je povezan sa KUF računom." });
    }
    if (typeof body.bookId !== "string" || !uuidPattern.test(body.bookId)) throw new DokumentaError("Izaberite KUF knjigu.");
    const result = await importInvoiceLinks({ documentType: "KUF", bookId: body.bookId, links: [qr],
      supplierAccountCodes: accountOverrides }, {
      userId: user.id, agencyId: scope.agencija_id, companyId: scope.firma_id,
      yearId: scope.poslovna_godina_id, expectedRole: user.rola
    }, undefined, doc.id);
    return NextResponse.json(result.results[0]);
  } catch (error) {
    const known = error instanceof DokumentaError || error instanceof InvoiceImportError;
    return NextResponse.json({ message: known ? error.message : "Obrada nije uspjela. Osvježite stranicu ili otvorite ručni unos." },
      { status: known ? error.status : 500 });
  }
}
