"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import {
  calculationPostingFields,
  calculationPostingScope
} from "@/lib/inventory-calculation";
import { inventoryModule } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import { getInventoryContext } from "../_shared";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export async function saveCalculationPostingSettings(formData: FormData) {
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));

  if (
    !context.allowed ||
    !context.firma ||
    !context.user.agencija_id ||
    context.firma.id !== firmaId
  ) {
    redirect(`${returnPath}?poruka=prava`);
  }

  const entries = calculationPostingFields.map((field) => ({
    ...field,
    accountCode: text(formData.get(`konto_${field.purpose}`)),
    direction: text(formData.get(`smjer_${field.purpose}`))
  }));
  const codes = [...new Set(entries.map((entry) => entry.accountCode).filter(Boolean))];

  const [baseAccounts, companyAccounts] = await Promise.all([
    prisma.konto.findMany({
      where: {
        sifra: { in: codes },
        tip_konta: "analiticko",
        aktivan: true
      },
      select: { sifra: true }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: firmaId,
        sifra: { in: codes },
        tip_konta: "analiticko",
        aktivan: true,
        override_type: { not: accountOverrideTypes.deactivated }
      },
      select: { sifra: true }
    })
  ]);
  const validCodes = new Set([
    ...baseAccounts.map((account) => account.sifra),
    ...companyAccounts.map((account) => account.sifra)
  ]);

  if (
    entries.some(
      (entry) =>
        (entry.accountCode && !validCodes.has(entry.accountCode)) ||
        !["D", "P"].includes(entry.direction)
    )
  ) {
    redirect(`${returnPath}?poruka=neispravna_konta`);
  }

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const where = {
        firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: {
          firma_id: firmaId,
          namjena: entry.purpose,
          dokument_tip: calculationPostingScope.documentType,
          podvrsta: calculationPostingScope.subtype,
          pdv_stopa_sifra: calculationPostingScope.vatRate
        }
      };

      if (!entry.accountCode) {
        await tx.firmaPodrazumijevanoKonto.deleteMany({
          where: where.firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra
        });
        continue;
      }

      await tx.firmaPodrazumijevanoKonto.upsert({
        where,
        create: {
          ...where.firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra,
          sifra_konta: entry.accountCode,
          smjer: entry.direction,
          napomena: entry.description,
          created_by: context.user.id,
          updated_by: context.user.id
        },
        update: {
          sifra_konta: entry.accountCode,
          smjer: entry.direction,
          napomena: entry.description,
          updated_by: context.user.id
        }
      });
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.user.agencija_id,
    firmaId,
    modul: inventoryModule,
    akcija: "save_calculation_posting_settings",
    tipEntiteta: "FirmaPodrazumijevanoKonto",
    entitetId: firmaId,
    novaVrijednost: entries.map((entry) => ({
      namjena: entry.purpose,
      konto: entry.accountCode,
      smjer: entry.direction
    }))
  });

  revalidatePath(returnPath);
  revalidatePath("/agencija/robno/kalkulacije");
  redirect(`${returnPath}?poruka=sacuvano`);
}
