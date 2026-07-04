import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function normalizeSearch(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePib(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

function parsePartnerSearchQuery(query: string) {
  const exactNameMatch = query.match(/^=(.+)$/);
  const startsWithMatch = query.match(/^\^(.+)$/);
  const quotedPhraseMatch = query.match(/^"(.+)"$/);

  if (exactNameMatch?.[1]?.trim()) {
    return {
      mode: "exactName" as const,
      value: exactNameMatch[1].trim()
    };
  }

  if (startsWithMatch?.[1]?.trim()) {
    return {
      mode: "startsWith" as const,
      value: startsWithMatch[1].trim()
    };
  }

  if (quotedPhraseMatch?.[1]?.trim()) {
    return {
      mode: "phrase" as const,
      value: quotedPhraseMatch[1].trim()
    };
  }

  return {
    mode: "contains" as const,
    value: query
  };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId) {
    return NextResponse.json({ results: [] });
  }

  const url = new URL(request.url);
  const query = normalizeSearch(url.searchParams.get("q"));
  const exactPib = url.searchParams.get("exactPib") === "1";
  const parsedQuery = parsePartnerSearchQuery(query);
  const searchText = parsedQuery.value;
  const pib = normalizePib(searchText);

  if (searchText.length < 2 && pib.length < 7) {
    return NextResponse.json({ results: [] });
  }

  const availableScopeWhere = {
    aktivan: true,
    OR: [
      { scope: "GLOBAL" as const },
      { scope: "AGENCY" as const, agencija_id: user.agencija_id },
      { scope: "COMPANY" as const, firma_id: workContext.firmaId }
    ]
  };

  const nameSearch =
    parsedQuery.mode === "exactName"
      ? {
          naziv: {
            equals: searchText,
            mode: "insensitive" as const
          }
        }
      : parsedQuery.mode === "startsWith"
        ? {
            naziv: {
              startsWith: searchText,
              mode: "insensitive" as const
            }
          }
        : {
            naziv: {
              contains: searchText,
              mode: "insensitive" as const
            }
          };
  const searchWhere = exactPib
    ? {
        pib
      }
    : {
        OR: [
          nameSearch,
          {
            pib: {
              contains: pib || searchText
            }
          }
        ]
      };

  const partners = await prisma.komitent.findMany({
    where: {
      AND: [availableScopeWhere, searchWhere]
    },
    orderBy: [
      {
        scope: "asc"
      },
      {
        naziv: "asc"
      }
    ],
    take: exactPib ? 5 : 20,
    select: {
      id: true,
      naziv: true,
      pib: true,
      scope: true,
      is_foreign: true,
      country_code: true,
      country_name: true,
      firme: {
        where: {
          firma_id: workContext.firmaId,
          aktivan: true
        },
        select: {
          default_kuf_konto_sifra: true,
          default_kuf_pdv_stopa_sifra: true
        },
        take: 1
      }
    }
  });

  return NextResponse.json({
    results: partners.map((partner) => {
      const companyDefaults = partner.firme[0];

      return {
        id: partner.id,
        naziv: partner.naziv,
        pib: partner.pib,
        scope: partner.scope,
        isForeign: partner.is_foreign,
        countryCode: partner.country_code,
        countryName: partner.country_name,
        label: `${partner.naziv}${partner.pib ? ` (${partner.pib})` : ""}`,
        defaultKufAccountCode: companyDefaults?.default_kuf_konto_sifra ?? null,
        defaultKufVatRateCode: companyDefaults?.default_kuf_pdv_stopa_sifra ?? null
      };
    })
  });
}
