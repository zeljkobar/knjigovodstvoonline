"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSepAdmin } from "@/lib/sep-context";
import { encryptSepCredentials, validateSepCredentials, MAX_SEP_PFX_BYTES } from "@/lib/sep-secrets";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";

export async function saveSepCertificate(form: FormData) {
  const { user, agencyId, scope } = await getSepAdmin();
  const file = form.get("sertifikat");
  const name = String(form.get("naziv") ?? "").trim();
  let result = "sacuvano";
  if (!(file instanceof File) || file.size > MAX_SEP_PFX_BYTES || !/\.(pfx|p12)$/i.test(file.name) || !name || name.length > 120) {
    redirect("/agencija/sep?poruka=podaci");
  }
  const pfx = Buffer.from(await file.arrayBuffer());
  try {
    const password = String(form.get("lozinka") ?? "");
    const jmbg = String(form.get("jmbg") ?? "").trim();
    validateSepCredentials(pfx, password, jmbg);
    const encrypted = encryptSepCredentials({ pfx: pfx.toString("base64"), password, jmbg }, scope);
    await prisma.$transaction(async tx => {
      const record = await tx.agencijaSepSertifikat.upsert({
        where: { agencija_id_korisnik_id: { agencija_id: agencyId, korisnik_id: user.id } },
        create: { agencija_id: agencyId, korisnik_id: user.id, naziv: name, sifrovani_podaci: encrypted },
        update: { naziv: name, sifrovani_podaci: encrypted, is_deleted: false, deleted_at: null, deleted_by: null },
      });
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: agencyId, modul: "sep", akcija: "SAVE_CERTIFICATE", tipEntiteta: "AgencijaSepSertifikat", entitetId: record.id });
    });
  } catch (error) {
    result = error instanceof Error && error.message === "SEP_KEY_MISSING" ? "kljuc" : "sertifikat";
  } finally { pfx.fill(0); }
  revalidatePath("/agencija/sep");
  redirect(`/agencija/sep?poruka=${result}`);
}
export async function removeSepCertificate() {
  const { user, agencyId } = await getSepAdmin();
  await prisma.$transaction(async tx => {
    const changed = await tx.agencijaSepSertifikat.updateMany({
      where: { agencija_id: agencyId, korisnik_id: user.id, is_deleted: false },
      data: { is_deleted: true, deleted_at: new Date(), deleted_by: user.id, sifrovani_podaci: null },
    });
    if (changed.count) await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: agencyId, modul: "sep", akcija: "REMOVE_CERTIFICATE", tipEntiteta: "AgencijaSepSertifikat" });
  });
  revalidatePath("/agencija/sep");
  redirect("/agencija/sep?poruka=uklonjen");
}
