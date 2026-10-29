"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireImapAgency } from "../../izvodi/imap/access";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { encryptMailPassword, mailKeyConfigured } from "@/lib/mail-secrets";
import { mailAccountOptions, mailAccountPublicSelect } from "@/lib/mail-accounts";
import { testImapConnection, type ImapTestResult } from "@/lib/imap-connection";

const path = "/agencija/podesavanja/mail-nalozi";
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
export async function saveMailAccount(form: FormData) {
  const user = await requireImapAgency();
  const accountId = text(form, "id"), id = accountId || randomUUID();
  const name = text(form, "naziv"), host = text(form, "host").toLowerCase(), username = text(form, "korisnicko_ime");
  const password = String(form.get("lozinka") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !name || name.length > 100 || /[\r\n\x00]/.test(name) ||
      !/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      !username || username.length > 320 || /[\r\n\x00]/.test(username) || password.length > 4096 ||
      /[\r\n\x00]/.test(password) || (!accountId && !password)) redirect(`${path}?poruka=podaci`);
  if (!mailKeyConfigured()) redirect(`${path}?poruka=kljuc`);
  let failed = false;
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM agencije WHERE id=${user.agencija_id}::uuid AND aktivan=true AND is_deleted=false FOR UPDATE`;
      const agency = await tx.agencija.findFirst({ where: { id: user.agencija_id!, aktivan: true, is_deleted: false } });
      if (!agency) throw new Error("scope");
      const old = accountId ? await tx.agencijaMailNalog.findFirst({ where: { id, agencija_id: user.agencija_id!, is_deleted: false }, select: mailAccountPublicSelect }) : null;
      if (accountId && (!old || old.updated_at.toISOString() !== text(form, "version"))) throw new Error("stale");
      if (old && (old.host !== host || old.korisnicko_ime !== username)) throw new Error("identity");
      const data = { naziv: name, host, korisnicko_ime: username, port: 993, aktivan: form.get("aktivan") === "on", automatska_obrada: form.get("automatska_obrada") === "on", updated_by: user.id };
      const account = old
        ? await tx.agencijaMailNalog.update({ where: { id }, data: { ...data, ...(password ? { lozinka_sifrovana: encryptMailPassword(password, user.agencija_id!, id) } : {}) }, select: mailAccountPublicSelect })
        : await tx.agencijaMailNalog.create({ data: { ...data, id, agencija_id: user.agencija_id!, lozinka_sifrovana: encryptMailPassword(password, user.agencija_id!, id), created_by: user.id }, select: mailAccountPublicSelect });
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: user.agencija_id,
        modul: "izvodi", akcija: "MAIL_ACCOUNT_SAVE", tipEntiteta: "AgencijaMailNalog", entitetId: id,
        staraVrijednost: old, novaVrijednost: { ...account, passwordChanged: Boolean(password) } });
    });
  } catch { failed = true; }
  if (failed) redirect(`${path}?poruka=greska`);
  revalidatePath(path); revalidatePath("/agencija/izvodi", "layout");
  redirect(`${path}?poruka=sacuvano`);
}
export async function checkSavedMailAccount(accountId: string): Promise<ImapTestResult> {
  const user = await requireImapAgency();
  let result: ImapTestResult;
  try { result = await testImapConnection(await mailAccountOptions(user.agencija_id!, accountId), `${user.agencija_id}:${accountId}`); }
  catch { result = { ok: false, code: "CONFIG", message: "Nalog nije dostupan ili ključ za šifrovanje nije podešen." }; }
  await prisma.$transaction(tx => auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: user.agencija_id,
    modul: "izvodi", akcija: "IMAP_CONNECTION_TEST", tipEntiteta: "IMAP_CONNECTION",
    novaVrijednost: { status: result.ok ? "OK" : result.code } }));
  return result;
}
