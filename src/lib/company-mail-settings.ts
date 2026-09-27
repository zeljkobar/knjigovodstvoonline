import "server-only";
import { prisma } from "./prisma";
import { parseMailRules, type CompanyMailConfig } from "./company-mail-rules";

export async function getCompanyMailConfigs(agencyId: string): Promise<CompanyMailConfig[]> {
  const settings = await prisma.firmaMailPodesavanje.findMany({
    where: { agencija_id: agencyId, aktivno: true, is_deleted: false,
      firma: { agencija_id: agencyId, aktivan: true, is_deleted: false } }
  });
  return settings.map((setting) => ({
    firmaId: setting.firma_id, folder: setting.folder,
    includeSubfolders: setting.ukljuci_podfoldere, includeInbox: setting.ukljuci_inbox,
    rules: parseMailRules(setting.pravila)
  }));
}
