import { Prisma } from "@prisma/client";
import { auditLogInTransaction } from "./audit";
import { agencyPartnerFields, agencyPartnerWhere } from "./agency-partner-projection";

export class AgencyPartnerEditError extends Error {}

type Input = {
  agencijaId: string; firmaId: string; userId: string; admin: boolean;
  partnerId: string; version: number;
  data: Pick<Prisma.AgencijaKomitentIzmjenaUncheckedCreateInput, typeof agencyPartnerFields[number]>;
  settings: { tip_komitenta: "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo";
    sifra_u_firmi: string | null; rok_placanja_dana: number | null; napomena: string | null };
};

export async function saveAgencyPartner(tx: Prisma.TransactionClient, input: Input) {
  const firma = await tx.firma.findFirst({
    where: { id: input.firmaId, agencija_id: input.agencijaId, aktivan: true, is_deleted: false,
      ...(input.admin ? {} : { korisnici: { some: { korisnik_id: input.userId, is_deleted: false } } }) },
    select: { id: true }
  });
  if (!firma) throw new AgencyPartnerEditError("partner_greska");
  const canonical = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM komitenti WHERE id = ${input.partnerId}::uuid AND scope = 'GLOBAL' AND aktivan = true FOR UPDATE
  `);
  if (!canonical.length) throw new AgencyPartnerEditError("partner_greska");
  const unique = { agencija_id_komitent_id: { agencija_id: input.agencijaId, komitent_id: input.partnerId } };
  const existing = await tx.agencijaKomitentIzmjena.findUnique({ where: unique });
  if ((existing?.verzija ?? 0) !== input.version) throw new AgencyPartnerEditError("partner_verzija");
  if (input.data.pib) {
    const duplicate = await tx.komitent.findFirst({
      where: agencyPartnerWhere("Komitent", {
        aktivan: true, pib: input.data.pib, NOT: { id: input.partnerId },
        OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: input.agencijaId },
          { scope: "COMPANY", agencija_id: input.agencijaId, firma_id: input.firmaId }]
      }, input.agencijaId) as Prisma.KomitentWhereInput,
      select: { id: true }
    });
    if (duplicate) throw new AgencyPartnerEditError("partner_dupli");
  }
  const saved = await tx.agencijaKomitentIzmjena.upsert({
    where: unique,
    create: { ...input.data, agencija_id: input.agencijaId, komitent_id: input.partnerId,
      created_by: input.userId, updated_by: input.userId },
    update: { ...input.data, verzija: { increment: 1 }, updated_by: input.userId }
  });
  await tx.firmaKomitent.upsert({
    where: { firma_id_komitent_id: { firma_id: input.firmaId, komitent_id: input.partnerId } },
    create: { firma_id: input.firmaId, komitent_id: input.partnerId, ...input.settings, aktivan: true },
    update: { ...input.settings, aktivan: true }
  });
  await auditLogInTransaction(tx, {
    korisnikId: input.userId, agencijaId: input.agencijaId, firmaId: input.firmaId,
    modul: "agencija.partneri", akcija: "agency_override", tipEntiteta: "Komitent",
    entitetId: input.partnerId, staraVrijednost: existing, novaVrijednost: saved,
    napomena: "Agencijski prikaz globalnog partnera; kanonski partner i istorijske veze ostaju isti."
  });
  return saved;
}
