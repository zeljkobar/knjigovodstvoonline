"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { finishAdvanceAccounting } from "@/lib/advance-invoice-accounting";
import { setInvoiceAdvance, reconcileAdvanceSettlement, prepareAdvanceSettlement, sendAdvanceSettlement, createSettlementDraftForReview } from "@/lib/advance-invoice-service";
import { AdvanceWorkflowError } from "@/lib/advance-invoice";
import { FiscalAdminApiError } from "@/lib/fiscal-admin-api";
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
async function run(form: FormData, operation: "link" | "prepare" | "send" | "account") {
  const id = text(form, "faktura_id"), portal = text(form, "portal") === "yes";
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(portal ? "/portal/fakture" : "/agencija/robno/izlazne-fakture");
  if (portal && operation === "account") redirect("/portal/fakture");
  const path = portal ? `/portal/fakture/${id}` : `/agencija/robno/izlazne-fakture/${id}`;
  let ctx;
  if (portal) {
    const c = await requireDirectPortalContext([{modul:"robno",akcija:"create"},{modul:"fiskalizacija",akcija: operation === "link" ? "create" : "post"}, ...(operation === "link" ? [] : [{modul:"robno",akcija:"cancel"}])], path, "all");
    if (c.readiness.blocksChanges || c.year.zakljucena) redirect(`${path}?avans_poruka=${encodeURIComponent("Fiskalni rad je blokiran ili je godina zaključana.")}`);
    ctx = { agencijaId: c.user.agencija_id!, firmaId: c.firma.id, poslovnaGodinaId: c.year.id, userId: c.user.id, userName: c.user.korisnicko_ime };
  } else {
    const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
    const work = await readWorkContext();
    if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId) redirect("/agencija/robno/izlazne-fakture");
    await requirePermissionForUser(user, { firmaId: work.firmaId, modul: "robno", akcija: operation === "link" ? "update" : operation === "account" ? "post" : "cancel" });
    if (operation !== "account") await requirePermissionForUser(user, { firmaId: work.firmaId, modul: "fiskalizacija", akcija: operation === "link" ? "create" : "post" });
    ctx = { agencijaId: user.agencija_id, firmaId: work.firmaId, poslovnaGodinaId: work.poslovnaGodinaId, userId: user.id, userName: user.korisnicko_ime };
  }
  if (operation === "send" && text(form,"reviewed") !== "yes") redirect(`${path}?avans_poruka=${encodeURIComponent("Pregledajte umanjenje i potvrdite operaciju.")}`);
  let message = "Podaci avansa su sačuvani.";
  try {
    if (operation === "account") {
      const document=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,firma_id:ctx.firmaId,agencija_id:ctx.agencijaId,is_deleted:false},select:{vrsta_racuna:true}});
      if(document?.vrsta_racuna==="ADVANCE") await finishAdvanceAccounting(ctx,id);
      else await reconcileAdvanceSettlement(ctx,id,true);
      message="Knjiženje je pripremljeno. Dokument čeka preuzimanje u KIF.";
    }
    else if (operation === "link") await setInvoiceAdvance(ctx, id, text(form,"avansni_racun_id"), text(form,"iznos_avansa"));
    else if (operation === "prepare") { await prepareAdvanceSettlement(ctx,id,form); await createSettlementDraftForReview(ctx,id); message="Umanjenje je pripremljeno za pregled. Provjerite ga prije fiskalizacije."; }
    else { await sendAdvanceSettlement(ctx,id,text(form,"confirmation"),text(form,"expected_updated_at"),!portal); message="Status umanjenja je osvježen. Pregledajte dokument prije slanja."; }
  } catch(e) {
    message = e instanceof AdvanceWorkflowError ? e.message : e instanceof FiscalAdminApiError ? `Fiscal API: ${e.code}. Dokument je sačuvan; nastavite isti postupak.` : "Postupak nije završen. Provjerite podatke i nastavite isti dokument.";
  }
  revalidatePath(path); revalidatePath("/portal/fakture"); revalidatePath("/agencija/robno/izlazne-fakture");
  redirect(`${path}?avans_poruka=${encodeURIComponent(message)}#avans`);
}
export async function saveInvoiceAdvance(form: FormData) { return run(form,"link"); }
export async function prepareInvoiceAdvanceSettlement(form: FormData) { return run(form,"prepare"); }
export async function submitInvoiceAdvanceSettlement(form: FormData) { return run(form,"send"); }

export async function finishInvoiceAdvanceAccounting(form:FormData) { return run(form,"account"); }
