import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import {
  calculateItemPriceAmounts,
  inventoryCentsToDecimal,
  inventoryModule,
  itemPriceTypes,
  normalizeInventoryCode,
  parseInventoryMoneyToCents
} from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

const CREATE_ITEM_PERMISSION = {
  modul: inventoryModule,
  akcija: "create"
} as const;

const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 40;
const MAX_BARCODE_LENGTH = 80;
const MAX_DECIMAL_14_2_CENTS = 99_999_999_999_999;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QuickItemBody = {
  barcode?: unknown;
  code?: unknown;
  groupId?: unknown;
  name?: unknown;
  saleGrossPrice?: unknown;
  service?: unknown;
  unitId?: unknown;
  vatRateId?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullable(value: unknown) {
  return clean(value) || null;
}

function validUuid(value: string | null) {
  return value === null || UUID_PATTERN.test(value);
}

async function auditDeniedItemCreate(input: {
  userId: string;
  agencijaId: string;
  firmaId: string;
}) {
  try {
    await auditLog({
      korisnikId: input.userId,
      agencijaId: input.agencijaId,
      firmaId: input.firmaId,
      modul: "portal.artikli",
      akcija: "quick_create_denied",
      tipEntiteta: "Artikal",
      napomena: "Odbijeno: korisnik nema robno:create pravo."
    });
  } catch (error) {
    console.error("portal quick item denied audit failed", error);
  }
}

export async function POST(request: Request) {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  if (context.state !== "READY" || !context.user.agencija_id) {
    return NextResponse.json(
      { message: "Direktni fiskalni portal nije dostupan za ovaj nalog." },
      { status: 403 }
    );
  }

  const agencijaId = context.user.agencija_id;
  const firmaId = context.firma.id;

  if (
    !hasDirectPortalPermission(
      context.permissionKeys,
      CREATE_ITEM_PERMISSION
    )
  ) {
    await auditDeniedItemCreate({
      userId: context.user.id,
      agencijaId,
      firmaId
    });
    return NextResponse.json(
      { message: "Nemate pravo da dodate artikal ili uslugu." },
      { status: 403 }
    );
  }

  const parsedBody = await request.json().catch(() => null);
  const body =
    parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? (parsedBody as QuickItemBody)
      : null;

  if (!body) {
    return NextResponse.json(
      { message: "Podaci za artikal nijesu ispravni." },
      { status: 400 }
    );
  }

  const naziv = clean(body.name);
  const manualCode = normalizeInventoryCode(clean(body.code));
  const barkod = nullable(body.barcode);
  const groupId = nullable(body.groupId);
  const unitId = clean(body.unitId);
  const vatRateId = clean(body.vatRateId);
  const saleGrossPrice = clean(body.saleGrossPrice);
  const saleGrossCents = parseInventoryMoneyToCents(saleGrossPrice);
  const service = body.service === true;

  if (
    !naziv ||
    !unitId ||
    !vatRateId ||
    saleGrossCents === null ||
    saleGrossCents <= 0
  ) {
    return NextResponse.json(
      {
        message:
          "Naziv, jedinica mjere, PDV stopa i pozitivna prodajna cijena su obavezni."
      },
      { status: 400 }
    );
  }

  if (
    naziv.length > MAX_NAME_LENGTH ||
    manualCode.length > MAX_CODE_LENGTH ||
    (barkod?.length ?? 0) > MAX_BARCODE_LENGTH
  ) {
    return NextResponse.json(
      {
        message:
          "Naziv, šifra ili barkod prelaze dozvoljenu dužinu."
      },
      { status: 400 }
    );
  }

  if (
    saleGrossCents > MAX_DECIMAL_14_2_CENTS ||
    !Number.isSafeInteger(saleGrossCents)
  ) {
    return NextResponse.json(
      { message: "Prodajna cijena je izvan dozvoljenog raspona." },
      { status: 400 }
    );
  }

  if (
    !validUuid(groupId) ||
    !validUuid(unitId) ||
    !validUuid(vatRateId)
  ) {
    return NextResponse.json(
      {
        message:
          "Izabrana grupa, jedinica mjere ili PDV stopa nije dostupna."
      },
      { status: 400 }
    );
  }

  const [firma, unit, vatRate, group] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        aktivan: true,
        is_deleted: false
      },
      select: { id: true }
    }),
    prisma.jedinicaMjere.findFirst({
      where: { id: unitId, aktivna: true },
      select: { id: true, oznaka: true }
    }),
    prisma.pdvStopa.findFirst({
      where: {
        id: vatRateId,
        agencija_id: agencijaId,
        aktivna: true
      },
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

  if (!firma) {
    return NextResponse.json(
      { message: "Direktna firma više nije dostupna." },
      { status: 403 }
    );
  }

  if (!unit || !vatRate || (groupId && !group)) {
    return NextResponse.json(
      {
        message:
          "Izabrana grupa, jedinica mjere ili PDV stopa nije dostupna."
      },
      { status: 400 }
    );
  }

  const vatPercent = Number(vatRate.procenat.toString());

  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    return NextResponse.json(
      { message: "Izabrana PDV stopa nije ispravna." },
      { status: 400 }
    );
  }

  const price = calculateItemPriceAmounts(
    "SA_PDV",
    saleGrossCents,
    vatPercent
  );

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
        sifra = String(
          (rows[0]?.max_code ?? BigInt(0)) + BigInt(1)
        ).padStart(6, "0");
      }

      if (sifra.length > MAX_CODE_LENGTH) {
        throw new Error("ITEM_CODE_TOO_LONG");
      }

      const duplicate = await tx.artikal.findFirst({
        where: {
          firma_id: firmaId,
          OR: [{ sifra }, ...(barkod ? [{ barkod }] : [])]
        },
        select: { sifra: true, barkod: true }
      });

      if (duplicate?.sifra === sifra) {
        throw new Error("DUPLICATE_CODE");
      }

      if (barkod && duplicate?.barkod === barkod) {
        throw new Error("DUPLICATE_BARCODE");
      }

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
          created_by: context.user.id,
          updated_by: context.user.id
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
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });

      return created;
    });

    await auditLog({
      korisnikId: context.user.id,
      agencijaId,
      firmaId,
      modul: "portal.artikli",
      akcija: "quick_create",
      tipEntiteta: "Artikal",
      entitetId: item.id,
      novaVrijednost: {
        id: item.id,
        sifra: item.sifra,
        naziv: item.naziv,
        barkod: item.barkod,
        grupaArtiklaId: item.grupa_artikla_id,
        jedinicaMjereId: item.jedinica_mjere_id,
        pdvStopaId: item.pdv_stopa_id,
        saleGrossPrice: inventoryCentsToDecimal(price.grossCents),
        service: item.usluga
      }
    });

    return NextResponse.json({
      item: {
        id: item.id,
        sifra: item.sifra,
        naziv: item.naziv,
        unitCode: unit.oznaka,
        vatPercent: vatRate.procenat.toString(),
        saleGrossPrice: inventoryCentsToDecimal(price.grossCents),
        service: item.usluga
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CODE") {
      return NextResponse.json(
        { message: "Artikal sa tom šifrom već postoji." },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "DUPLICATE_BARCODE") {
      return NextResponse.json(
        { message: "Artikal sa tim barkodom već postoji." },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "ITEM_CODE_TOO_LONG") {
      return NextResponse.json(
        { message: "Automatska šifra prelazi dozvoljenu dužinu." },
        { status: 409 }
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "Artikal sa tom šifrom ili barkodom već postoji." },
        { status: 409 }
      );
    }

    console.error("portal quick item create failed", error);
    return NextResponse.json(
      { message: "Artikal nije sačuvan." },
      { status: 500 }
    );
  }
}
