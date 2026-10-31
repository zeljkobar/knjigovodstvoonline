"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { fiscalPortalContext, fiscalPortalPublicSelect, isFiscalPortalProvider } from "@/lib/fiscal-portals";
import { encryptPortalPassword, fiscalPortalKeyConfigured } from "@/lib/fiscal-portal-secrets";
const path = "/agencija/racuni/fiskalni-portali";
export async function saveFiscalPortal(form: FormData) {
  const ctx = await fiscalPortalContext("manage", String(form.get("firma_id") ?? ""));
  const provider = String(form.get("provider") ?? ""), username = String(form.get("korisnicko_ime") ?? "").trim(), password = String(form.get("lozinka") ?? ""), version = String(form.get("version") ?? "");
  const defaultDevice = String(form.get("podrazumijevana_kasa") ?? "").trim();
  if (defaultDevice && !/^[\w-]{1,100}$/.test(defaultDevice)) redirect(`${path}?poruka=podaci`);
  if (!isFiscalPortalProvider(provider) || username.length > 320 || password.length > 4096 || (provider === "VG_EFISKAL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username))) redirect(`${path}?poruka=podaci`);
  if (!fiscalPortalKeyConfigured()) redirect(`${path}?poruka=kljuc`);
  let failed = false;
  try { await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${ctx.firm.id}::uuid AND agencija_id=${ctx.agencyId}::uuid AND aktivan=true AND is_deleted=false FOR UPDATE`;
    if (!await tx.firma.count({ where: { id: ctx.firm.id, agencija_id: ctx.agencyId, aktivan: true, is_deleted: false } })) throw new Error("scope");
    const old = await tx.firmaFiskalniPortal.findFirst({ where: { firma_id: ctx.firm.id, agencija_id: ctx.agencyId } });
    if ((old?.updated_at.toISOString() ?? "") !== version || (provider === "VG_EFISKAL" && !password && (!old?.lozinka_sifrovana || old.provider !== provider || old.korisnicko_ime !== username))) throw new Error("version");
    const id = old?.id ?? randomUUID();
    const data = { provider, korisnicko_ime: provider === "VG_EFISKAL" ? username : null, aktivan: form.get("aktivan") === "on", is_deleted: false, deleted_at: null, deleted_by: null, podrazumijevana_kasa: old?.provider === provider && old.korisnicko_ime === (provider === "VG_EFISKAL" ? username : null) ? defaultDevice || null : null, lozinka_sifrovana: provider === "SUMMA_FISKAL" ? null : password ? encryptPortalPassword(password, `${ctx.agencyId}:${ctx.firm.id}:${id}`) : old!.lozinka_sifrovana, updated_by: ctx.user.id };
    const saved = old ? await tx.firmaFiskalniPortal.update({ where: { id }, data, select: fiscalPortalPublicSelect }) : await tx.firmaFiskalniPortal.create({ data: { ...data, id, agencija_id: ctx.agencyId, firma_id: ctx.firm.id, created_by: ctx.user.id }, select: fiscalPortalPublicSelect });
    await auditLogInTransaction(tx, { korisnikId: ctx.user.id, agencijaId: ctx.agencyId, firmaId: ctx.firm.id, modul: "izlazni_racuni", akcija: "FISCAL_PORTAL_SAVE", tipEntiteta: "FirmaFiskalniPortal", entitetId: id, staraVrijednost: old ? { provider: old.provider, korisnicko_ime: old.korisnicko_ime, aktivan: old.aktivan } : undefined, novaVrijednost: { ...saved, passwordChanged: Boolean(password) } });
  }); } catch { failed = true; }
  if (failed) redirect(`${path}?poruka=greska`);
  revalidatePath(path); revalidatePath("/agencija/racuni/podesavanja"); redirect(`${path}?poruka=sacuvano`);
}
