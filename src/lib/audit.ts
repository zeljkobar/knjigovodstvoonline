import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type AuditInput = {
  korisnikId?: string | null;
  agencijaId?: string | null;
  firmaId?: string | null;
  modul: string;
  akcija: string;
  tipEntiteta: string;
  entitetId?: string | null;
  staraVrijednost?: unknown;
  novaVrijednost?: unknown;
  napomena?: string | null;
  upisiAktivnost?: boolean;
};

function jsonValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

export async function auditLogInTransaction(
  tx: Prisma.TransactionClient,
  {
    korisnikId,
    agencijaId,
    firmaId,
    modul,
    akcija,
    tipEntiteta,
    entitetId,
    staraVrijednost,
    novaVrijednost,
    napomena,
    upisiAktivnost = true
  }: AuditInput,
  requestMetadata: {
    ipAddress?: string | null;
    userAgent?: string | null;
  } = {}
) {
  const activityDate = new Date();

  await tx.auditLog.create({
    data: {
      korisnik_id: korisnikId ?? null,
      agencija_id: agencijaId ?? null,
      firma_id: firmaId ?? null,
      modul,
      akcija,
      tip_entiteta: tipEntiteta,
      entitet_id: entitetId ?? null,
      stara_vrijednost: jsonValue(staraVrijednost),
      nova_vrijednost: jsonValue(novaVrijednost),
      ip_adresa: requestMetadata.ipAddress ?? null,
      user_agent: requestMetadata.userAgent ?? null,
      napomena: napomena ?? null
    }
  });

  if (upisiAktivnost && korisnikId) {
    await tx.aktivnostDogadjaj.create({
      data: {
        korisnik_id: korisnikId,
        agencija_id: agencijaId ?? null,
        firma_id: firmaId ?? null,
        modul,
        akcija,
        tip_entiteta: tipEntiteta,
        entitet_id: entitetId ?? null,
        activity_date: activityDate
      }
    });
  }
}

export async function auditLog({
  korisnikId,
  agencijaId,
  firmaId,
  modul,
  akcija,
  tipEntiteta,
  entitetId,
  staraVrijednost,
  novaVrijednost,
  napomena,
  upisiAktivnost = true
}: AuditInput) {
  const requestHeaders = await headers();
  const ipAddress =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip");
  const userAgent = requestHeaders.get("user-agent");

  await prisma.$transaction(async (tx) => {
    await auditLogInTransaction(
      tx,
      {
        korisnikId,
        agencijaId,
        firmaId,
        modul,
        akcija,
        tipEntiteta,
        entitetId,
        staraVrijednost,
        novaVrijednost,
        napomena,
        upisiAktivnost
      },
      { ipAddress, userAgent }
    );
  });
}
