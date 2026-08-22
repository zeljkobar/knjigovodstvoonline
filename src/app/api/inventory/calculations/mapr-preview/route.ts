import { NextResponse } from "next/server";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { inventoryModule, itemPriceTypes } from "@/lib/inventory";
import {
  fetchMaprInvoice,
  MaprInvoiceError,
  normalizeMaprItemText
} from "@/lib/mapr-invoice";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function normalizePib(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }
  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json({ message: "Ruta nije dostupna u direktnom portalu." }, { status: 403 });
  }
  const workContext = await readWorkContext();
  if (!workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json(
      { message: "Izaberite firmu i poslovnu godinu u radnom kontekstu." },
      { status: 400 }
    );
  }
  const firmaId = workContext.firmaId;
  const agencijaId = user.agencija_id;
  const body = (await request.json().catch(() => null)) as { qrUrl?: string } | null;
  const qrUrl = String(body?.qrUrl ?? "").trim();
  if (!qrUrl) {
    return NextResponse.json({ message: "Unesite fiskalni MAPR link." }, { status: 400 });
  }

  const [firma, allowed] = await Promise.all([
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
                some: { korisnik_id: user.id, is_deleted: false, moze_da_mijenja: true }
              }
            })
      },
      select: { id: true }
    }),
    hasPermission(user, { firmaId, modul: inventoryModule, akcija: "create" })
  ]);
  if (!firma || !allowed) {
    return NextResponse.json({ message: "Nemate pravo za kreiranje kalkulacije." }, { status: 403 });
  }

  try {
    const invoice = await fetchMaprInvoice(qrUrl);
    const sellerTin = normalizePib(invoice.seller.tin);
    const sellerPibs = [...new Set([sellerTin, sellerTin.replace(/^0/, "")].filter(Boolean))];
    const supplier = await prisma.komitent.findFirst({
      where: {
        pib: { in: sellerPibs },
        aktivan: true,
        OR: [
          { scope: "GLOBAL" },
          { scope: "AGENCY", agencija_id: agencijaId },
          { scope: "COMPANY", firma_id: firmaId }
        ]
      },
      select: { id: true, naziv: true, pib: true, scope: true }
    });

    const [duplicateCalculation, duplicateKuf, units, vatRates, items, mappings] =
      await Promise.all([
        prisma.kalkulacija.findFirst({
          where: {
            firma_id: firmaId,
            fiscal_iic: invoice.identifiers.iic,
            is_deleted: false
          },
          select: { id: true, interni_broj: true }
        }),
        prisma.kufEntry.findFirst({
          where: {
            firma_id: firmaId,
            fiscal_iic: invoice.identifiers.iic,
            is_deleted: false
          },
          select: { id: true, internal_kuf_number: true }
        }),
        prisma.jedinicaMjere.findMany({
          where: { aktivna: true },
          select: { id: true, sifra: true, oznaka: true }
        }),
        prisma.pdvStopa.findMany({
          where: { agencija_id: agencijaId, aktivna: true },
          select: { id: true, procenat: true }
        }),
        prisma.artikal.findMany({
          where: {
            agencija_id: agencijaId,
            firma_id: firmaId,
            aktivan: true,
            is_deleted: false,
            usluga: false,
            prati_zalihe: true
          },
          include: {
            jedinica_mjere: { select: { id: true, sifra: true, oznaka: true } },
            pdv_stopa: { select: { id: true, procenat: true } },
            cijene: {
              where: { tip: itemPriceTypes.retail, aktivna: true, is_deleted: false },
              orderBy: { vazi_od: "desc" },
              take: 1
            }
          }
        }),
        supplier
          ? prisma.dobavljacArtikalVeza.findMany({
              where: {
                agencija_id: agencijaId,
                firma_id: firmaId,
                dobavljac_id: supplier.id,
                external_key: { in: invoice.items.map((item) => item.externalKey) }
              },
              include: {
                artikal: {
                  include: {
                    jedinica_mjere: { select: { id: true, sifra: true, oznaka: true } },
                    pdv_stopa: { select: { id: true, procenat: true } },
                    cijene: {
                      where: { tip: itemPriceTypes.retail, aktivna: true, is_deleted: false },
                      orderBy: { vazi_od: "desc" },
                      take: 1
                    }
                  }
                }
              }
            })
          : Promise.resolve([])
      ]);

    if (duplicateCalculation) {
      return NextResponse.json(
        { message: `Ovaj MAPR račun već postoji u kalkulaciji ${duplicateCalculation.interni_broj}.` },
        { status: 409 }
      );
    }
    if (duplicateKuf) {
      return NextResponse.json(
        { message: `Ovaj MAPR račun već postoji u KUF-u ${duplicateKuf.internal_kuf_number}.` },
        { status: 409 }
      );
    }

    const mappingMap = new Map(mappings.map((mapping) => [mapping.external_key, mapping]));
    const unitMap = new Map<string, (typeof units)[number]>();
    for (const unit of units) {
      unitMap.set(normalizeMaprItemText(unit.sifra), unit);
      unitMap.set(normalizeMaprItemText(unit.oznaka), unit);
    }

    const rows = invoice.items.map((sourceItem) => {
      const sourceUnit = unitMap.get(normalizeMaprItemText(sourceItem.unit)) ?? null;
      const vatRate =
        vatRates.find(
          (rate) => Number(rate.procenat.toString()) === Number(sourceItem.vatRate)
        ) ?? null;
      const saved = mappingMap.get(sourceItem.externalKey);
      const savedItem =
        saved?.artikal.aktivan &&
        !saved.artikal.is_deleted &&
        !saved.artikal.usluga &&
        saved.artikal.prati_zalihe
          ? saved.artikal
          : null;

      const candidates = items.filter((item) => {
        const codeMatch =
          sourceItem.code &&
          normalizeMaprItemText(item.sifra) === normalizeMaprItemText(sourceItem.code);
        const nameMatch =
          normalizeMaprItemText(item.naziv) === normalizeMaprItemText(sourceItem.name);
        const unitMatch = !sourceUnit || item.jedinica_mjere_id === sourceUnit.id;
        const vatMatch =
          !vatRate ||
          Number(item.pdv_stopa?.procenat.toString() ?? "0") === Number(sourceItem.vatRate);
        return (codeMatch || nameMatch) && unitMatch && vatMatch;
      });
      const suggestedItem = candidates.length === 1 ? candidates[0] : null;
      const status = savedItem
        ? "MAPPED"
        : candidates.length > 1
          ? "NEEDS_DECISION"
          : suggestedItem
            ? "SUGGESTED"
            : !sourceUnit
              ? "NEEDS_UNIT"
              : !vatRate
                ? "NEEDS_VAT"
                : "NEW";
      const selectedItem = savedItem ?? suggestedItem;

      return {
        ...sourceItem,
        status,
        mappedItemId: savedItem?.id ?? null,
        suggestedItemId: suggestedItem?.id ?? null,
        selectedItemId: selectedItem?.id ?? null,
        selectedItemPrice: selectedItem?.cijene[0]?.cijena_sa_pdv.toString() ?? "",
        unitId: sourceUnit?.id ?? selectedItem?.jedinica_mjere_id ?? null,
        vatRateId: vatRate?.id ?? selectedItem?.pdv_stopa_id ?? null,
        candidateCount: candidates.length
      };
    });

    return NextResponse.json({
      invoice: {
        seller: invoice.seller,
        identifiers: invoice.identifiers,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.identifiers.qrDateTimeCreated.slice(0, 10),
        totalWithoutVat: invoice.totalWithoutVat,
        totalVat: invoice.totalVat,
        total: invoice.total,
        itemCount: invoice.items.length
      },
      supplier: supplier
        ? {
            id: supplier.id,
            label: `${supplier.naziv}${supplier.pib ? ` · PIB ${supplier.pib}` : ""}`,
            naziv: supplier.naziv,
            pib: supplier.pib,
            scope: supplier.scope
          }
        : null,
      rows
    });
  } catch (error) {
    if (error instanceof MaprInvoiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    console.error("MAPR calculation preview failed", error);
    return NextResponse.json({ message: "MAPR račun nije učitan." }, { status: 500 });
  }
}
