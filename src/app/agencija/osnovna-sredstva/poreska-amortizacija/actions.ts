"use server";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { fixedAssetContextMatches, fixedAssetCentsToDecimal } from "@/lib/fixed-assets";
import { type AssetBatchScope } from "@/lib/fixed-assets-batches";
import { parseTaxInput, type TaxInput } from "@/lib/fixed-assets-tax";
import { automaticTaxEvents, mergeTaxEvents } from "@/lib/fixed-assets-tax-events";
import { buildTaxSnapshot, initialTaxInput, taxAssets, validateTaxAssets, type TaxSnapshot } from "@/lib/fixed-assets-tax-data";
const base = "/agencija/osnovna-sredstva/poreska-amortizacija";
const value = (f: FormData,k: string) => String(f.get(k) ?? "");
async function context(form: FormData, action: "create" | "update" | "post" | "delete") {
  const user = await requireAnyRole(["admin_agencije","korisnik_agencije"]), ctx = await readWorkContext();
  if (!user.agencija_id || !ctx.firmaId || !ctx.poslovnaGodinaId || !fixedAssetContextMatches(form,ctx)) redirect(`${base}?greska=${encodeURIComponent("Firma ili godina je promijenjena. Osvježite stranicu.")}`);
  await requirePermissionForUser(user,{ firmaId: ctx.firmaId, modul: "osnovna_sredstva", akcija: action });
  return { user, scope: { agencija_id: user.agencija_id, firma_id: ctx.firmaId, poslovna_godina_id: ctx.poslovnaGodinaId } };
}
async function lock(tx: Prisma.TransactionClient, scope: AssetBatchScope) {
  // One company lock serializes tax revisions and cross-year carry-forward.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM firme WHERE id=${scope.firma_id}::uuid AND agencija_id=${scope.agencija_id}::uuid FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM poslovne_godine WHERE id=${scope.poslovna_godina_id}::uuid AND firma_id=${scope.firma_id}::uuid FOR UPDATE`);
  const year = await tx.poslovnaGodina.findFirst({ where: { id: scope.poslovna_godina_id, firma_id: scope.firma_id, firma: { agencija_id: scope.agencija_id, aktivan: true, is_deleted: false } } });
  if (!year || year.zakljucena) throw new Error("Poslovna godina nije dostupna ili je zaključana.");
  const periods = await tx.$queryRaw<{status:string}[]>(Prisma.sql`SELECT status FROM pdv_periodi WHERE firma_id=${scope.firma_id}::uuid AND datum_od<=${year.datum_do} AND datum_do>=${year.datum_od} ORDER BY datum_od FOR UPDATE`);
  if (periods.some(p=>p.status === "LOCKED")) throw new Error("Poreska godina obuhvata zaključan PDV period.");
  return year;
}
async function mutable(tx: Prisma.TransactionClient, scope: AssetBatchScope) {
  const year = await tx.poslovnaGodina.findUniqueOrThrow({ where: { id: scope.poslovna_godina_id } });
  if (await tx.osPoreskiObracun.findFirst({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, status: "CONFIRMED", poslovna_godina: { datum_od: { gt: year.datum_do } } } })) throw new Error("Postoji potvrđen poreski obračun kasnije godine. Ranija poreska stanja se ne mogu mijenjati.");
  if (await tx.osPoreskiObracun.findFirst({ where: { ...scope, status: "CONFIRMED" } })) throw new Error("Poreski obračun je potvrđen; izmjena njegovih ulaza nije dozvoljena.");
}
async function prior(tx: Prisma.TransactionClient, scope: AssetBatchScope, from: Date) {
  const previous = await tx.osPoreskaGodina.findFirst({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, poslovna_godina: { datum_do: new Date(from.getTime()-86400000) } } });
  if (!previous) return null;
  const confirmed = await tx.osPoreskiObracun.findFirst({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, poreska_godina_id: previous.id, status: "CONFIRMED" } });
  if (!confirmed) throw new Error("Prvo potvrdite poreski obračun prethodne godine.");
  return { id: confirmed.id, snapshot: confirmed.snapshot as unknown as TaxSnapshot };
}
function checkCarry(input: TaxInput, assets: Awaited<ReturnType<typeof taxAssets>>, previous: Awaited<ReturnType<typeof prior>>) {
  if (!previous) return;
  const expected = initialTaxInput(assets,previous);
  if (input.pools.some(p=>p.opening !== expected.pools.find(e=>e.group===p.group)!.opening)) throw new Error("Početni saldo mora odgovarati potvrđenom obračunu prethodne godine.");
  for (const a of expected.assets) {
    const old = previous.snapshot.input.assets.find(p=>p.id===a.id), row = input.assets.find(r=>r.id===a.id);
    if (old && row && (row.classification !== old.classification || ["I","ACCOUNTING_AMOUNT"].includes(a.classification) && (row.basis !== a.basis || row.previous !== a.previous))) throw new Error("Prenesena klasifikacija i početno stanje se ne mogu mijenjati bez korekcije prethodne godine.");
  }
}
async function run(form: FormData, mode: "save" | "calculate" | "confirm" | "carry") {
  const { user, scope } = await context(form,mode === "confirm" ? "post" : mode === "calculate" ? "create" : "update");
  let id = "";
  try {
    await prisma.$transaction(async tx => {
      const year = await lock(tx,scope);
      const old = await tx.osPoreskaGodina.findFirst({ where: scope });
      if (mode === "confirm") {
        const batch = await tx.osPoreskiObracun.findFirst({ where: { id: value(form,"obracun_id"), ...scope } });
        if (!batch || !old) throw new Error("Obračun nije pronađen.");
        id = batch.id;
        if (batch.status === "CONFIRMED") return;
        await mutable(tx,scope);
        const saved = old.ulazi as unknown as TaxInput;
        const previous = await prior(tx,scope,year.datum_od);
        checkCarry(saved,await taxAssets(tx,scope,year.datum_od,year.datum_do),previous);
        const { snapshot,hash } = await buildTaxSnapshot(tx,scope,saved,old.prethodni_obracun_id);
        if (hash !== batch.ulazni_hash || (previous?.id ?? null) !== old.prethodni_obracun_id) throw new Error("Podaci su izmijenjeni. Sačuvajte ulaze i ponovo obračunajte.");
        if (snapshot.result.errors.length) throw new Error(snapshot.result.errors.join(" "));
        await tx.osPoreskiObracun.update({ where: { id }, data: { status: "CONFIRMED", potvrdjen_at: new Date(), potvrdjen_by: user.id } });
        await auditLogInTransaction(tx,{ korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id, modul: "osnovna_sredstva", akcija: "confirm_tax_depreciation", tipEntiteta: "OsPoreskiObracun", entitetId: id, staraVrijednost: batch, novaVrijednost: { status: "CONFIRMED" } });
        return;
      }
      await mutable(tx,scope);
      if (String(old?.verzija ?? 0) !== value(form,"verzija")) throw new Error("Podaci su izmijenjeni u drugom prozoru. Osvježite stranicu.");
      const assets = await taxAssets(tx,scope,year.datum_od,year.datum_do), previous = await prior(tx,scope,year.datum_od);
      if (mode === "carry" && !previous) throw new Error("Nema potvrđenog poreskog obračuna prethodne godine.");
      if (mode === "carry" && old) throw new Error("Poreski podaci već postoje. Prenos neće prepisati unesene podatke.");
      let input = mode === "carry" ? initialTaxInput(assets,previous!) : mode === "save" ? parseTaxInput(value(form,"ulazi")) : old?.ulazi as unknown as TaxInput;
      if (!input) throw new Error("Prvo sačuvajte početna poreska stanja i promjene.");
      const defaults=initialTaxInput(assets);
      input={...input,assets:[...input.assets,...defaults.assets.filter(a=>!input.assets.some(old=>old.id===a.id))]};
      validateTaxAssets(input,assets); checkCarry(input,assets,previous);
      if (mode === "save" || mode === "carry") {
        const automatic=await automaticTaxEvents(tx,scope,input,year.datum_od,year.datum_do);
        input=mergeTaxEvents(input,automatic.events);
      }
      if (mode === "save" || mode === "carry") {
        const data = { ulazi: input as unknown as Prisma.InputJsonValue, prethodni_obracun_id: previous?.id ?? null, updated_by: user.id };
        const saved = old ? await tx.osPoreskaGodina.update({ where: { id: old.id }, data: { ...data, verzija: { increment: 1 } } }) : await tx.osPoreskaGodina.create({ data: { ...scope, ...data, created_by: user.id } });
        await auditLogInTransaction(tx,{ korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id, modul: "osnovna_sredstva", akcija: mode === "carry" ? "carry_tax_opening" : "save_tax_inputs", tipEntiteta: "OsPoreskaGodina", entitetId: saved.id, staraVrijednost: old, novaVrijednost: saved });
      } else {
        const { snapshot,hash } = await buildTaxSnapshot(tx,scope,input,old!.prethodni_obracun_id);
        const existing = await tx.osPoreskiObracun.findFirst({ where: { ...scope, ulazni_hash: hash }, orderBy: { revizija: "desc" } });
        if (existing) { id = existing.id; return; }
        const last = await tx.osPoreskiObracun.findFirst({ where: scope, orderBy: { revizija: "desc" } });
        const batch = await tx.osPoreskiObracun.create({ data: { ...scope, poreska_godina_id: old!.id, revizija: (last?.revizija ?? 0)+1, ulazni_hash: hash, snapshot: snapshot as unknown as Prisma.InputJsonValue, ukupna_amortizacija: fixedAssetCentsToDecimal(snapshot.result.total), created_by: user.id } });
        id = batch.id;
        await auditLogInTransaction(tx,{ korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id, modul: "osnovna_sredstva", akcija: "calculate_tax_depreciation", tipEntiteta: "OsPoreskiObracun", entitetId: id, novaVrijednost: batch });
      }
    },{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch(e) {
    const message = e instanceof Prisma.PrismaClientKnownRequestError ? "Podaci su izmijenjeni ili nijesu dostupni. Osvježite stranicu i pokušajte ponovo." : e instanceof Error ? e.message : "Poreski podaci nijesu sačuvani.";
    redirect(`${base}?greska=${encodeURIComponent(message)}`);
  }
  revalidatePath(base,"layout");
  redirect(id ? `${base}/${id}` : `${base}?sacuvano=1`);
}
export async function saveTaxInputs(form: FormData) { await run(form,"save"); }
export async function calculateTaxDepreciation(form: FormData) { await run(form,"calculate"); }
export async function confirmTaxDepreciation(form: FormData) { await run(form,"confirm"); }
export async function carryTaxOpening(form: FormData) { await run(form,"carry"); }

function correctionFailed(error: unknown, id: string): never {
  const message = error instanceof Prisma.PrismaClientKnownRequestError
    ? "Podaci su izmijenjeni ili nijesu dostupni. Osvježite stranicu i pokušajte ponovo."
    : error instanceof Error ? error.message : "Poreski obračun nije izmijenjen.";
  redirect(`${base}/${encodeURIComponent(id)}?greska=${encodeURIComponent(message)}`);
}

export async function reopenTaxDepreciation(form: FormData) {
  const id = value(form,"obracun_id").trim(), reason = value(form,"razlog_vracanja").trim();
  const { user, scope } = await context(form,"post");
  if (value(form,"potvrda_vracanja") !== "DA" || reason.length < 3) {
    correctionFailed(new Error("Potvrdite vraćanje i unesite razlog od najmanje 3 znaka."),id);
  }
  try {
    await prisma.$transaction(async tx => {
      const year = await lock(tx,scope);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM os_poreski_obracuni WHERE id=${id}::uuid FOR UPDATE`);
      const batch = await tx.osPoreskiObracun.findFirst({ where: { id, ...scope } });
      if (!batch) throw new Error("Poreski obračun nije pronađen.");
      if (batch.status !== "CONFIRMED") throw new Error("Samo potvrđen poreski obračun može biti vraćen u nacrt.");
      const [laterConfirmed, transfer] = await Promise.all([
        tx.osPoreskiObracun.findFirst({
          where: {
            agencija_id: scope.agencija_id,
            firma_id: scope.firma_id,
            status: "CONFIRMED",
            poslovna_godina: { datum_od: { gt: year.datum_do } }
          },
          select: { id: true }
        }),
        tx.osPoreskaGodina.findFirst({ where: { prethodni_obracun_id: batch.id }, select: { id: true } })
      ]);
      if (laterConfirmed) throw new Error("Postoji potvrđen poreski obračun kasnije godine. Prvo korigujte kasniju godinu.");
      if (transfer) throw new Error("Poreski obračun je već prenesen u narednu godinu. Prvo uklonite podatke naredne godine.");
      const draft = await tx.osPoreskiObracun.update({
        where: { id: batch.id },
        data: { status: "DRAFT", potvrdjen_at: null, potvrdjen_by: null }
      });
      await auditLogInTransaction(tx,{
        korisnikId:user.id,agencijaId:scope.agencija_id,firmaId:scope.firma_id,
        modul:"osnovna_sredstva",akcija:"reopen_tax_depreciation",
        tipEntiteta:"OsPoreskiObracun",entitetId:batch.id,
        staraVrijednost:batch,novaVrijednost:{status:draft.status,razlog:reason}
      });
    },{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch(error) { correctionFailed(error,id); }
  revalidatePath(base,"layout");
  redirect(`${base}/${id}`);
}

export async function deleteTaxDepreciationDraft(form: FormData) {
  const id = value(form,"obracun_id").trim(), reason = value(form,"razlog_brisanja").trim();
  const { user, scope } = await context(form,"delete");
  if (value(form,"potvrda_brisanja") !== "DA" || reason.length < 3) {
    correctionFailed(new Error("Potvrdite brisanje i unesite razlog od najmanje 3 znaka."),id);
  }
  try {
    await prisma.$transaction(async tx => {
      await lock(tx,scope);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM os_poreski_obracuni WHERE id=${id}::uuid FOR UPDATE`);
      const batch = await tx.osPoreskiObracun.findFirst({ where: { id, ...scope } });
      if (!batch) throw new Error("Poreski obračun nije pronađen.");
      if (batch.status !== "DRAFT") throw new Error("Samo nacrt poreskog obračuna može biti izbrisan.");
      if (await tx.osPoreskaGodina.findFirst({ where: { prethodni_obracun_id: batch.id }, select: { id: true } })) {
        throw new Error("Poreski obračun je prenesen u narednu godinu i ne može biti izbrisan.");
      }
      await auditLogInTransaction(tx,{
        korisnikId:user.id,agencijaId:scope.agencija_id,firmaId:scope.firma_id,
        modul:"osnovna_sredstva",akcija:"delete_tax_depreciation_draft",
        tipEntiteta:"OsPoreskiObracun",entitetId:batch.id,
        staraVrijednost:{...batch,razlog:reason}
      });
      await tx.osPoreskiObracun.delete({ where: { id: batch.id } });
    },{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch(error) { correctionFailed(error,id); }
  revalidatePath(base,"layout");
  redirect(base);
}


export async function undoTaxCarry(form: FormData) {
  const { user, scope } = await context(form, "delete");
  const reason = value(form, "razlog").trim();
  try {
    if (value(form, "potvrda") !== "DA" || reason.length < 3) throw new Error("Potvrdite poništavanje prenosa i unesite razlog od najmanje 3 znaka.");
    await prisma.$transaction(async tx => {
      await lock(tx, scope);
      await mutable(tx, scope);
      const stored = await tx.osPoreskaGodina.findFirst({ where: scope });
      if (!stored?.prethodni_obracun_id) throw new Error("Nema poreskog prenosa za poništavanje.");
      if (stored.id !== value(form, "poreska_godina_id") || String(stored.verzija) !== value(form, "verzija")) throw new Error("Poreski podaci su izmijenjeni. Osvježite stranicu.");
      if (await tx.osPoreskiObracun.findFirst({ where: { poreska_godina_id: stored.id }, select: { id: true } })) throw new Error("Prvo vratite obračun ove godine u nacrt i izbrišite sve njegove revizije.");
      await auditLogInTransaction(tx, {
        korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id,
        modul: "osnovna_sredstva", akcija: "undo_tax_carry", tipEntiteta: "OsPoreskaGodina",
        entitetId: stored.id, staraVrijednost: stored, novaVrijednost: { razlog: reason, ponisten_prenos: true }
      });
      await tx.osPoreskaGodina.delete({ where: { id: stored.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  } catch (error) {
    const message = error instanceof Prisma.PrismaClientKnownRequestError ? "Podaci su izmijenjeni. Osvježite stranicu." : error instanceof Error ? error.message : "Prenos nije poništen.";
    redirect(`${base}?greska=${encodeURIComponent(message)}`);
  }
  revalidatePath(base, "layout");
  redirect(base);
}
