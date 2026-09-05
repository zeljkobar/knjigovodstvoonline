import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import {
  calculateItemPriceAmounts,
  inventoryCentsToDecimal,
  inventoryModule,
  itemPriceTypes,
  normalizeInventoryCode,
  parseInventoryMoneyToCents
} from "@/lib/inventory";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function nullable(value: unknown) {
  return clean(value) || null;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }
  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json({ message: "Ruta nije dostupna u direktnom portalu." }, { status: 403 });
  }
  const agencijaId = user.agencija_id;
  const workContext = await readWorkContext();
  if (!workContext.firmaId) {
    return NextResponse.json({ message: "Izaberite firmu u radnom kontekstu." }, { status: 400 });
  }
  const firmaId = workContext.firmaId;
  const body = (await request.json().catch(() => null)) as {
    barcode?: string;
    code?: string;
    groupId?: string;
    name?: string;
    saleGrossPrice?: string;
    unitId?: string;
    vatRateId?: string;
    service?: boolean;
  } | null;
  const naziv = clean(body?.name);
  const manualCode = normalizeInventoryCode(clean(body?.code));
  const barkod = nullable(body?.barcode);
  const groupId = nullable(body?.groupId);
  const unitId = clean(body?.unitId);
  const vatRateId = clean(body?.vatRateId);
  const saleGrossCents = parseInventoryMoneyToCents(clean(body?.saleGrossPrice));
  const service = body?.service === true;

  if (!naziv || !unitId || !vatRateId || saleGrossCents === null || saleGrossCents <= 0) {
    return NextResponse.json(
      { message: "Naziv, jedinica mjere, PDV stopa i pozitivna prodajna cijena su obavezni." },
      { status: 400 }
    );
  }

  const [firma, allowed, unit, vatRate, group] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: { korisnik_id: user.id, is_deleted: false }
              }
            })
      },
      select: { id: true }
    }),
    hasPermission(user, { firmaId, modul: inventoryModule, akcija: "create" }),
    prisma.jedinicaMjere.findFirst({
      where: { id: unitId, aktivna: true },
      select: { id: true, oznaka: true }
    }),
    prisma.pdvStopa.findFirst({
      where: { id: vatRateId, agencija_id: agencijaId, aktivna: true },
      select: { id: true, procenat: true }
    }),
    groupId
      ? prisma.grupaArtikla.findFirst({
          where: {
            id: groupId,
            agencija_id: agencijaId,
            firma_id: firmaId,
            aktivna: true,
            is_deleted: false
          },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);

  if (!firma || !allowed) {
    return NextResponse.json({ message: "Nemate pravo da dodate artikal." }, { status: 403 });
  }
  if (!unit || !vatRate || (groupId && !group)) {
    return NextResponse.json({ message: "Izabrana grupa, jedinica mjere ili PDV stopa nije dostupna." }, { status: 400 });
  }

  const vatPercent = Number(vatRate.procenat.toString());
  const price = calculateItemPriceAmounts("SA_PDV", saleGrossCents, vatPercent);

  try {
    const item = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtext(${firmaId}),
          hashtext('artikli_sifra')
        )`
      );

      let sifra = manualCode;
      if (!sifra) {
        const rows = await tx.$queryRaw<Array<{ max_code: bigint | null }>>(
          Prisma.sql`SELECT MAX(CAST("sifra" AS bigint)) AS "max_code"
            FROM "artikli"
            WHERE "firma_id" = CAST(${firmaId} AS uuid)
              AND "sifra" ~ '^[0-9]+$'`
        );
        sifra = String(Number(rows[0]?.max_code ?? 0) + 1).padStart(6, "0");
      }

      const duplicate = await tx.artikal.findFirst({
        where: {
          firma_id: firmaId,
          OR: [{ sifra }, ...(barkod ? [{ barkod }] : [])]
        },
        select: { sifra: true, barkod: true }
      });
      if (duplicate?.sifra === sifra) throw new Error("DUPLICATE_CODE");
      if (barkod && duplicate?.barkod === barkod) throw new Error("DUPLICATE_BARCODE");

      const created = await tx.artikal.create({
        data: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          grupa_artikla_id: groupId,
          jedinica_mjere_id: unit.id,
          pdv_stopa_id: vatRate.id,
          sifra,
          naziv,
          barkod,
          usluga: service,
          prati_zalihe: !service,
          created_by: user.id,
          updated_by: user.id
        }
      });
      await tx.cijenaArtikla.create({
        data: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          artikal_id: created.id,
          tip: itemPriceTypes.retail,
          cijena_bez_pdv: inventoryCentsToDecimal(price.netCents),
          cijena_sa_pdv: inventoryCentsToDecimal(price.grossCents),
          pdv_stopa_procenat: vatPercent.toFixed(2),
          valuta: "EUR",
          created_by: user.id,
          updated_by: user.id
        }
      });
      return created;
    });

    await auditLog({
      korisnikId: user.id,
      agencijaId,
      firmaId,
      modul: inventoryModule,
      akcija: "quick_create_item",
      tipEntiteta: "Artikal",
      entitetId: item.id,
      novaVrijednost: { ...item, saleGrossPrice: inventoryCentsToDecimal(price.grossCents) }
    });

    return NextResponse.json({
      item: {
        id: item.id,
        sifra: item.sifra,
        naziv: item.naziv,
        unitCode: unit.oznaka,
        vatPercent: vatRate.procenat.toString(),
        saleGrossPrice: inventoryCentsToDecimal(price.grossCents),
        service
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CODE") {
      return NextResponse.json({ message: "Artikal sa tom šifrom već postoji." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "DUPLICATE_BARCODE") {
      return NextResponse.json({ message: "Artikal sa tim barkodom već postoji." }, { status: 409 });
    }
    console.error("quick item create failed", error);
    return NextResponse.json({ message: "Artikal nije sačuvan." }, { status: 500 });
  }
}
