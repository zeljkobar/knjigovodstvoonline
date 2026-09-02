"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const path = "/agencija/podesavanja/poslovne-jedinice";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function go(poruka: string, params?: Record<string, string>) : never {
  const query = new URLSearchParams({ poruka, ...params });
  redirect(`${path}?${query.toString()}`);
}

async function requireContext(action: PermissionAction, firmaId: string) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !firmaId || workContext.firmaId !== firmaId) {
    go("kontekst");
  }

  const [firma, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
      },
      select: { id: true }
    }),
    hasPermission(user, { firmaId, modul: "nalozi", akcija: action })
  ]);

  if (!firma) go("kontekst");
  if (!allowed) go("prava");

  return { user, agencijaId: user.agencija_id };
}

function revalidate() {
  revalidatePath(path);
  revalidatePath("/agencija/robno/magacini");
  revalidatePath("/agencija/robno/kalkulacije");
  revalidatePath("/agencija/nalozi/novi");
}

export async function createBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const context = await requireContext("create", firmaId);
  const sifra = text(formData, "sifra").toUpperCase();
  const naziv = text(formData, "naziv");

  if (!sifra || !naziv) go("obavezno");

  const duplicate = await prisma.poslovnaJedinica.findFirst({
    where: { firma_id: firmaId, sifra },
    select: { id: true }
  });
  if (duplicate) go("postoji", { q: sifra });

  const unit = await prisma.poslovnaJedinica.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      sifra,
      naziv,
      tip: text(formData, "tip") || "OTHER",
      adresa: nullableText(formData, "adresa"),
      grad: nullableText(formData, "grad"),
      napomena: nullableText(formData, "napomena"),
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: "agencija.podesavanja.poslovne_jedinice",
    akcija: "create",
    tipEntiteta: "PoslovnaJedinica",
    entitetId: unit.id,
    novaVrijednost: unit
  });

  revalidate();
  go("kreirana", { q: sifra });
}

export async function updateBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const unitId = text(formData, "poslovna_jedinica_id");
  const context = await requireContext("update", firmaId);
  const sifra = text(formData, "sifra").toUpperCase();
  const naziv = text(formData, "naziv");

  if (!unitId || !sifra || !naziv) go("obavezno");

  const [existing, duplicate] = await Promise.all([
    prisma.poslovnaJedinica.findFirst({
      where: {
        id: unitId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.poslovnaJedinica.findFirst({
      where: { firma_id: firmaId, sifra, NOT: { id: unitId } },
      select: { id: true }
    })
  ]);
  if (!existing) go("nije_pronadjena");
  if (duplicate) go("postoji", { uredi: unitId });

  const unit = await prisma.poslovnaJedinica.update({
    where: { id: unitId },
    data: {
      sifra,
      naziv,
      tip: text(formData, "tip") || "OTHER",
      adresa: nullableText(formData, "adresa"),
      grad: nullableText(formData, "grad"),
      napomena: nullableText(formData, "napomena"),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: "agencija.podesavanja.poslovne_jedinice",
    akcija: "update",
    tipEntiteta: "PoslovnaJedinica",
    entitetId: unit.id,
    staraVrijednost: existing,
    novaVrijednost: unit
  });

  revalidate();
  go("sacuvana");
}

export async function toggleBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const unitId = text(formData, "poslovna_jedinica_id");
  const aktivna = text(formData, "aktivna") === "true";
  const context = await requireContext("update", firmaId);
  const existing = await prisma.poslovnaJedinica.findFirst({
    where: {
      id: unitId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });
  if (!existing) go("nije_pronadjena");

  const unit = await prisma.poslovnaJedinica.update({
    where: { id: unitId },
    data: { aktivna, updated_by: context.user.id }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: "agencija.podesavanja.poslovne_jedinice",
    akcija: aktivna ? "activate" : "deactivate",
    tipEntiteta: "PoslovnaJedinica",
    entitetId: unit.id,
    staraVrijednost: existing,
    novaVrijednost: unit
  });

  revalidate();
  go(aktivna ? "aktivirana" : "deaktivirana");
}
