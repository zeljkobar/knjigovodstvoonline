"use server";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyFiscalEnvironmentRepair } from "@/lib/fiscal-environment-repair";
import { isFiscalUuid } from "@/lib/fiscal-review-filters";

export async function confirmMissingFiscalEnvironment(form: FormData) {
  const admin = await requireRole("admin");
  const id = String(form.get("invoiceId") ?? "");
  if (!isFiscalUuid(id) || form.get("confirmation") !== "CONFIRM_ENVIRONMENT") throw new Error("Potvrdite predloženu dopunu okruženja.");
  try { await applyFiscalEnvironmentRepair({ id: admin.id, name: admin.korisnicko_ime }, id, String(form.get("version") ?? "")); }
  catch { redirect(`/admin/fiskalizacija/usaglasavanje/${id}?rezultat=greska`); }
  revalidatePath("/admin/fiskalizacija/usaglasavanje");
  revalidatePath("/agencija/pos/promet");
  revalidatePath("/portal/izvjestaji");
  redirect(`/admin/fiskalizacija/usaglasavanje/${id}?rezultat=sacuvano`);
}
