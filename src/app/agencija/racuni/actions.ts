"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function parseDate(formData: FormData, key: string) {
  const data = value(formData, key);

  if (!data) {
    return null;
  }

  return new Date(`${data}T00:00:00.000Z`);
}

function parseMoneyToCents(input: string) {
  const normalized = input.trim().replace(",", ".");

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

function centsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}

function percentToNumber(value: { toString(): string }) {
  const parsed = Number(value.toString());

  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveCompanyAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  const companyAccount = await tx.firmaKonto.findUnique({
    where: {
      firma_id_sifra: {
        firma_id: firmaId,
        sifra: accountCode
      }
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });

  if (companyAccount) {
    if (
      !companyAccount.aktivan ||
      companyAccount.override_type === accountOverrideTypes.deactivated ||
      companyAccount.tip_konta !== "analiticko"
    ) {
      return null;
    }

    return companyAccount;
  }

  const baseAccount = await tx.konto.findUnique({
    where: {
      sifra: accountCode
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true,
      aktivan: true
    }
  });

  if (!baseAccount?.aktivan || baseAccount.tip_konta !== "analiticko") {
    return null;
  }

  return tx.firmaKonto.create({
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
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });
}

function redirectKuf(message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/kuf?${params.toString()}`);
}

export async function createKufEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKuf("kuf_kontekst");
  }

  const supplierId = value(formData, "dobavljac_id");
  const supplierInvoiceNumber = value(formData, "supplier_invoice_number");
  const invoiceDate = parseDate(formData, "invoice_date");
  const receiptDate = parseDate(formData, "receipt_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const expenseAccountCode = value(formData, "expense_account_code");

  if (
    !supplierId ||
    !supplierInvoiceNumber ||
    !invoiceDate ||
    !receiptDate ||
    !expenseAccountCode ||
    invoiceTotalCents === null ||
    invoiceTotalCents <= 0
  ) {
    redirectKuf("kuf_obavezno");
  }

  const [firma, poslovnaGodina, supplier] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true,
        zakljucena: true
      }
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        aktivan: true,
        OR: [
          {
            scope: "GLOBAL"
          },
          {
            scope: "AGENCY",
            agencija_id: user.agencija_id
          },
          {
            scope: "COMPANY",
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !supplier) {
    redirectKuf("kuf_greska");
  }

  const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
  const baseValues = formData.getAll("tax_base").map((item) => String(item));
  const vatValues = formData.getAll("input_vat_amount").map((item) => String(item));
  const nonDeductibleValues = formData
    .getAll("non_deductible_vat_amount")
    .map((item) => String(item));

  const activeRates = await prisma.pdvStopa.findMany({
    where: {
      agencija_id: user.agencija_id,
      aktivna: true
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      procenat: true
    }
  });
  const ratesById = new Map(activeRates.map((rate) => [rate.id, rate]));
  const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
  let totalBaseCents = 0;
  let totalInputVatCents = 0;
  let deductibleVatCents = 0;
  let nonDeductibleVatCents = 0;

  for (let index = 0; index < vatRateIds.length; index += 1) {
    const rate = ratesById.get(vatRateIds[index]);
    const baseCents = parseMoneyToCents(baseValues[index] ?? "");
    const submittedVatCents = parseMoneyToCents(vatValues[index] ?? "");
    const nonDeductibleCents = parseMoneyToCents(nonDeductibleValues[index] ?? "");

    if (!rate || baseCents === null || submittedVatCents === null || nonDeductibleCents === null) {
      redirectKuf("kuf_iznosi");
    }

    const calculatedVatCents = Math.round(baseCents * percentToNumber(rate.procenat) / 100);
    const inputVatCents = baseCents > 0 ? calculatedVatCents : submittedVatCents;

    if (baseCents === 0 && inputVatCents === 0 && nonDeductibleCents === 0) {
      continue;
    }

    if (nonDeductibleCents > inputVatCents) {
      redirectKuf("kuf_iznosi");
    }

    const deductibleCents = inputVatCents - nonDeductibleCents;

    totalBaseCents += baseCents;
    totalInputVatCents += inputVatCents;
    deductibleVatCents += deductibleCents;
    nonDeductibleVatCents += nonDeductibleCents;

    taxLines.push({
      vat_rate_id: rate.id,
      vat_rate_code: rate.sifra,
      vat_rate_name: rate.naziv,
      vat_rate_percent: rate.procenat,
      tax_base: centsToDecimal(baseCents),
      input_vat_amount: centsToDecimal(inputVatCents),
      deductible_vat_amount: centsToDecimal(deductibleCents),
      non_deductible_vat_amount: centsToDecimal(nonDeductibleCents),
      total_with_vat: centsToDecimal(baseCents + inputVatCents),
      created_by: user.id
    });
  }

  if (taxLines.length === 0 || totalBaseCents + totalInputVatCents <= 0) {
    redirectKuf("kuf_iznosi");
  }

  const calculatedGrossCents = totalBaseCents + totalInputVatCents;

  if (Math.abs(invoiceTotalCents - calculatedGrossCents) > 1) {
    redirectKuf("kuf_ukupno");
  }

  const kufEntry = await prisma.$transaction(async (tx) => {
    const expenseAccount = await resolveCompanyAccount(tx, firma.id, expenseAccountCode);

    if (!expenseAccount || !expenseAccount.sifra.startsWith("5")) {
      return null;
    }

    const lastEntry = await tx.kufEntry.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastEntry?.redni_broj ?? 0) + 1;
    const internalNumber = `KUF-${poslovnaGodina.godina}-${String(redniBroj).padStart(4, "0")}`;

    return tx.kufEntry.create({
      data: {
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        dobavljac_id: supplier.id,
        redni_broj: redniBroj,
        internal_kuf_number: internalNumber,
        supplier_invoice_number: supplierInvoiceNumber,
        invoice_date: invoiceDate,
        receipt_date: receiptDate,
        due_date: dueDate,
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalInputVatCents),
        deductible_vat: centsToDecimal(deductibleVatCents),
        non_deductible_vat: centsToDecimal(nonDeductibleVatCents),
        total_gross: centsToDecimal(invoiceTotalCents),
        expense_account_id: expenseAccount.id,
        note,
        created_by: user.id,
        updated_by: user.id,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        id: true,
        internal_kuf_number: true,
        supplier_invoice_number: true,
        total_gross: true
      }
    });
  });

  if (!kufEntry) {
    redirectKuf("kuf_konto");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kuf",
    akcija: "create",
    tipEntiteta: "KufEntry",
    entitetId: kufEntry.id,
    novaVrijednost: kufEntry
  });

  revalidatePath("/agencija/racuni/kuf");
  redirectKuf("kuf_sacuvan");
}
