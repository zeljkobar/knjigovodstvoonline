import { PrismaClient } from "@prisma/client";
import { partnerAgencyContext } from "./agency-partner-context";
import { cache } from "react";
import { readSession } from "./session";
import { agencyPartnerClient } from "./agency-partner-client";

const globalForPrisma = globalThis as unknown as {
  rawPrisma?: PrismaClient;
};

// Raw client is for platform administration and explicit canonical identity reads.
export const rawPrisma = globalForPrisma.rawPrisma ?? new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
});
if (process.env.NODE_ENV !== "production") globalForPrisma.rawPrisma = rawPrisma;

const requestAgency = cache(async () => {
  let session;
  try { session = await readSession(); } catch { return null; }
  if (!session || session.rola === "admin") return null;
  const user = await rawPrisma.korisnik.findFirst({
    where: { id: session.korisnikId, rola: session.rola, aktivan: true, is_deleted: false,
      agencija: { aktivan: true, is_deleted: false } },
    select: { agencija_id: true }
  });
  return user?.agencija_id ?? null;
});

export const prisma = agencyPartnerClient(rawPrisma, async () => partnerAgencyContext() ?? await requestAgency());

// Background jobs have no session. Their authorised agency must be explicit.
export function prismaForAgency(agencijaId: string) {
  return agencyPartnerClient(rawPrisma, async () => agencijaId);
}
