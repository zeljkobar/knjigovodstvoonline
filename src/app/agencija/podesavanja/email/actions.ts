"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { sendAgencyEmailTest } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const settingsPath = "/agencija/podesavanja/email";

function redirectWithMessage(message: string): never {
  redirect(`${settingsPath}?poruka=${encodeURIComponent(message)}`);
}

export async function saveAgencyEmailSettings(formData: FormData) {
  const user = await requireRole("admin_agencije");
  const replyTo = String(formData.get("email_reply_to") ?? "").trim().toLowerCase();

  if (!user.agencija_id) {
    redirectWithMessage("agencija_nedostaje");
  }

  if (!replyTo || replyTo.length > 320 || !emailPattern.test(replyTo)) {
    redirectWithMessage("email_nevalidan");
  }

  const previous = await prisma.agencija.findFirst({
    where: { id: user.agencija_id, is_deleted: false, aktivan: true },
    select: { id: true, email_reply_to: true }
  });

  if (!previous) {
    redirectWithMessage("agencija_nedostaje");
  }

  const updated = await prisma.agencija.update({
    where: { id: previous.id },
    data: { email_reply_to: replyTo, updated_by: user.id },
    select: { id: true, email_reply_to: true }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: previous.id,
    modul: "agencija.podesavanja.email",
    akcija: "update_reply_to",
    tipEntiteta: "Agencija",
    entitetId: previous.id,
    staraVrijednost: { email_reply_to: previous.email_reply_to },
    novaVrijednost: { email_reply_to: updated.email_reply_to }
  });

  revalidatePath(settingsPath);
  redirectWithMessage("sacuvano");
}

export async function sendAgencyEmailTestAction() {
  const user = await requireRole("admin_agencije");

  if (!user.agencija_id) {
    redirectWithMessage("agencija_nedostaje");
  }

  const agency = await prisma.agencija.findFirst({
    where: { id: user.agencija_id, is_deleted: false, aktivan: true },
    select: { id: true, naziv: true, email_reply_to: true }
  });

  if (!agency?.email_reply_to || !emailPattern.test(agency.email_reply_to)) {
    redirectWithMessage("email_nedostaje");
  }

  try {
    await sendAgencyEmailTest({
      to: agency.email_reply_to,
      agencyName: agency.naziv
    });
  } catch (error) {
    console.error("Agency test email failed", {
      agencyId: agency.id,
      error
    });
    redirectWithMessage("test_greska");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: agency.id,
    modul: "agencija.podesavanja.email",
    akcija: "send_test",
    tipEntiteta: "Agencija",
    entitetId: agency.id,
    novaVrijednost: { recipient: agency.email_reply_to }
  });

  redirectWithMessage("test_poslat");
}
