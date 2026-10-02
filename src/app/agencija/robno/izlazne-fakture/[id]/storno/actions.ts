"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getInventoryContext } from "../../../_shared";
import { prisma } from "@/lib/prisma";
import { createAndFiscalizeOfficeStorno, OfficeStornoError } from "@/lib/outgoing-invoice-storno";

export async function submitOfficeStorno(form: FormData) {
  const ctx = await getInventoryContext(["view", "cancel", "post"]);
  const id = String(form.get("original_id") ?? "");
  if (!ctx.allowed || !ctx.firma || !ctx.user.agencija_id) redirect("/agencija/robno/izlazne-fakture?poruka=prava");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || String(form.get("firma_id")) !== ctx.firma.id) redirect("/agencija/robno/izlazne-fakture?poruka=prava");
  const original = await prisma.fiskalniIzlazniRacun.findFirst({ where: { id, agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, document_type: "INVOICE", sales_channel: "OFFICE", is_deleted: false }, include: { corrective_invoices: { where: { is_deleted: false }, select: { poslovna_godina_id: true } } } });
  if (!original) redirect("/agencija/robno/izlazne-fakture?poruka=nije_nacrt");
  const currentYear = Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Europe/Podgorica" }).format(new Date()));
  const year = await prisma.poslovnaGodina.findFirst({ where: { firma_id: ctx.firma.id, ...(original.corrective_invoices[0] ? { id: original.corrective_invoices[0].poslovna_godina_id } : { godina: currentYear }) } });
  if (!year) redirect(`/agencija/robno/izlazne-fakture/${id}/storno?poruka=storno_godina`);
  let message = "storno_provjera";
  try {
    const result = await createAndFiscalizeOfficeStorno({ context: { agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, yearId: year.id, userId: ctx.user.id, userName: ctx.user.korisnicko_ime }, originalId: id, reason: String(form.get("reason") ?? ""), confirmed: form.get("confirmation") === "CONFIRM" });
    message = result.issue ?? (result.state === "complete" ? "storno_zavrsen" : "storno_cekanje");
  } catch (error) {
    if (error instanceof OfficeStornoError) message = error.code;
    else throw error;
  }
  revalidatePath("/agencija/robno/izlazne-fakture");
  revalidatePath("/agencija/robno/izlazne-fakture/[id]", "page");
  revalidatePath(`/agencija/robno/izlazne-fakture/${id}/storno`);
  revalidatePath("/agencija/racuni/kif", "layout");
  redirect(`/agencija/robno/izlazne-fakture/${id}/storno?poruka=${encodeURIComponent(message)}`);
}
