"use server";

import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { generatePosKifBatch } from "@/lib/pos-batches";
import { posModule, requirePosContext } from "@/lib/pos";

export async function createPosBatch(formData: FormData) {
  const ctx = await requirePosContext("manage");
  const mode = String(formData.get("mode") ?? "").trim();
  const rawDate = String(formData.get("period_date") ?? "").trim();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  if (!selectedDate || Number.isNaN(selectedDate.getTime())) redirect("/agencija/pos/obrada?poruka=datum");
  const result = await generatePosKifBatch({ agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, year: ctx.year.godina, mode, selectedDate, userId: ctx.user.id });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: result.ok ? "generate_pos_kif_batch" : "generate_pos_kif_batch_failed", tipEntiteta: "PosKifBatch", entitetId: result.ok ? result.batchId : null, novaVrijednost: result });
  if (!result.ok) redirect(`/agencija/pos/obrada?poruka=${result.reason}`);
  redirect(`/agencija/pos/obrada?uspjeh=${result.batchId}`);
}
