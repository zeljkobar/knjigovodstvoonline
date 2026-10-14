import "server-only";
import { getCurrentUser } from "./auth";
import { readWorkContext } from "./work-context";
import { prisma } from "./prisma";
import { hasPermission } from "./permissions";

export async function getSepAdmin() {
  const user = await getCurrentUser();
  if (!user || user.rola !== "admin_agencije" || !user.agencija_id || user.agencija?.is_fiscal_direct_container) throw new Error("SEP_ACCESS_DENIED");
  return { user, agencyId: user.agencija_id, scope: `${user.agencija_id}:${user.id}` };
}
export async function getSepCompany(expectedId?: string) {
  const context = await getSepAdmin();
  const work = await readWorkContext();
  if (!work.firmaId || (expectedId && expectedId !== work.firmaId)) throw new Error("SEP_CONTEXT_CHANGED");
  const firm = await prisma.firma.findFirst({
    where: { id: work.firmaId, agencija_id: context.agencyId, aktivan: true, is_deleted: false },
    select: { id: true, naziv: true, pib: true },
  });
  if (!firm || !await hasPermission(context.user, { firmaId: firm.id, modul: "sep", akcija: "export" })) throw new Error("SEP_ACCESS_DENIED");
  if (!/^\d{8}$/.test(firm.pib ?? "")) throw new Error("SEP_COMPANY_PIB");
  return { ...context, firm: { ...firm, pib: firm.pib! } };
}
