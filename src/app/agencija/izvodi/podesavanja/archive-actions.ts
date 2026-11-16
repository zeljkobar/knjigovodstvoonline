"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { auditLogInTransaction } from "@/lib/audit";
import { driveItemPath, graph, oneDriveAccess, type DriveItem } from "@/lib/dokumentacija-onedrive";
import { prisma } from "@/lib/prisma";
import { getIzvodiContext } from "../_shared";

const settingsPath = "/agencija/izvodi/podesavanja";

export async function saveStatementArchiveFolder(formData: FormData) {
  await requireRole("admin_agencije");
  const { user, firma, godina } = await getIzvodiContext("update");
  const bankId = String(formData.get("bankId") ?? "");
  const folderId = String(formData.get("folderId") ?? "");
  const unlink = formData.get("unlink") === "true";
  if ((!unlink && !folderId) || !user.agencija_id || !firma || !godina || formData.get("firmaId") !== firma.id ||
      formData.get("yearId") !== godina.id || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(bankId)) {
    redirect(`${settingsPath}?poruka=arhiva_greska`);
  }
  const scope = { agencija_id: user.agencija_id, firma_id: firma.id, poslovna_godina_id: godina.id };
  try {
    const bank = await prisma.firmaBankovniRacun.findFirst({
      where: { id: bankId, agencija_id: scope.agencija_id, firma_id: firma.id, is_deleted: false, aktivan: true }
    });
    if (!bank) throw new Error();
    const key = { firma_id: firma.id, poslovna_godina_id: godina.id, bankovni_racun_id: bank.id };
    const where = { firma_id_poslovna_godina_id_bankovni_racun_id: key };
    let destination: { drive_id: string; folder_id: string; naziv: string } | null = null;
    if (!unlink) {
      const { token, driveId } = await oneDriveAccess(scope.agencija_id);
      const item = await graph<DriveItem>(token, driveItemPath(driveId, folderId));
      if (!item.folder || !item.parentReference?.id || item.parentReference.driveId !== driveId) throw new Error();
      destination = { drive_id: driveId, folder_id: item.id, naziv: item.name };
    }

    await prisma.$transaction(async tx => {
      const previous = await tx.bankStatementArchiveFolder.findFirst({ where: { ...scope, bankovni_racun_id: bank.id } });
      if (destination) {
        await tx.bankStatementArchiveFolder.upsert({
          where: { ...where, agencija_id: scope.agencija_id },
          create: { ...scope, bankovni_racun_id: bank.id, ...destination }, update: destination
        });
        await tx.mailIzvodObrada.updateMany({
          where: { ...scope, arhiva_status: { in: ["RETRY", "REVIEW"] }, izvod: { ...scope, company_bank_account_id: bank.id } },
          data: { arhiva_status: null, arhiva_greska: null, arhiva_pokusaj_at: null }
        });
      } else {
        await tx.bankStatementArchiveFolder.deleteMany({ where: { ...scope, bankovni_racun_id: bank.id } });
      }
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: firma.id,
        modul: "agencija.izvodi", akcija: "ONEDRIVE_FOLDER", tipEntiteta: "FirmaBankovniRacun", entitetId: bank.id,
        staraVrijednost: previous, novaVrijednost: { godinaId: godina.id, ...destination } });
    });
  } catch {
    redirect(`${settingsPath}?poruka=arhiva_greska`);
  }
  redirect(`${settingsPath}?poruka=arhiva_sacuvana`);
}
