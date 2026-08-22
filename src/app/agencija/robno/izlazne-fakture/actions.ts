"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { inventoryModule } from "@/lib/inventory";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";
import {
  formatJournalCode,
  journalStatuses,
  standardJournalTypes
} from "@/lib/journals";
import {
  outgoingInvoiceFiscalModes,
  outgoingInvoicePostingFields,
  outgoingInvoicePostingScope,
  outgoingInvoiceStatuses
} from "@/lib/outgoing-invoice";
import {
  createOutgoingInvoiceDraft,
  fiscalizeOutgoingInvoiceDocument,
  OutgoingInvoiceServiceError,
  saveOutgoingInvoiceDraft as saveOutgoingInvoiceDraftService,
  updateOutgoingInvoiceDraftHeader
} from "@/lib/outgoing-invoice-service";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext } from "../_shared";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function detail(id: string, message: string): never {
  redirect(`/agencija/robno/izlazne-fakture/${id}?poruka=${message}`);
}

async function context(action: "create" | "update", firmaId: string) {
  const [ctx, work] = await Promise.all([
    getInventoryContext(action),
    readWorkContext()
  ]);
  if (
    !ctx.allowed ||
    !ctx.firma ||
    !ctx.user.agencija_id ||
    ctx.firma.id !== firmaId ||
    !work.poslovnaGodinaId
  ) {
    redirect("/agencija/robno/izlazne-fakture?poruka=prava");
  }
  const year = await prisma.poslovnaGodina.findFirst({
    where: { id: work.poslovnaGodinaId, firma_id: firmaId },
    select: { id: true, godina: true, zakljucena: true }
  });
  if (!year || year.zakljucena) {
    redirect("/agencija/robno/izlazne-fakture?poruka=zakljucana");
  }
  return { ...ctx, firma: ctx.firma, year };
}

function serviceContext(ctx: Awaited<ReturnType<typeof context>>) {
  return {
    agencijaId: ctx.user.agencija_id!,
    firmaId: ctx.firma.id,
    poslovnaGodinaId: ctx.year.id,
    userId: ctx.user.id,
    userName: ctx.user.korisnicko_ime
  };
}

function serviceErrorCode(error: unknown) {
  return error instanceof OutgoingInvoiceServiceError
    ? error.redirectCode
    : null;
}

export async function createOutgoingInvoice(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("create", firmaId);
  try {
    const result = await createOutgoingInvoiceDraft({
      context: serviceContext(ctx),
      formData,
      options: { accountingMode: "CONFIGURED", partnerAccess: "AGENCY" }
    });
    redirect(
      `/agencija/robno/izlazne-fakture/${result.invoiceId}?poruka=kreirana`
    );
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) {
      redirect(`/agencija/robno/nova-izlazna-faktura?poruka=${code}`);
    }
    throw error;
  }
}

export async function saveOutgoingInvoiceDraft(formData: FormData) {
  const id = text(formData.get("faktura_id"));
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("update", firmaId);
  try {
    await saveOutgoingInvoiceDraftService({
      context: serviceContext(ctx),
      formData,
      options: { accountingMode: "CONFIGURED", partnerAccess: "AGENCY" }
    });
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(id, code);
    throw error;
  }
  revalidatePath(`/agencija/robno/izlazne-fakture/${id}`);
  detail(id, "sacuvana");
}

export async function updateOutgoingInvoiceHeader(formData: FormData) {
  const id = text(formData.get("faktura_id"));
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("update", firmaId);
  try {
    await updateOutgoingInvoiceDraftHeader({
      context: serviceContext(ctx),
      formData,
      options: { accountingMode: "CONFIGURED", partnerAccess: "AGENCY" }
    });
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(id, code);
    throw error;
  }
  revalidatePath(`/agencija/robno/izlazne-fakture/${id}`);
  detail(id, "zaglavlje");
}

export async function fiscalizeOutgoingInvoice(formData: FormData) {
  const id = text(formData.get("faktura_id"));
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("update", firmaId);
  try {
    const result = await fiscalizeOutgoingInvoiceDocument({
      context: serviceContext(ctx),
      formData,
      options: { accountingMode: "CONFIGURED", partnerAccess: "AGENCY" }
    });
    if (result.status === "pending") detail(id, "fiskalizacija_u_toku");
    if (result.status === "failed") detail(id, "fiskalizacija_greska");
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(id, code);
    throw error;
  }
  return finalizeOutgoingInvoice(formData);
}

async function resolveAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  code: string
) {
  const existing = await tx.firmaKonto.findUnique({
    where: { firma_id_sifra: { firma_id: firmaId, sifra: code } }
  });
  if (existing) {
    return existing.aktivan &&
      existing.override_type !== accountOverrideTypes.deactivated &&
      existing.tip_konta === "analiticko"
      ? existing
      : null;
  }
  const base = await tx.konto.findFirst({
    where: { sifra: code, aktivan: true, tip_konta: "analiticko" }
  });
  if (!base) return null;
  return tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: base.id,
      sifra: base.sifra,
      naziv: base.naziv,
      tip_konta: base.tip_konta,
      analitika_obavezna: base.analitika_obavezna,
      sinteticki_konto: base.sinteticki_konto,
      normalni_saldo: base.normalni_saldo,
      koristi_radnu_jedinicu: base.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    }
  });
}

export async function finalizeOutgoingInvoice(formData: FormData) {
  const id = text(formData.get("faktura_id"));
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("update", firmaId);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${id}`}))`
    );
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        id,
        agencija_id: ctx.user.agencija_id!,
        firma_id: firmaId,
        poslovna_godina_id: ctx.year.id,
        document_type: "INVOICE",
        sales_channel: "OFFICE",
        status: outgoingInvoiceStatuses.draft,
        is_deleted: false
      },
      include: { stavke: true, magacin: true }
    });
    if (!invoice) return { ok: false as const, reason: "nije_nacrt" };
    if (
      invoice.fiskalizacija_rezim === outgoingInvoiceFiscalModes.summa &&
      invoice.fiscal_status !== "Fiscalized"
    ) {
      return { ok: false as const, reason: "fiskalizacija_obavezna" };
    }
    if (!invoice.stavke.length) {
      return { ok: false as const, reason: "stavke" };
    }
    const goods = invoice.stavke.filter((line) => !line.usluga);
    if (goods.length && !invoice.magacin_id) {
      return { ok: false as const, reason: "magacin_obavezan" };
    }
    const period = await tx.pdvPeriod.findFirst({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: ctx.year.id,
        mjesec: invoice.datum_racuna.getUTCMonth() + 1
      },
      select: { status: true }
    });
    if (period?.status === "LOCKED") {
      return { ok: false as const, reason: "pdv_period" };
    }

    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({
        where: {
          firma_id: firmaId,
          dokument_tip: outgoingInvoicePostingScope.documentType,
          podvrsta: outgoingInvoicePostingScope.subtype,
          pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate
        }
      }),
      tx.vrstaNaloga.findFirst({
        where: {
          sifra: standardJournalTypes[2][0],
          aktivan: true,
          OR: [
            { sistemska: true },
            { agencija_id: ctx.user.agencija_id },
            { firma_id: firmaId }
          ]
        },
        select: { id: true, prefiks: true }
      })
    ]);
    if (!journalType) {
      return { ok: false as const, reason: "vrsta_naloga" };
    }

    let cogs = BigInt(0);
    for (const line of goods) {
      await tx.$queryRaw`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id"=${firmaId}::uuid AND "poslovna_godina_id"=${ctx.year.id}::uuid AND "magacin_id"=${invoice.magacin_id}::uuid AND "artikal_id"=${line.artikal_id}::uuid FOR UPDATE`;
      const state = await tx.stanjeZaliha.findUnique({
        where: {
          firma_id_poslovna_godina_id_magacin_id_artikal_id: {
            firma_id: firmaId,
            poslovna_godina_id: ctx.year.id,
            magacin_id: invoice.magacin_id!,
            artikal_id: line.artikal_id
          }
        }
      });
      const quantity = decimalToScaled(line.kolicina, 3);
      const available = decimalToScaled(state?.kolicina ?? 0, 3);
      const allowNegative =
        invoice.magacin?.dozvoli_negativan_lager ??
        ctx.firma.dozvoli_negativan_lager;
      if (!allowNegative && available < quantity) {
        return {
          ok: false as const,
          reason: `lager:${line.naziv_artikla}:${Number(available) / 1000}`
        };
      }
      const unitCost = decimalToScaled(
        state?.prosjecna_nabavna_cijena ?? 0,
        4
      );
      if (unitCost <= BigInt(0)) {
        return {
          ok: false as const,
          reason: `nabavna:${line.naziv_artikla}`
        };
      }
      const lineCost =
        (quantity * unitCost + BigInt(50000)) / BigInt(100000);
      cogs += lineCost;
      const newQuantity = available - quantity;
      const oldValue = decimalToScaled(state?.nabavna_vrijednost ?? 0, 2);
      const newValue = oldValue - lineCost;
      const lineBase = decimalToScaled(line.osnovica, 2);
      const priceDifference = lineBase > lineCost ? lineBase - lineCost : BigInt(0);

      if (state) {
        await tx.stanjeZaliha.update({
          where: { id: state.id },
          data: {
            kolicina: scaledToDecimal(newQuantity, 3),
            nabavna_vrijednost: scaledToDecimal(newValue, 2),
            maloprodajna_vrijednost: { decrement: line.ukupno_sa_pdv },
            razlika_u_cijeni: {
              decrement: scaledToDecimal(priceDifference, 2)
            },
            ukalkulisani_pdv: { decrement: line.pdv_iznos }
          }
        });
      } else {
        await tx.stanjeZaliha.create({
          data: {
            agencija_id: ctx.user.agencija_id!,
            firma_id: firmaId,
            poslovna_godina_id: ctx.year.id,
            magacin_id: invoice.magacin_id!,
            artikal_id: line.artikal_id,
            kolicina: scaledToDecimal(newQuantity, 3),
            prosjecna_nabavna_cijena: scaledToDecimal(unitCost, 4),
            nabavna_vrijednost: scaledToDecimal(newValue, 2)
          }
        });
      }
      await tx.stavkaIzlazneFakture.update({
        where: { id: line.id },
        data: {
          jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
          nabavna_vrijednost: scaledToDecimal(lineCost, 2),
          updated_by: ctx.user.id
        }
      });
      await tx.prometZaliha.create({
        data: {
          agencija_id: ctx.user.agencija_id!,
          firma_id: firmaId,
          poslovna_godina_id: ctx.year.id,
          magacin_id: invoice.magacin_id!,
          artikal_id: line.artikal_id,
          tip_dokumenta: "OUTGOING_INVOICE",
          dokument_id: invoice.id,
          stavka_dokumenta_id: line.id,
          datum_prometa: invoice.datum_prometa,
          smjer: "OUT",
          kolicina: line.kolicina,
          jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
          nabavna_vrijednost: scaledToDecimal(lineCost, 2),
          prodajna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv,
          prodajna_vrijednost: line.ukupno_sa_pdv,
          prosjecna_cijena_nakon: scaledToDecimal(unitCost, 4),
          kolicina_nakon: scaledToDecimal(newQuantity, 3),
          created_by: ctx.user.id
        }
      });
    }

    const amounts = new Map<string, bigint>([
      ["INVOICE_CUSTOMER", decimalToScaled(invoice.ukupno_sa_pdv, 2)],
      ["INVOICE_REVENUE", decimalToScaled(invoice.ukupno_osnovica, 2)],
      ["INVOICE_OUTPUT_VAT", decimalToScaled(invoice.ukupno_izlazni_pdv, 2)],
      ["INVOICE_COGS", cogs],
      ["INVOICE_INVENTORY", cogs]
    ]);
    const settingMap = new Map(
      settings.map((setting) => [setting.namjena, setting])
    );
    const postingLines: Array<{
      amount: bigint;
      direction: "D" | "P";
      code: string;
    }> = [];
    for (const field of outgoingInvoicePostingFields) {
      const amount = amounts.get(field.purpose) ?? BigInt(0);
      if (!amount) continue;
      const setting = settingMap.get(field.purpose);
      if (!setting?.sifra_konta) {
        return { ok: false as const, reason: "podesavanja" };
      }
      postingLines.push({
        amount,
        direction: setting.smjer === "P" ? "P" : "D",
        code: setting.sifra_konta
      });
    }
    const debit = postingLines
      .filter((line) => line.direction === "D")
      .reduce((sum, line) => sum + line.amount, BigInt(0));
    const credit = postingLines
      .filter((line) => line.direction === "P")
      .reduce((sum, line) => sum + line.amount, BigInt(0));
    if (debit !== credit) return { ok: false as const, reason: "balans" };

    const lastJournal = await tx.nalog.findFirst({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: ctx.year.id,
        vrsta_naloga_id: journalType.id
      },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const number = (lastJournal?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({
      data: {
        agencija_id: ctx.user.agencija_id!,
        firma_id: firmaId,
        poslovna_godina_id: ctx.year.id,
        vrsta_naloga_id: journalType.id,
        broj: number,
        sifra: formatJournalCode(journalType.prefiks, ctx.year.godina, number),
        datum: invoice.datum_racuna,
        opis: `Izlazna faktura ${invoice.interni_broj}`,
        status: journalStatuses.draft,
        source_type: "OUTGOING_INVOICE",
        source_module: "agencija.robno.izlazne-fakture",
        izvorni_dokument_id: invoice.id,
        kreirao_korisnik_id: ctx.user.id,
        created_by: ctx.user.id,
        updated_by: ctx.user.id
      }
    });
    let order = 1;
    for (const line of postingLines) {
      const account = await resolveAccount(tx, firmaId, line.code);
      if (!account) return { ok: false as const, reason: "konto" };
      await tx.stavkaNaloga.create({
        data: {
          nalog_id: journal.id,
          konto_id: account.id,
          komitent_id: account.analitika_obavezna ? invoice.kupac_id : null,
          duguje:
            line.direction === "D" ? scaledToDecimal(line.amount, 2) : "0.00",
          potrazuje:
            line.direction === "P" ? scaledToDecimal(line.amount, 2) : "0.00",
          opis: `Faktura ${invoice.interni_broj}`,
          broj_dokumenta: invoice.broj_racuna,
          datum_dokumenta: invoice.datum_racuna,
          datum_valute: invoice.datum_valute,
          redni_broj: order++,
          created_by: ctx.user.id,
          updated_by: ctx.user.id
        }
      });
    }

    const taxGroups = new Map<
      string,
      {
        code: string;
        name: string;
        percent: Prisma.Decimal;
        base: bigint;
        vat: bigint;
        total: bigint;
      }
    >();
    for (const line of invoice.stavke) {
      const group = taxGroups.get(line.pdv_stopa_sifra) ?? {
        code: line.pdv_stopa_sifra,
        name: line.pdv_stopa_naziv,
        percent: line.pdv_stopa_procenat,
        base: BigInt(0),
        vat: BigInt(0),
        total: BigInt(0)
      };
      group.base += decimalToScaled(line.osnovica, 2);
      group.vat += decimalToScaled(line.pdv_iznos, 2);
      group.total += decimalToScaled(line.ukupno_sa_pdv, 2);
      taxGroups.set(line.pdv_stopa_sifra, group);
    }
    await tx.fiskalniIzlazniRacunPorez.deleteMany({
      where: { fiskalni_izlazni_racun_id: invoice.id }
    });
    await tx.fiskalniIzlazniRacunPorez.createMany({
      data: [...taxGroups.values()].map((group) => ({
        fiskalni_izlazni_racun_id: invoice.id,
        vat_rate_code: group.code,
        vat_rate_name: group.name,
        vat_rate_percent: group.percent,
        tax_base: scaledToDecimal(group.base, 2),
        output_vat_amount: scaledToDecimal(group.vat, 2),
        total_with_vat: scaledToDecimal(group.total, 2),
        created_by: ctx.user.id
      }))
    });
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoice.id },
      data: {
        status: outgoingInvoiceStatuses.waitingKif,
        kif_status: "WAITING_KIF",
        nalog_id: journal.id,
        posted_at: new Date(),
        posted_by: ctx.user.id,
        updated_by: ctx.user.id
      }
    });
    return { ok: true as const, journal: journal.sifra };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!result.ok) detail(id, result.reason);
  await auditLog({
    korisnikId: ctx.user.id,
    agencijaId: ctx.user.agencija_id,
    firmaId,
    modul: inventoryModule,
    akcija: "finalize_outgoing_invoice",
    tipEntiteta: "FiskalniIzlazniRacun",
    entitetId: id,
    novaVrijednost: result
  });
  revalidatePath(`/agencija/robno/izlazne-fakture/${id}`);
  detail(id, `zavrsena:${result.journal}`);
}
