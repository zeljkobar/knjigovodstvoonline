import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import {
  authorizeDirectPortalPartnerAccess,
  DIRECT_PORTAL_PARTNER_CREATE_PERMISSIONS
} from "@/lib/direct-portal-partners";
import { prisma } from "@/lib/prisma";

const PARTNER_TYPES = new Set([
  "kupac",
  "dobavljac",
  "kupac_dobavljac",
  "ostalo"
]);

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
  const access = await authorizeDirectPortalPartnerAccess(
    DIRECT_PORTAL_PARTNER_CREATE_PERMISSIONS
  );

  if (!access.allowed) {
    return NextResponse.json(
      { message: access.message },
      { status: access.status }
    );
  }

  const agencijaId = access.context.user.agencija_id;

  if (!agencijaId) {
    return NextResponse.json(
      { message: "Direktni fiskalni portal nije dostupan za ovaj nalog." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    accountNumber?: string;
    address?: string;
    city?: string;
    country?: string;
    email?: string;
    isForeign?: boolean;
    name?: string;
    phone?: string;
    pib?: string;
    type?: string;
  } | null;
  const naziv = clean(body?.name);
  const pib = normalizePib(body?.pib) || null;
  const requestedType = clean(body?.type);
  const type = PARTNER_TYPES.has(requestedType)
    ? requestedType
    : "kupac_dobavljac";
  const accountNumber = clean(body?.accountNumber);
  const normalizedAccount = normalizeAccountNumber(accountNumber);
  const firmaId = access.context.firma.id;

  if (!naziv) {
    return NextResponse.json(
      { message: "Naziv partnera je obavezan." },
      { status: 400 }
    );
  }

  if (pib && pib.length !== 8) {
    return NextResponse.json(
      { message: "PIB mora imati 8 cifara." },
      { status: 400 }
    );
  }

  if (accountNumber && !normalizedAccount) {
    return NextResponse.json(
      { message: "Žiro račun mora sadržati cifre." },
      { status: 400 }
    );
  }

  const result = await prisma
    .$transaction(async (tx) => {
      const existingCompanyPartner = pib
        ? await tx.komitent.findFirst({
            where: {
              aktivan: true,
              firma_id: firmaId,
              pib,
              scope: "COMPANY"
            }
          })
        : null;
      const existingGlobalPartner =
        !existingCompanyPartner && pib
          ? await tx.komitent.findFirst({
              where: {
                aktivan: true,
                pib,
                scope: "GLOBAL"
              }
            })
          : null;
      const existingPartner =
        existingCompanyPartner ?? existingGlobalPartner;
      const partner =
        existingPartner ??
        (await tx.komitent.create({
          data: {
            naziv,
            scope: "COMPANY",
            agencija_id: agencijaId,
            firma_id: firmaId,
            pib,
            adresa: nullable(body?.address),
            grad: nullable(body?.city),
            drzava: nullable(body?.country) ?? "Crna Gora",
            telefon: nullable(body?.phone),
            email: nullable(body?.email),
            is_foreign: body?.isForeign === true,
            country_code: null,
            country_name: nullable(body?.country),
            aktivan: true
          }
        }));

      await tx.firmaKomitent.upsert({
        where: {
          firma_id_komitent_id: {
            firma_id: firmaId,
            komitent_id: partner.id
          }
        },
        create: {
          firma_id: firmaId,
          komitent_id: partner.id,
          tip_komitenta: type as
            | "kupac"
            | "dobavljac"
            | "kupac_dobavljac"
            | "ostalo",
          aktivan: true
        },
        update: {
          tip_komitenta: type as
            | "kupac"
            | "dobavljac"
            | "kupac_dobavljac"
            | "ostalo",
          aktivan: true
        }
      });

      if (accountNumber && normalizedAccount) {
        if (partner.scope === "COMPANY" && partner.firma_id === firmaId) {
          await tx.komitentZiroRacun.upsert({
            where: {
              komitent_id_broj_racuna: {
                komitent_id: partner.id,
                broj_racuna: accountNumber
              }
            },
            create: {
              komitent_id: partner.id,
              broj_racuna: accountNumber,
              glavni: true,
              aktivan: true
            },
            update: {
              glavni: true,
              aktivan: true
            }
          });
        }

        const existingBankAccount = await tx.partnerBankAccount.findFirst({
          where: {
            agencija_id: agencijaId,
            firma_id: firmaId,
            normalized_account_number: normalizedAccount
          },
          select: {
            id: true,
            partner_id: true
          }
        });

        if (
          existingBankAccount &&
          existingBankAccount.partner_id !== partner.id
        ) {
          throw new Error("PORTAL_PARTNER_ACCOUNT_IN_USE");
        }

        if (existingBankAccount) {
          await tx.partnerBankAccount.update({
            where: {
              id: existingBankAccount.id
            },
            data: {
              account_number: accountNumber,
              is_primary: true,
              is_active: true,
              updated_by: access.context.user.id
            }
          });
        } else {
          await tx.partnerBankAccount.create({
            data: {
              agencija_id: agencijaId,
              firma_id: firmaId,
              partner_id: partner.id,
              account_number: accountNumber,
              normalized_account_number: normalizedAccount,
              is_primary: true,
              is_active: true,
              source: "MANUAL",
              created_by: access.context.user.id,
              updated_by: access.context.user.id
            }
          });
        }
      }

      return {
        created: !existingPartner,
        partner
      };
    })
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message === "PORTAL_PARTNER_ACCOUNT_IN_USE"
      ) {
        return "ACCOUNT_IN_USE" as const;
      }

      console.error("portal quick partner create failed", error);
      return null;
    });

  if (result === "ACCOUNT_IN_USE") {
    return NextResponse.json(
      { message: "Žiro račun je već povezan sa drugim partnerom ove firme." },
      { status: 409 }
    );
  }

  if (!result) {
    return NextResponse.json(
      { message: "Partner nije sačuvan." },
      { status: 500 }
    );
  }

  await auditLog({
    korisnikId: access.context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.partneri",
    akcija: result.created ? "quick_create" : "quick_connect",
    tipEntiteta: "Komitent",
    entitetId: result.partner.id,
    novaVrijednost: {
      id: result.partner.id,
      naziv: result.partner.naziv,
      pib: result.partner.pib,
      scope: result.partner.scope
    }
  });

  return NextResponse.json({
    partner: {
      id: result.partner.id,
      naziv: result.partner.naziv,
      pib: result.partner.pib,
      scope: result.partner.scope,
      isForeign: result.partner.is_foreign,
      countryCode: result.partner.country_code,
      countryName: result.partner.country_name,
      label: partnerLabel(result.partner),
      defaultKufAccountCode: null,
      defaultKufVatRateCode: null
    }
  });
}
