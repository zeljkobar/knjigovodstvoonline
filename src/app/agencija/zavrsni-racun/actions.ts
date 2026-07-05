"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import {
  financialReportTypes,
  getBalanceSheetSettings,
  getIncomeStatementSettings,
  getStatisticalAnnexSettings
} from "@/lib/financial-reports";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(text(value));

  return Number.isFinite(parsed) ? parsed : fallback;
}

async function requireFinalAccountManageContext() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId) {
    redirect("/agencija/zavrsni-racun/podesavanja?poruka=kontekst");
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "manage"
  });

  if (!allowed) {
    redirect("/agencija/zavrsni-racun/podesavanja?poruka=prava");
  }

  return {
    user,
    agencijaId: user.agencija_id,
    firmaId: workContext.firmaId
  };
}

async function saveFinancialReportSettings({
  formData,
  getSettings,
  tipSifra,
  naziv,
  auditAction,
  errorPath,
  redirectPath,
  revalidatePaths
}: {
  formData: FormData;
  getSettings: typeof getIncomeStatementSettings;
  tipSifra: string;
  naziv: string;
  auditAction: string;
  errorPath: string;
  redirectPath: string;
  revalidatePaths: string[];
}) {
  const context = await requireFinalAccountManageContext();
  const rbrValues = formData.getAll("rbr");
  const aopValues = formData.getAll("aop");
  const pozicijaValues = formData.getAll("pozicija");
  const uslovValues = formData.getAll("uslov");
  const formulaValues = formData.getAll("formula");
  const kontoValues = formData.getAll("konto");
  const preskociValues = formData.getAll("preskoci_konta");
  const znakValues = formData.getAll("znak");
  const nivoValues = formData.getAll("nivo");
  const grupaValues = formData.getAll("grupa");
  const boldValues = formData.getAll("bold");
  const prikaziValues = formData.getAll("prikazi");
  const rucniUnosValues = formData.getAll("rucni_unos");

  if (rbrValues.length === 0) {
    redirect(`${errorPath}?poruka=prazno`);
  }

  const currentSettings = await getSettings(context.agencijaId, context.firmaId);
  const rows = rbrValues.map((entry, index) => ({
    rbr: numberValue(entry),
    aop: text(aopValues[index]) || null,
    pozicija: text(pozicijaValues[index]),
    uslov: text(uslovValues[index]) || null,
    formula: text(formulaValues[index]) || null,
    konto: text(kontoValues[index]) || null,
    preskoci_konta: text(preskociValues[index]) || null,
    znak: numberValue(znakValues[index], 1),
    nivo: numberValue(nivoValues[index], 0),
    grupa: numberValue(grupaValues[index], 0),
    bold: text(boldValues[index]) === "1",
    prikazi: text(prikaziValues[index]) === "1",
    rucni_unos: text(rucniUnosValues[index]) === "1"
  }));

  if (rows.some((row) => !row.rbr || !row.pozicija)) {
    redirect(`${errorPath}?poruka=neispravno`);
  }

  await prisma.$transaction(async (tx) => {
    const template =
      currentSettings.source === "company"
        ? currentSettings.template
        : await tx.finansijskiIzvjestajSablon.create({
            data: {
              agencija_id: context.agencijaId,
              firma_id: context.firmaId,
              tip_sifra: tipSifra,
              naziv,
              sistemski: false,
              created_by: context.user.id,
              updated_by: context.user.id
            }
          });

    for (const row of rows) {
      await tx.finansijskiIzvjestajPozicija.upsert({
        where: {
          sablon_id_rbr: {
            sablon_id: template.id,
            rbr: row.rbr
          }
        },
        create: {
          sablon_id: template.id,
          ...row
        },
        update: row
      });
    }

    await tx.finansijskiIzvjestajSablon.update({
      where: {
        id: template.id
      },
      data: {
        updated_by: context.user.id
      }
    });
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firmaId,
    modul: "zavrsni_racun",
    akcija: auditAction,
    tipEntiteta: "finansijski_izvjestaj_sablon",
    novaVrijednost: {
      tip: tipSifra,
      redova: rows.length
    }
  });

  for (const path of revalidatePaths) {
    revalidatePath(path);
  }

  redirect(`${redirectPath}?poruka=sacuvano`);
}

export async function saveIncomeStatementSettings(formData: FormData) {
  await saveFinancialReportSettings({
    formData,
    getSettings: getIncomeStatementSettings,
    tipSifra: financialReportTypes.incomeStatement,
    naziv: "Bilans uspjeha",
    auditAction: "podesavanja_bilans_uspjeha",
    errorPath: "/agencija/zavrsni-racun/podesavanja",
    redirectPath: "/agencija/zavrsni-racun/podesavanja",
    revalidatePaths: [
      "/agencija/zavrsni-racun/obrasci",
      "/agencija/zavrsni-racun/podesavanja",
      "/stampa/zavrsni-racun/bilans-uspjeha"
    ]
  });
}

export async function saveBalanceSheetSettings(formData: FormData) {
  await saveFinancialReportSettings({
    formData,
    getSettings: getBalanceSheetSettings,
    tipSifra: financialReportTypes.balanceSheet,
    naziv: "Bilans stanja",
    auditAction: "podesavanja_bilans_stanja",
    errorPath: "/agencija/zavrsni-racun/podesavanja/bilans-stanja",
    redirectPath: "/agencija/zavrsni-racun/podesavanja/bilans-stanja",
    revalidatePaths: [
      "/agencija/zavrsni-racun/obrasci",
      "/agencija/zavrsni-racun/podesavanja/bilans-stanja",
      "/stampa/zavrsni-racun/bilans-stanja"
    ]
  });
}

export async function saveStatisticalAnnexSettings(formData: FormData) {
  await saveFinancialReportSettings({
    formData,
    getSettings: getStatisticalAnnexSettings,
    tipSifra: financialReportTypes.statisticalAnnex,
    naziv: "Statistički aneks",
    auditAction: "podesavanja_statisticki_aneks",
    errorPath: "/agencija/zavrsni-racun/podesavanja/statisticki-aneks",
    redirectPath: "/agencija/zavrsni-racun/podesavanja/statisticki-aneks",
    revalidatePaths: [
      "/agencija/zavrsni-racun/obrasci",
      "/agencija/zavrsni-racun/podesavanja/statisticki-aneks",
      "/stampa/zavrsni-racun/statisticki-aneks"
    ]
  });
}
