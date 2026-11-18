"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rawPrisma } from "@/lib/prisma";
import { saveAgencyPartner, AgencyPartnerEditError } from "@/lib/agency-partner-edit";

export async function saveGlobalPartnerForAgency(form: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const nullable = (key: string) => text(key) || null;
  const firmaId = text("firma_id");
  const partnerId = text("partner_id");
  const version = Number(text("override_version"));
  const tip = text("tip_komitenta") || "kupac_dobavljac";
  const days = text("rok_placanja_dana") ? Number(text("rok_placanja_dana")) : null;
  const registered = text("datum_registracije") ? new Date(`${text("datum_registracije")}T00:00:00Z`) : null;
  if (!user.agencija_id || !firmaId || !partnerId || !text("naziv") || !Number.isSafeInteger(version) || version < 0
    || !["kupac", "dobavljac", "kupac_dobavljac", "radnik", "ostalo"].includes(tip)
    || (days !== null && (!Number.isSafeInteger(days) || days < 0)) || (registered && !Number.isFinite(registered.getTime()))) {
    redirect("/agencija/nalozi/partneri?poruka=partner_greska");
  }
  if (!(await hasPermission(user, { firmaId, modul: "nalozi", akcija: "update" }))) {
    redirect("/agencija/nalozi/partneri?poruka=prava");
  }
  let message = "partner_agencijski";
  try {
    await rawPrisma.$transaction(tx => saveAgencyPartner(tx, {
      agencijaId: user.agencija_id!, firmaId, userId: user.id, admin: user.rola === "admin_agencije",
      partnerId, version,
      data: {
        naziv: text("naziv"), pib: nullable("pib"), pdv_broj: nullable("pdv_broj"),
        maticni_broj: nullable("maticni_broj"), pravna_forma: nullable("pravna_forma"),
        sifra_djelatnosti: nullable("sifra_djelatnosti"), datum_registracije: registered,
        adresa: nullable("adresa"), grad: nullable("grad"), drzava: nullable("drzava"),
        telefon: nullable("telefon"), email: nullable("email"), web_sajt: nullable("web_sajt"),
        is_foreign: text("is_foreign") === "1", country_code: nullable("country_code"),
        country_name: nullable("country_name"), foreign_tax_number: nullable("foreign_tax_number")
      },
      settings: { tip_komitenta: tip as "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo",
        sifra_u_firmi: nullable("sifra_u_firmi"), rok_placanja_dana: days, napomena: nullable("napomena") }
    }));
  } catch (error) {
    message = error instanceof AgencyPartnerEditError ? error.message : "partner_greska";
  }
  revalidatePath("/agencija", "layout");
  revalidatePath("/portal", "layout");
  redirect(`/agencija/nalozi/partneri?partner=${encodeURIComponent(partnerId)}&poruka=${encodeURIComponent(message)}#partner-form`);
}
