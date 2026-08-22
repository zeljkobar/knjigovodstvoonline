import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function nullable(value: unknown) {
  const data = clean(value);

  return data || null;
}

function normalizePib(value: unknown) {
  const digits = clean(value).replace(/\D/g, "");

  return digits.length === 7 ? `0${digits}` : digits;
}

function normalizeAccountNumber(value: unknown) {
  return clean(value).replace(/\D/g, "");
}

function partnerLabel(partner: { naziv: string; pib: string | null }) {
  return `${partner.naziv}${partner.pib ? ` (${partner.pib})` : ""}`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json(
      { message: "Portal unos kupca još nije aktiviran." },
      { status: 403 }
    );
  }
  const agencijaId = user.agencija_id;

  const workContext = await readWorkContext();

  if (!workContext.firmaId) {
    return NextResponse.json({ message: "Izaberite firmu u radnom kontekstu." }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as {
    accountNumber?: string;
    address?: string;
    city?: string;
    country?: string;
    isForeign?: boolean;
    name?: string;
    pib?: string;
    scope?: string;
    type?: string;
  } | null;
  const naziv = clean(body?.name);
  const pib = normalizePib(body?.pib) || null;
  const scope = body?.scope === "COMPANY" ? "COMPANY" : "AGENCY";
  const type = ["kupac", "dobavljac", "kupac_dobavljac", "ostalo"].includes(clean(body?.type))
    ? clean(body?.type)
    : "kupac_dobavljac";
  const accountNumber = clean(body?.accountNumber);
  const normalizedAccount = normalizeAccountNumber(accountNumber);

  if (!naziv) {
    return NextResponse.json({ message: "Naziv partnera je obavezan." }, { status: 400 });
  }

  if (pib && pib.length !== 8) {
    return NextResponse.json({ message: "PIB mora imati 8 cifara." }, { status: 400 });
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: workContext.firmaId,
      agencija_id: agencijaId,
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

  if (!firma) {
    return NextResponse.json({ message: "Firma nije dostupna." }, { status: 403 });
  }

  const partner = await prisma.$transaction(async (tx) => {
    const existingPartner = pib
      ? await tx.komitent.findFirst({
          where: {
            pib,
            aktivan: true,
            OR: [
              { scope: "GLOBAL" },
            { scope: "AGENCY", agencija_id: agencijaId },
              { scope: "COMPANY", firma_id: firma.id }
            ]
          },
          select: {
            id: true
          }
        })
      : null;
    const komitent = existingPartner
      ? await tx.komitent.findUniqueOrThrow({
          where: {
            id: existingPartner.id
          },
          select: {
            id: true,
            naziv: true,
            pib: true,
            scope: true,
            is_foreign: true,
            country_code: true,
            country_name: true
          }
        })
      : await tx.komitent.create({
          data: {
            naziv,
            scope,
            agencija_id: agencijaId,
            firma_id: scope === "COMPANY" ? firma.id : null,
            pib,
            adresa: nullable(body?.address),
            grad: nullable(body?.city),
            drzava: nullable(body?.country) ?? "Crna Gora",
            is_foreign: Boolean(body?.isForeign),
            country_code: null,
            country_name: nullable(body?.country),
            aktivan: true
          },
          select: {
            id: true,
            naziv: true,
            pib: true,
            scope: true,
            is_foreign: true,
            country_code: true,
            country_name: true
          }
        });

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firma.id,
          komitent_id: komitent.id
        }
      },
      create: {
        firma_id: firma.id,
        komitent_id: komitent.id,
        tip_komitenta: type as "kupac" | "dobavljac" | "kupac_dobavljac" | "ostalo",
        aktivan: true
      },
      update: {
        tip_komitenta: type as "kupac" | "dobavljac" | "kupac_dobavljac" | "ostalo",
        aktivan: true
      }
    });

    if (accountNumber && normalizedAccount) {
      await tx.komitentZiroRacun.upsert({
        where: {
          komitent_id_broj_racuna: {
            komitent_id: komitent.id,
            broj_racuna: accountNumber
          }
        },
        create: {
          komitent_id: komitent.id,
          broj_racuna: accountNumber,
          glavni: true,
          aktivan: true
        },
        update: {
          glavni: true,
          aktivan: true
        }
      });

      const existingBankAccount = await tx.partnerBankAccount.findFirst({
        where: {
          agencija_id: agencijaId,
          firma_id: {
            equals: null
          },
          normalized_account_number: normalizedAccount
        },
        select: {
          id: true
        }
      });

      if (existingBankAccount) {
        await tx.partnerBankAccount.update({
          where: {
            id: existingBankAccount.id
          },
          data: {
            partner_id: komitent.id,
            account_number: accountNumber,
            is_primary: true,
            is_active: true,
            updated_by: user.id
          }
        });
      } else {
        await tx.partnerBankAccount.create({
          data: {
            agencija_id: agencijaId,
            firma_id: null,
            partner_id: komitent.id,
            account_number: accountNumber,
            normalized_account_number: normalizedAccount,
            is_primary: true,
            is_active: true,
            source: "MANUAL",
            created_by: user.id,
            updated_by: user.id
          }
        });
      }
    }

    return komitent;
  }).catch((error) => {
    console.error("quick partner create failed", error);
    return null;
  });

  if (!partner) {
    return NextResponse.json({ message: "Partner nije sačuvan." }, { status: 500 });
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId,
    firmaId: firma.id,
    modul: "agencija.partneri",
    akcija: "quick_create",
    tipEntiteta: "Komitent",
    entitetId: partner.id,
    novaVrijednost: partner
  });

  return NextResponse.json({
    partner: {
      id: partner.id,
      naziv: partner.naziv,
      pib: partner.pib,
      scope: partner.scope,
      isForeign: partner.is_foreign,
      countryCode: partner.country_code,
      countryName: partner.country_name,
      label: partnerLabel(partner),
      defaultKufAccountCode: null,
      defaultKufVatRateCode: null
    }
  });
}
