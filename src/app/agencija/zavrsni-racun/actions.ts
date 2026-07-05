"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import {
  financialReportTypes,
  getBalanceSheetSettings,
  getIncomeStatementSettings,
  getStatisticalAnnexSettings,
  type ReportCorrectionColumn
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

function reportMoneyValue(value: FormDataEntryValue | null) {
  const raw = text(value);

  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
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

async function requireFinalAccountManageContextWithYear(redirectPath: string) {
  const context = await requireFinalAccountManageContext();
  const workContext = await readWorkContext();

  if (!workContext.poslovnaGodinaId) {
    redirect(`${redirectPath}?poruka=kontekst`);
  }

  const poslovnaGodina = await prisma.poslovnaGodina.findFirst({
    where: {
      id: workContext.poslovnaGodinaId,
      firma_id: context.firmaId
    },
    select: {
      id: true,
      zakljucena: true
    }
  });

  if (!poslovnaGodina) {
    redirect(`${redirectPath}?poruka=kontekst`);
  }

  if (poslovnaGodina.zakljucena) {
    redirect(`${redirectPath}?poruka=godina_zakljucena`);
  }

  return {
    ...context,
    poslovnaGodinaId: poslovnaGodina.id
  };
}

const reportTypesBySlug = {
  "bilans-stanja": financialReportTypes.balanceSheet,
  "bilans-uspjeha": financialReportTypes.incomeStatement,
  "statisticki-aneks": financialReportTypes.statisticalAnnex
} as const;

const validReportColumnsByType: Record<string, ReportCorrectionColumn[]> = {
  [financialReportTypes.balanceSheet]: [
    "tekuca_godina",
    "prethodna_godina_kraj",
    "prethodna_godina_pocetak"
  ],
  [financialReportTypes.incomeStatement]: ["tekuca_godina", "prethodna_godina"],
  [financialReportTypes.statisticalAnnex]: ["tekuca_godina", "prethodna_godina"]
};

function reportCorrectionsPath(slug: string, message: string) {
  return `/agencija/zavrsni-racun/obrasci?obrazac=${slug}&edit=1&poruka=${message}`;
}

function isValidReportColumn(tipSifra: string, column: string): column is ReportCorrectionColumn {
  return validReportColumnsByType[tipSifra]?.includes(column as ReportCorrectionColumn) ?? false;
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

export async function saveFinancialReportCorrections(formData: FormData) {
  const reportSlug = text(formData.get("obrazac")) || "bilans-stanja";
  const tipSifra = reportTypesBySlug[reportSlug as keyof typeof reportTypesBySlug];

  if (!tipSifra) {
    redirect(reportCorrectionsPath("bilans-stanja", "neispravno"));
  }

  const context = await requireFinalAccountManageContextWithYear(
    `/agencija/zavrsni-racun/obrasci?obrazac=${reportSlug}&edit=1`
  );
  const resetKey = text(formData.get("reset_key"));

  if (resetKey) {
    const [aop, column] = resetKey.split(":");

    if (aop && column && isValidReportColumn(tipSifra, column)) {
      await prisma.finansijskiIzvjestajKorekcija.deleteMany({
        where: {
          agencija_id: context.agencijaId,
          firma_id: context.firmaId,
          poslovna_godina_id: context.poslovnaGodinaId,
          tip_sifra: tipSifra,
          aop,
          kolona: column
        }
      });

      await auditLog({
        korisnikId: context.user.id,
        agencijaId: context.agencijaId,
        firmaId: context.firmaId,
        modul: "zavrsni_racun",
        akcija: "reset_korekcije_obrasca",
        tipEntiteta: "finansijski_izvjestaj_korekcija",
        novaVrijednost: {
          tip: tipSifra,
          aop,
          kolona: column
        }
      });
    }

    revalidatePath("/agencija/zavrsni-racun/obrasci");
    revalidatePath("/stampa/zavrsni-racun/bilans-stanja");
    revalidatePath("/stampa/zavrsni-racun/bilans-uspjeha");
    revalidatePath("/stampa/zavrsni-racun/statisticki-aneks");
    redirect(reportCorrectionsPath(reportSlug, "korekcija_resetovana"));
  }

  const aops = formData.getAll("aop");
  const columns = formData.getAll("kolona");
  const values = formData.getAll("vrijednost");
  const automaticValues = formData.getAll("automatska_vrijednost");
  let saved = 0;
  let deleted = 0;

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < aops.length; index += 1) {
      const aop = text(aops[index]);
      const column = text(columns[index]);

      if (!aop || !isValidReportColumn(tipSifra, column)) {
        continue;
      }

      const value = reportMoneyValue(values[index]);
      const automaticValue = reportMoneyValue(automaticValues[index]) ?? 0;

      if (value === null || Math.round(value) === Math.round(automaticValue)) {
        const result = await tx.finansijskiIzvjestajKorekcija.deleteMany({
          where: {
            agencija_id: context.agencijaId,
            firma_id: context.firmaId,
            poslovna_godina_id: context.poslovnaGodinaId,
            tip_sifra: tipSifra,
            aop,
            kolona: column
          }
        });
        deleted += result.count;
        continue;
      }

      await tx.finansijskiIzvjestajKorekcija.upsert({
        where: {
          firma_id_poslovna_godina_id_tip_sifra_aop_kolona: {
            firma_id: context.firmaId,
            poslovna_godina_id: context.poslovnaGodinaId,
            tip_sifra: tipSifra,
            aop,
            kolona: column
          }
        },
        create: {
          agencija_id: context.agencijaId,
          firma_id: context.firmaId,
          poslovna_godina_id: context.poslovnaGodinaId,
          tip_sifra: tipSifra,
          aop,
          kolona: column,
          vrijednost: value.toFixed(2),
          created_by: context.user.id,
          updated_by: context.user.id
        },
        update: {
          vrijednost: value.toFixed(2),
          updated_by: context.user.id
        }
      });
      saved += 1;
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firmaId,
    modul: "zavrsni_racun",
    akcija: "korekcije_obrasca",
    tipEntiteta: "finansijski_izvjestaj_korekcija",
    novaVrijednost: {
      tip: tipSifra,
      sacuvano: saved,
      obrisano: deleted
    }
  });

  revalidatePath("/agencija/zavrsni-racun/obrasci");
  revalidatePath("/stampa/zavrsni-racun/bilans-stanja");
  revalidatePath("/stampa/zavrsni-racun/bilans-uspjeha");
  revalidatePath("/stampa/zavrsni-racun/statisticki-aneks");
  redirect(reportCorrectionsPath(reportSlug, "korekcije_sacuvane"));
}
