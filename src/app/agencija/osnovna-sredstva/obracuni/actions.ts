"use server";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import { fixedAssetContextMatches, parseFixedAssetDate, fixedAssetCentsToDecimal } from "@/lib/fixed-assets";
import { assetDate, assetDay, buildAssetBatch, type AssetBatchSnapshot, type AssetBatchScope } from "@/lib/fixed-assets-batches";
import { formatJournalCode } from "@/lib/journals";
const base = "/agencija/osnovna-sredstva/obracuni";
const value = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function batchContext(form: FormData, action: "create" | "update" | "post" | "delete") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId || !fixedAssetContextMatches(form, context)) redirect(`${base}?greska=${encodeURIComponent("Firma ili godina je promijenjena. Ponovo otvorite stranicu.")}`);
  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: action });
  return { user, scope: { agencija_id: user.agencija_id, firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId } };
}
async function lockedYear(tx: Prisma.TransactionClient, scope: AssetBatchScope) {
  await tx.$queryRaw(Prisma.sql`SELECT y.id FROM poslovne_godine y JOIN firme f ON f.id=y.firma_id WHERE y.id=${scope.poslovna_godina_id}::uuid AND y.firma_id=${scope.firma_id}::uuid AND f.agencija_id=${scope.agencija_id}::uuid FOR UPDATE OF y`);
  const year = await tx.poslovnaGodina.findFirst({ where: { id: scope.poslovna_godina_id, firma_id: scope.firma_id, firma: { agencija_id: scope.agencija_id, aktivan: true, is_deleted: false } } });
  if (!year || year.zakljucena) throw new Error("Godina nije dostupna ili je zaključana.");
  return year;
}
async function openPeriods(tx: Prisma.TransactionClient, scope: AssetBatchScope, from: Date, to: Date) {
  const periods = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM pdv_periodi WHERE firma_id=${scope.firma_id}::uuid AND datum_od<=${to} AND datum_do>=${from} ORDER BY datum_od FOR UPDATE`);
  if (periods.some(p => p.status === "LOCKED")) throw new Error("Izabrani period je zaključan.");
}
async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 }); }
    catch (e) {
      if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(e.code)) continue;
      throw e;
    }
  }
}
function failed(error: unknown, id = ""): never {
  const message = error instanceof Prisma.PrismaClientKnownRequestError ? "Podaci su u međuvremenu promijenjeni ili se period preklapa. Osvježite stranicu." : error instanceof Error ? error.message : "Obračun nije sačuvan.";
  redirect(`${base}${id ? `/${encodeURIComponent(id)}` : ""}?greska=${encodeURIComponent(message)}`);
}

async function resolveDepreciationAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  if (!accountCode) return null;
  const companyAccount = await tx.firmaKonto.findUnique({
    where: { firma_id_sifra: { firma_id: firmaId, sifra: accountCode } }
  });
  if (companyAccount) {
    return companyAccount.aktivan &&
      companyAccount.override_type !== accountOverrideTypes.deactivated &&
      companyAccount.tip_konta === "analiticko"
      ? companyAccount.id
      : null;
  }
  const baseAccount = await tx.konto.findUnique({ where: { sifra: accountCode } });
  if (!baseAccount?.aktivan || baseAccount.tip_konta !== "analiticko") return null;
  const linked = await tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv: baseAccount.naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    }
  });
  return linked.id;
}

export async function calculateDepreciation(form: FormData) {
  const id = value(form, "obracun_id");
  const { user, scope } = await batchContext(form, id ? "update" : "create");
  let resultId: string;
  try {
    resultId = await transaction(async tx => {
      const year = await lockedYear(tx, scope);
      const old = id ? await tx.osObracun.findFirst({ where: { id, ...scope } }) : null;
      if (id && !old) throw new Error("Obračun nije pronađen.");
      if (old?.status === "POSTED") throw new Error("Proknjižen obračun se ne može ponovo računati.");
      if (old && String(old.revizija) !== value(form, "revizija")) throw new Error("Obračun je izmijenjen. Osvježite stranicu.");
      const from = old?.period_od ?? parseFixedAssetDate(form.get("od")), to = old?.period_do ?? parseFixedAssetDate(form.get("do"));
      if (!from || !to || from > to || from < year.datum_od || to > year.datum_do) throw new Error("Unesite ispravan period unutar aktivne godine.");
      if (!old) {
        const existing = await tx.osObracun.findFirst({ where: { ...scope, period_od: from, period_do: to } });
        if (existing) return existing.id;
      }
      await openPeriods(tx, scope, from, to);
      const debitCode = value(form, "konto_troska_sifra");
      const creditCode = value(form, "konto_ispravke_sifra");
      const debitOverride = await resolveDepreciationAccount(tx, scope.firma_id, debitCode);
      const creditOverride = await resolveDepreciationAccount(tx, scope.firma_id, creditCode);
      if ((debitCode && !debitOverride) || (creditCode && !creditOverride)) {
        throw new Error("Izabrano konto ne postoji, deaktivirano je ili nije analitičko.");
      }
      const { snapshot, hash } = await buildAssetBatch(tx, scope, from, to, debitOverride, creditOverride);
      const data = { ulazni_hash: hash, snapshot: snapshot as unknown as Prisma.InputJsonValue, ukupna_amortizacija: fixedAssetCentsToDecimal(snapshot.totalCents), updated_by: user.id };
      const batch = old ? await tx.osObracun.update({ where: { id: old.id }, data: { ...data, revizija: { increment: 1 } } }) : await tx.osObracun.create({ data: { ...scope, ...data, period_od: from, period_do: to, created_by: user.id } });
      if (old) await tx.osObracunStavka.deleteMany({ where: { obracun_id: old.id, ...scope } });
      if (snapshot.lines.length) await tx.osObracunStavka.createMany({ data: snapshot.lines.map(line => ({ ...scope, obracun_id: batch.id, sredstvo_id: line.assetId, period_od: new Date(line.segmentStart), period_do: assetDay(new Date(line.segmentEnd), -1), iznos: fixedAssetCentsToDecimal(line.amountCents), snapshot: line as unknown as Prisma.InputJsonValue })) });
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id, modul: "osnovna_sredstva", akcija: old ? "recalculate" : "calculate", tipEntiteta: "OsObracun", entitetId: batch.id, staraVrijednost: old, novaVrijednost: batch });
      return batch.id;
    });
  } catch (e) { failed(e, id); }
  revalidatePath(base);
  redirect(`${base}/${resultId}`);
}

export async function postDepreciation(form: FormData) {
  const id = value(form, "obracun_id");
  const { user, scope } = await batchContext(form, "post");
  try {
    await transaction(async tx => {
      const year = await lockedYear(tx, scope);
      const batch = await tx.osObracun.findFirst({ where: { id, ...scope } });
      if (!batch) throw new Error("Obračun nije pronađen.");
      if (batch.status === "POSTED") return; // The persistent batch ID is the idempotency key.
      if (String(batch.revizija) !== value(form, "revizija")) throw new Error("Obračun je izmijenjen. Otvorite posljednju verziju.");
      await openPeriods(tx, scope, batch.period_od, batch.period_do);
      const saved = batch.snapshot as unknown as AssetBatchSnapshot;
      const { snapshot, hash } = await buildAssetBatch(tx, scope, batch.period_od, batch.period_do, saved.debitOverride, saved.creditOverride);
      if (hash !== batch.ulazni_hash) throw new Error("Podaci sredstva ili konta su izmijenjeni. Prvo ponovo obračunajte nacrt.");
      if (snapshot.postingErrors.length) throw new Error(snapshot.postingErrors.join(" "));
      for (const coverage of snapshot.coverage) {
        const prior = await tx.osObracunPokrice.findMany({ where: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, sredstvo_id: coverage.assetId, aktivno: true }, orderBy: { period_od: "asc" } });
        if (prior.some(p => assetDate(p.period_od) <= coverage.to && assetDate(p.period_do) >= coverage.from)) throw new Error("Dio izabranog perioda već je proknjižen. Izaberite naredni neobračunati period.");
        let next = coverage.firstDate;
        for (const p of prior) {
          if (assetDate(p.period_od) > next) break;
          if (assetDate(p.period_do) >= next) next = assetDate(assetDay(p.period_do, 1));
        }
        if (next !== coverage.from) throw new Error(`Nedostaje raniji obračun počev od ${next}. Prvo proknjižite raniji period.`);
      }
      let journalId: string | null = null;
      if (snapshot.totalCents > 0) {
        const type = await tx.vrstaNaloga.findFirst({ where: { sifra: "DEPRECIATION", OR: [{ agencija_id: scope.agencija_id }, { agencija_id: null }] }, orderBy: { agencija_id: "asc" } });
        if (!type) throw new Error("Nije podešena vrsta naloga Amortizacija.");
        await tx.$queryRaw(Prisma.sql`SELECT id FROM vrste_naloga WHERE id=${type.id}::uuid FOR UPDATE`);
        const last = await tx.nalog.findFirst({ where: { firma_id: scope.firma_id, poslovna_godina_id: scope.poslovna_godina_id, vrsta_naloga_id: type.id }, orderBy: { broj: "desc" }, select: { broj: true } });
        const groups = new Map<string, { konto_id: string; komitent_id: string | null; poslovna_jedinica_id: string | null; debit: boolean; cents: number }>();
        for (const line of snapshot.lines.filter(l => l.amountCents > 0)) {
          for (const debit of [true, false]) {
            const account = (debit ? line.debit : line.credit)!;
            const key = JSON.stringify([account, line.partner, line.unit, debit]);
            const group = groups.get(key) ?? { konto_id: account, komitent_id: line.partner, poslovna_jedinica_id: line.unit, debit, cents: 0 };
            group.cents += line.amountCents; groups.set(key, group);
          }
        }
        const number = (last?.broj ?? 0) + 1;
        const journal = await tx.nalog.create({ data: { ...scope, vrsta_naloga_id: type.id, broj: number, sifra: formatJournalCode(type.prefiks, year.godina, number), datum: batch.period_do, datum_knjizenja: batch.period_do, opis: `Amortizacija ${assetDate(batch.period_od)} – ${assetDate(batch.period_do)}`, status: "POSTED", source_type: "DEPRECIATION", source_module: "OSNOVNA_SREDSTVA", izvorni_dokument_id: batch.id, kreirao_korisnik_id: user.id, created_by: user.id, updated_by: user.id, proknjizen_by: user.id, proknjizen_at: new Date(), stavke: { create: [...groups.values()].map((g, i) => ({ konto_id: g.konto_id, komitent_id: g.komitent_id, poslovna_jedinica_id: g.poslovna_jedinica_id, duguje: g.debit ? fixedAssetCentsToDecimal(g.cents) : "0", potrazuje: g.debit ? "0" : fixedAssetCentsToDecimal(g.cents), redni_broj: i + 1, opis: "Amortizacija", created_by: user.id, updated_by: user.id })) } } });
        journalId = journal.id;
      }
      await tx.osObracunPokrice.createMany({ data: snapshot.coverage.map(c => ({ ...scope, obracun_id: id, sredstvo_id: c.assetId, period_od: new Date(c.from), period_do: new Date(c.to) })) });
      const posted = await tx.osObracun.update({ where: { id }, data: { status: "POSTED", nalog_id: journalId, bez_naloga_razlog: journalId ? null : "ZERO_AMOUNT", proknjizen_at: new Date(), proknjizen_by: user.id, updated_by: user.id } });
      await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: scope.agencija_id, firmaId: scope.firma_id, modul: "osnovna_sredstva", akcija: "post_depreciation", tipEntiteta: "OsObracun", entitetId: id, staraVrijednost: batch, novaVrijednost: posted });
    });
  } catch (e) { failed(e, id); }
  revalidatePath("/agencija", "layout");
  redirect(`${base}/${id}`);
}

export async function reopenDepreciation(form: FormData) {
  const id = value(form, "obracun_id");
  const reason = value(form, "razlog_vracanja");
  const { user, scope } = await batchContext(form, "post");
  if (value(form, "potvrda_vracanja") !== "DA" || reason.length < 3) {
    failed(new Error("Potvrdite vraćanje i unesite razlog od najmanje 3 znaka."), id);
  }
  try {
    await transaction(async tx => {
      await lockedYear(tx, scope);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM os_obracuni WHERE id=${id}::uuid FOR UPDATE`);
      const batch = await tx.osObracun.findFirst({
        where: { id, ...scope },
        include: {
          nalog: {
            include: {
              stavke: { orderBy: { redni_broj: "asc" } }
            }
          },
          pokrica: { where: { aktivno: true } },
          stavke: { select: { sredstvo_id: true } }
        }
      });
      if (!batch) throw new Error("Obračun nije pronađen.");
      if (String(batch.revizija) !== value(form, "revizija")) throw new Error("Obračun je izmijenjen. Osvježite stranicu prije vraćanja ili brisanja.");
      if (batch.status !== "POSTED") throw new Error("Samo proknjižen obračun može biti vraćen u nacrt.");
      if (batch.nalog && (batch.nalog.status !== "POSTED" || batch.nalog.source_type !== "DEPRECIATION" || batch.nalog.source_module !== "OSNOVNA_SREDSTVA" || batch.nalog.izvorni_dokument_id !== batch.id)) {
        throw new Error("Povezani nalog amortizacije nije ispravan.");
      }
      if (!batch.nalog && (Number(batch.ukupna_amortizacija) !== 0 || batch.bez_naloga_razlog !== "ZERO_AMOUNT")) {
        throw new Error("Proknjiženi obračun nema ispravan povezani nalog.");
      }
      await openPeriods(tx, scope, batch.period_od, batch.period_do);
      if (batch.pokrica.length === 0) throw new Error("Obračun nema aktivno pokriće za vraćanje u nacrt.");
      const laterCoverage = await tx.osObracunPokrice.findFirst({
        where: {
          agencija_id: scope.agencija_id,
          firma_id: scope.firma_id,
          aktivno: true,
          obracun_id: { not: batch.id },
          OR: batch.pokrica.map(coverage => ({
            sredstvo_id: coverage.sredstvo_id,
            period_do: { gt: coverage.period_do }
          }))
        },
        select: { id: true }
      });
      if (laterCoverage) throw new Error("Postoji kasniji proknjiženi obračun. Prvo vratite posljednji obračun u nacrt.");
      const assetIds = [...new Set([
        ...batch.stavke.map(line => line.sredstvo_id),
        ...batch.pokrica.map(coverage => coverage.sredstvo_id)
      ])];
      const laterSale = await tx.osPromjena.findFirst({
        where: {
          agencija_id: scope.agencija_id,
          firma_id: scope.firma_id,
          sredstvo_id: { in: assetIds },
          vrsta: "SALE",
          status: "CONFIRMED",
          is_deleted: false,
          datum: { gt: batch.period_do }
        },
        select: { id: true }
      });
      if (laterSale) throw new Error("Sredstvo iz obračuna ima potvrđenu kasniju prodaju. Prvo poništite prodaju.");

      const draft = await tx.osObracun.update({
        where: { id: batch.id },
        data: {
          status: "DRAFT",
          revizija: { increment: 1 },
          nalog_id: null,
          bez_naloga_razlog: null,
          proknjizen_at: null,
          proknjizen_by: null,
          updated_by: user.id
        }
      });
      await tx.osObracunPokrice.deleteMany({ where: { obracun_id: batch.id, ...scope } });
      if (batch.nalog) {
        await tx.stavkaNaloga.deleteMany({ where: { nalog_id: batch.nalog.id } });
        await tx.nalog.delete({ where: { id: batch.nalog.id } });
      }
      await auditLogInTransaction(tx, {
        korisnikId: user.id,
        agencijaId: scope.agencija_id,
        firmaId: scope.firma_id,
        modul: "osnovna_sredstva",
        akcija: "reopen_depreciation",
        tipEntiteta: "OsObracun",
        entitetId: batch.id,
        staraVrijednost: {
          status: batch.status,
          nalog: batch.nalog,
          pokrica: batch.pokrica
        },
        novaVrijednost: { status: draft.status, revizija: draft.revizija, razlog: reason }
      });
    });
  } catch (error) { failed(error, id); }
  revalidatePath("/agencija", "layout");
  redirect(`${base}/${id}`);
}

export async function deleteDepreciationDraft(form: FormData) {
  const id = value(form, "obracun_id");
  const reason = value(form, "razlog_brisanja");
  const { user, scope } = await batchContext(form, "delete");
  if (value(form, "potvrda_brisanja") !== "DA" || reason.length < 3) {
    failed(new Error("Potvrdite brisanje i unesite razlog od najmanje 3 znaka."), id);
  }
  try {
    await transaction(async tx => {
      await lockedYear(tx, scope);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM os_obracuni WHERE id=${id}::uuid FOR UPDATE`);
      const batch = await tx.osObracun.findFirst({
        where: { id, ...scope },
        include: { stavke: true, pokrica: true }
      });
      if (!batch) throw new Error("Obračun nije pronađen.");
      if (String(batch.revizija) !== value(form, "revizija")) throw new Error("Obračun je izmijenjen. Osvježite stranicu prije vraćanja ili brisanja.");
      if (batch.status !== "DRAFT" || batch.nalog_id || batch.pokrica.length > 0) {
        throw new Error("Samo nacrt bez povezanog naloga i pokrića može biti izbrisan.");
      }
      await openPeriods(tx, scope, batch.period_od, batch.period_do);
      await auditLogInTransaction(tx, {
        korisnikId: user.id,
        agencijaId: scope.agencija_id,
        firmaId: scope.firma_id,
        modul: "osnovna_sredstva",
        akcija: "delete_depreciation_draft",
        tipEntiteta: "OsObracun",
        entitetId: batch.id,
        staraVrijednost: { ...batch, razlog: reason }
      });
      await tx.osObracunStavka.deleteMany({ where: { obracun_id: batch.id, ...scope } });
      await tx.osObracun.delete({ where: { id: batch.id } });
    });
  } catch (error) { failed(error, id); }
  revalidatePath("/agencija", "layout");
  redirect(base);
}
