import { NextResponse } from "next/server";
import { fiscalPortalContext, fiscalPortalDevices, savedFiscalPortal } from "@/lib/fiscal-portals";
import { PazarImportError } from "@/lib/pazar-import-policy";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const ctx = await fiscalPortalContext("create", new URL(request.url).searchParams.get("firma") ?? "");
    const config = await savedFiscalPortal(ctx), devices = await fiscalPortalDevices(ctx, config);
    const current = await fiscalPortalContext("create", ctx.firm.id), latest = await savedFiscalPortal(current);
    if (current.user.id !== ctx.user.id || latest.id !== config.id || latest.updated_at.getTime() !== config.updated_at.getTime()) throw new PazarImportError("Podešavanja su promijenjena. Ponovite provjeru.");
    await prisma.$transaction(tx => auditLogInTransaction(tx, { korisnikId: ctx.user.id, agencijaId: ctx.agencyId, firmaId: ctx.firm.id, modul: "izlazni_racuni", akcija: "FISCAL_PORTAL_TEST", tipEntiteta: "FirmaFiskalniPortal", entitetId: config.id, novaVrijednost: { provider: config.provider, deviceCount: devices.length } }));
    return NextResponse.json({ devices, provider: config.provider, defaultDevice: config.podrazumijevana_kasa }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ message: error instanceof PazarImportError ? error.message : "Provjera portala nije uspjela. Provjerite podešavanja." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
}
