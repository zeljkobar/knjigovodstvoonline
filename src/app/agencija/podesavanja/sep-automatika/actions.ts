"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSepCompany } from "@/lib/sep-context";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { sepKeyConfigured } from "@/lib/sep-secrets";
import { sepAutomationDay } from "@/lib/sep-automation-policy";

const path = "/agencija/podesavanja/sep-automatika";
const resultsPath = "/agencija/automatski-obradjena-dokumenta";
function done(message: string, destination = path): never { revalidatePath(path); revalidatePath(resultsPath); redirect(`${destination}?poruka=${message}`); }
export async function saveSepAutomation(form: FormData) {
  const context = await getSepCompany(String(form.get("firma_id") ?? ""));
  const enabled = form.get("aktivna") === "on";
  const certificateId = String(form.get("sertifikat_id") ?? ""), typeId = String(form.get("racun_vrsta_id") ?? "");
  const revision = Number(form.get("revizija") ?? 0);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${context.firm.id}::uuid FOR UPDATE`;
    const previous = await tx.sepAutomatikaPodesavanje.findUnique({ where: { firma_id: context.firm.id } });
    if ((previous?.revizija ?? 0) !== revision) return "revizija";
    if (!enabled && previous) {
      await tx.sepAutomatikaPodesavanje.update({ where: { id: previous.id }, data: { aktivna: false, revizija: { increment: 1 } } });
    } else {
      if (!enabled && !previous) return "sacuvano";
      if (!/^[0-9a-f-]{36}$/i.test(certificateId) || !/^[0-9a-f-]{36}$/i.test(typeId)) return "podaci";
      if (previous && previous.racun_vrsta_id !== typeId && await tx.kifEntry.count({ where: { agencija_id: context.agencyId, firma_id: context.firm.id, sep_automation: true, posting_status: "UNPOSTED", is_deleted: false } })) return "nezavrseno";
      const certificate = await tx.agencijaSepSertifikat.findFirst({ where: { id: certificateId, agencija_id: context.agencyId, is_deleted: false, sifrovani_podaci: { not: null }, korisnik: { agencija_id: context.agencyId, rola: "admin_agencije", aktivan: true, is_deleted: false } } });
      const type = await tx.racunVrsta.findFirst({ where: { id: typeId, agencija_id: context.agencyId, firma_id: context.firm.id, dokument_tip: "KIF", aktivna: true }, include: { kontiranjePravila: { where: { aktivno: true } } } });
      if (!certificate || !type || (enabled && (!sepKeyConfigured() || !type.vrsta_naloga_id || !type.kontiranjePravila.length))) return "podaci";
      await tx.sepAutomatikaPodesavanje.upsert({ where: { firma_id: context.firm.id }, create: { agencija_id: context.agencyId, firma_id: context.firm.id, sertifikat_id: certificate.id, racun_vrsta_id: type.id, aktivna: enabled }, update: { sertifikat_id: certificate.id, racun_vrsta_id: type.id, aktivna: enabled, revizija: { increment: 1 } } });
    }
    await auditLogInTransaction(tx, { korisnikId: context.user.id, agencijaId: context.agencyId, firmaId: context.firm.id, modul: "sep", akcija: "SAVE_AUTOMATION", tipEntiteta: "Firma", entitetId: context.firm.id, staraVrijednost: previous ? { aktivna: previous.aktivna, sertifikat_id: previous.sertifikat_id, racun_vrsta_id: previous.racun_vrsta_id } : undefined, novaVrijednost: { aktivna: enabled, sertifikat_id: !enabled && previous ? previous.sertifikat_id : certificateId, racun_vrsta_id: !enabled && previous ? previous.racun_vrsta_id : typeId } });
    return "sacuvano";
  });
  done(result);
}
export async function retrySepAutomation(form: FormData) {
  const context = await getSepCompany(String(form.get("firma_id") ?? ""));
  const { day: today } = sepAutomationDay();
  const day = String(form.get("dan") ?? today);
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day || day > today) done("podaci", resultsPath);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${context.firm.id}::uuid FOR UPDATE`;
    const config = await tx.sepAutomatikaPodesavanje.findFirst({ where: { firma_id: context.firm.id, agencija_id: context.agencyId, aktivna: true } });
    if (!config) return "iskljuceno";
    const run = await tx.sepAutomatikaObrada.findUnique({ where: { firma_id_dan: { firma_id: context.firm.id, dan: date } } });
    if (!run && day !== today) return "podaci";
    if (run?.status === "RUNNING") return "u_toku";
    await tx.sepAutomatikaObrada.upsert({ where: { firma_id_dan: { firma_id: context.firm.id, dan: date } }, create: { agencija_id: context.agencyId, firma_id: context.firm.id, dan: date }, update: { status: "PENDING", kraj: null } });
    await auditLogInTransaction(tx, { korisnikId: context.user.id, agencijaId: context.agencyId, firmaId: context.firm.id, modul: "sep", akcija: "QUEUE_AUTOMATION_RETRY", tipEntiteta: "Firma", entitetId: context.firm.id, novaVrijednost: { dan: day } });
    return "zakazano";
  });
  done(result, resultsPath);
}
