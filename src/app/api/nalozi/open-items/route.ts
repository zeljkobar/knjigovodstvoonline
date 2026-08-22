import { NextResponse } from "next/server";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type CloseSide = "D" | "P";

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function closeSideForAccount(accountCode: string): CloseSide | null {
  if (accountCode.startsWith("2")) {
    return "P";
  }

  if (accountCode.startsWith("4")) {
    return "D";
  }

  return null;
}

function toCents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

function formatDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json({ message: "Ruta nije dostupna u direktnom portalu." }, { status: 403 });
  }

  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json({ closeSide: null, items: [] });
  }

  const url = new URL(request.url);
  const accountCode = normalize(url.searchParams.get("konto_sifra"));
  const partnerId = normalize(url.searchParams.get("komitent_id"));
  const closeSide = closeSideForAccount(accountCode);

  if (!accountCode || !isUuid(partnerId) || !closeSide) {
    return NextResponse.json({ closeSide, items: [] });
  }

  const company = await prisma.firma.findFirst({
    where: {
      id: workContext.firmaId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    select: {
      id: true
    }
  });

  if (!company) {
    return NextResponse.json({ message: "Firma nije dostupna." }, { status: 403 });
  }

  const account = await prisma.firmaKonto.findFirst({
    where: {
      firma_id: company.id,
      sifra: accountCode,
      aktivan: true
    },
    select: {
      id: true
    }
  });

  if (!account) {
    return NextResponse.json({ closeSide, items: [] });
  }

  const lines = await prisma.stavkaNaloga.findMany({
    where: {
      konto_id: account.id,
      komitent_id: partnerId,
      broj_dokumenta: {
        not: null
      },
      nalog: {
        agencija_id: user.agencija_id,
        firma_id: company.id,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        status: journalStatuses.posted,
        is_deleted: false
      }
    },
    orderBy: [
      {
        datum_dokumenta: "asc"
      },
      {
        created_at: "asc"
      }
    ],
    select: {
      broj_dokumenta: true,
      datum_dokumenta: true,
      datum_valute: true,
      duguje: true,
      potrazuje: true
    }
  });

  const grouped = new Map<
    string,
    {
      documentDate: Date | null;
      dueDate: Date | null;
      documentNumber: string;
      debitCents: number;
      creditCents: number;
    }
  >();

  for (const line of lines) {
    const documentNumber = line.broj_dokumenta?.trim();

    if (!documentNumber) {
      continue;
    }

    const existing = grouped.get(documentNumber);
    const debitCents = toCents(line.duguje);
    const creditCents = toCents(line.potrazuje);

    if (existing) {
      existing.debitCents += debitCents;
      existing.creditCents += creditCents;
      existing.documentDate ||= line.datum_dokumenta;
      existing.dueDate ||= line.datum_valute;
      continue;
    }

    grouped.set(documentNumber, {
      documentDate: line.datum_dokumenta,
      dueDate: line.datum_valute,
      documentNumber,
      debitCents,
      creditCents
    });
  }

  const items = Array.from(grouped.values())
    .map((item) => {
      const openAmountCents =
        closeSide === "P"
          ? item.debitCents - item.creditCents
          : item.creditCents - item.debitCents;

      return {
        documentDate: formatDate(item.documentDate),
        documentNumber: item.documentNumber,
        dueDate: formatDate(item.dueDate),
        openAmountCents
      };
    })
    .filter((item) => item.openAmountCents > 0)
    .sort((first, second) => {
      const firstDate = first.documentDate ?? "";
      const secondDate = second.documentDate ?? "";

      return (
        firstDate.localeCompare(secondDate) ||
        first.documentNumber.localeCompare(second.documentNumber)
      );
    })
    .slice(0, 50);

  return NextResponse.json({
    closeSide,
    items
  });
}
