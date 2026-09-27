import "server-only";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { canAccessAgencyImap } from "@/lib/imap-access-policy";

export async function requireImapAgency() {
  const user = await requireRole("admin_agencije");
  // This phase has one .env mailbox. Never expose it to another tenant.
  if (!canAccessAgencyImap(user, process.env.IMAP_AGENCY_ID)) notFound();
  await requirePermissionForUser(user, { modul: "izvodi", akcija: "manage" });
  return user;
}

export async function requireImapCompany(expectedCompanyId?: string | null) {
  const user = await requireImapAgency();
  const { firmaId } = await readWorkContext();
  if (!firmaId) redirect("/agencija/izvodi?poruka=izaberite_firmu");
  if (expectedCompanyId && expectedCompanyId !== firmaId) notFound();
  const firma = await prisma.firma.findFirst({
    where: { id: firmaId, agencija_id: user.agencija_id!, aktivan: true, is_deleted: false },
    select: { id: true, naziv: true }
  });
  if (!firma) notFound();
  await requirePermissionForUser(user, { firmaId: firma.id, modul: "izvodi", akcija: "manage" });
  return { user, firma };
}
