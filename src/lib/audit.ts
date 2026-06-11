import { headers } from "next/headers";
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
  const activityDate = new Date();

  await prisma.$transaction(async (tx) => {
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
        ip_adresa: ipAddress,
        user_agent: userAgent,
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
  });
}
