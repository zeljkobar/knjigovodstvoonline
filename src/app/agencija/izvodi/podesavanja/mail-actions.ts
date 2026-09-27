"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireImapCompany, requireImapAgency } from "../imap/access";
import { getIzvodiContext } from "../_shared";
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { listMailFolders, MailError } from "@/lib/imap-mail";
import { parseMailRules } from "@/lib/company-mail-rules";

export async function loadCompanyMailFolders() {
  await requireImapAgency();
  try { return { ok: true as const, folders: await listMailFolders() }; }
  catch (error) { return { ok: false as const, message: error instanceof MailError ? error.message : "Foldere nije moguće učitati." }; }
}

export async function saveCompanyMailSettings(_previous: { message: string; ok: boolean }, form: FormData) {
  const { user, firma } = await requireImapCompany(String(form.get("firma_id") || "missing"));
  const context = await getIzvodiContext("manage");
  if (!context.godina || context.firma?.id !== firma.id || String(form.get("godina_id")) !== context.godina.id) return { ok: false, message: "Radni kontekst je promijenjen. Osvježite stranicu." };
  if (context.godina.zakljucena) return { ok: false, message: "Poslovna godina je zaključena." };
  const folder = String(form.get("folder") || "").trim() || null;
  if (folder && (folder.length > 1024 || /[\x00\r\n]/.test(folder))) return { ok: false, message: "Neispravan folder." };
  const includeInbox = form.get("ukljuci_inbox") === "on";
  if (!folder && !includeInbox) return { ok: false, message: "Izaberite folder ili uključite INBOX." };
  let rules;
  try {
    const value = String(form.get("pravila") || "[]");
    if (value.length > 25000) throw new Error("Previše podataka u pravilima.");
    rules = parseMailRules(JSON.parse(value));
  } catch { return { ok: false, message: "Provjerite pravila: do 20 redova, polja do 320 znakova, pošiljalac je puna email adresa ili prazno." }; }
  try {
    if (folder) {
      const folders = await listMailFolders();
      if (!folders.some((item) => item.path === folder)) return { ok: false, message: "Folder nije pronađen na mail serveru. Ponovo učitajte foldere." };
    }
    const data = { folder, ukljuci_inbox: includeInbox, ukljuci_podfoldere: form.get("ukljuci_podfoldere") === "on",
      aktivno: form.get("aktivno") === "on", pravila: rules, updated_by: user.id };
    const changes = await prisma.$transaction(async (tx) => {
      // Coordinate with company purge and verify tenant again before writing.
      const scope = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM firme WHERE id = ${firma.id}::uuid AND agencija_id = ${user.agencija_id}::uuid AND aktivan = true AND is_deleted = false FOR UPDATE`;
      if (!scope.length) throw new Error("scope");
      const year = await tx.poslovnaGodina.findFirst({ where: { id: context.godina!.id, firma_id: firma.id, zakljucena: false } });
      if (!year) throw new Error("year");
      const old = await tx.firmaMailPodesavanje.findUnique({ where: { firma_id: firma.id } });
      if (old && old.agencija_id !== user.agencija_id) throw new Error("scope");
      if ((old?.updated_at.toISOString() || "") !== String(form.get("version") || "")) throw new Error("stale");
      const updated = await tx.firmaMailPodesavanje.upsert({ where: { firma_id: firma.id },
        create: { ...data, agencija_id: user.agencija_id!, firma_id: firma.id, created_by: user.id },
        update: { ...data, is_deleted: false, deleted_at: null, deleted_by: null }
      });
      return { old, updated };
    });
    await auditLog({ korisnikId: user.id, agencijaId: user.agencija_id, firmaId: firma.id,
      modul: "izvodi", akcija: "MAIL_SETTINGS_UPDATE", tipEntiteta: "FirmaMailPodesavanje", entitetId: changes.updated.id,
      staraVrijednost: changes.old, novaVrijednost: changes.updated });
    revalidatePath("/agencija/izvodi/podesavanja");
    revalidatePath("/agencija/izvodi/imap");
  } catch (error) {
    return { ok: false, message: error instanceof MailError ? error.message : "Podešavanja nijesu sačuvana ili potvrđena. Osvježite stranicu i provjerite kontekst i posljednje izmjene." };
  }
  redirect("/agencija/izvodi/podesavanja?poruka=mail_sacuvana");
}
