"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { returnDecimal, SupplierReturnError, returnFail } from "@/lib/supplier-return";
import { deleteReturnDraft, postSupplierReturn, returnPath, saveReturnHeader, saveReturnLine, type ReturnContext } from "@/lib/supplier-return-service";

const text = (f: FormData, name: string) => String(f.get(name) ?? "").trim();
const optional = (f: FormData, name: string) => text(f, name) || null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(f: FormData, name: string, required = true) {
  const value = text(f, name);
  if ((!value && required) || (value && !uuid.test(value))) returnFail("Neispravan izbor dokumenta ili šifarnika.");
  return value;
}
function date(f: FormData) {
  const raw = text(f, "datum");
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) returnFail("Neispravan datum.");
  return d;
}
async function run(f: FormData, work: (tx: Prisma.TransactionClient, c: ReturnContext) => Promise<string>, success: string, anchor = "") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const ctx = await readWorkContext();
  const document = text(f, "povrat_id");
  const back = uuid.test(document) ? `${returnPath}/${document}` : returnPath;
  let result = "";
  let message = success;
  try {
    if (!user.agencija_id || !ctx.firmaId || !ctx.poslovnaGodinaId || ctx.firmaId !== id(f, "firma_id") || ctx.poslovnaGodinaId !== id(f, "godina_id")) returnFail("Radni kontekst je promijenjen. Ponovo otvorite dokument.");
    result = await prisma.$transaction(tx => work(tx, { userId: user.id, agencyId: user.agencija_id!, companyId: ctx.firmaId!, yearId: ctx.poslovnaGodinaId! }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch (error) {
    if (error instanceof SupplierReturnError) message = error.message;
    else if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) message = "Podaci su istovremeno promijenjeni. Osvježite stranicu i pokušajte ponovo.";
    else throw error;
    redirect(`${back}?greska=${encodeURIComponent(message)}${anchor}`);
  }
  for (const path of [returnPath, "/agencija/robno", "/agencija/robno/lager", "/agencija/robno/kartica-artikla", "/agencija/robno/vrijednost-zaliha", "/agencija/izvjestaji", "/agencija/nalozi", "/agencija/racuni", "/agencija/pdv"]) revalidatePath(path, "layout");
  redirect(`${result ? `${returnPath}/${result}` : returnPath}?poruka=${encodeURIComponent(message)}${anchor}`);
}
export async function saveSupplierReturn(f: FormData) {
  await run(f, (tx, c) => saveReturnHeader(tx, c, { date: date(f), warehouseId: id(f, "magacin_id"), supplierId: id(f, "dobavljac_id"), calculationId: id(f, "kalkulacija_id", false) || null, originalKufId: id(f, "originalni_kuf_id", false) || null, bookId: id(f, "kuf_book_id", false) || null, creditNumber: text(f, "broj_odobrenja"), note: optional(f, "napomena") }, id(f, "povrat_id", false) || undefined), "Nacrt povrata je sačuvan.");
}
export async function saveSupplierReturnLine(f: FormData) {
  await run(f, async (tx, c) => {
    const doc = id(f, "povrat_id");
    await saveReturnLine(tx, c, doc, { itemId: id(f, "artikal_id"), quantity: returnDecimal(text(f, "kolicina"), 3), creditPrice: returnDecimal(text(f, "cijena_odobrenja"), 4), vatRateId: id(f, "pdv_stopa_id"), calculationLineId: id(f, "stavka_kalkulacije_id", false) || null }, id(f, "stavka_id", false) || undefined);
    return doc;
  }, "Stavka je sačuvana.", text(f, "stavka_id") ? "#stavke" : "#dodaj-robu");
}
export async function deleteSupplierReturn(f: FormData) {
  await run(f, async (tx, c) => {
    const doc = id(f, "povrat_id"), line = id(f, "stavka_id", false);
    if (!line && text(f, "potvrda") !== "on") returnFail("Potvrdite brisanje nacrta.");
    await deleteReturnDraft(tx, c, doc, line || undefined);
    return line ? doc : "";
  }, "Nacrt ili stavka je obrisana.", text(f, "stavka_id") ? "#stavke" : "");
}
export async function postSupplierReturnAction(f: FormData) {
  await run(f, async (tx, c) => {
    if (text(f, "potvrda") !== "on") returnFail("Potvrdite knjiženje povrata, naloga i negativnog KUF zapisa.");
    return postSupplierReturn(tx, c, id(f, "povrat_id"));
  }, "Povrat je proknjižen. Lager, obaveza i KUF su usklađeni.");
}
