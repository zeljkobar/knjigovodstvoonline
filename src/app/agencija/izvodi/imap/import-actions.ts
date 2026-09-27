"use server";
import { requireImapCompany } from "./access";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { getCompanyMailConfigs } from "@/lib/company-mail-settings";
import { listCompanyInbox, MailError } from "@/lib/imap-mail";

export async function discoverMailImport(firmaId: string, yearId: string) {
  const { user, firma } = await requireImapCompany(firmaId);
  await requirePermissionForUser(user, { firmaId: firma.id, modul: "izvodi", akcija: "create" });
  const context = await readWorkContext();
  if (context.poslovnaGodinaId !== yearId) return { error: "Aktivna godina je promijenjena. Osvježite stranicu." };
  const year = await prisma.poslovnaGodina.findFirst({ where: { id: yearId, firma_id: firma.id } });
  if (!year || year.zakljucena) return { error: "Izaberite otvorenu poslovnu godinu." };
  const config = (await getCompanyMailConfigs(user.agencija_id!)).find((item) => item.firmaId === firma.id);
  if (!config) return { error: "Mail pregled firme nije uključen." };
  try {
    return { references: (await listCompanyInbox(config, 1)).references };
  } catch (error) {
    return { error: error instanceof MailError ? error.message : "Mailove trenutno nije moguće učitati." };
  }
}
