"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, type PlateObracun, type PlateRadnik } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import {
  calculatePayrollLine,
  calculateSeniorityCoefficient,
  defaultIncomeCodeForPayrollCategory,
  effectiveSeniorityYears,
  isPayrollCategory,
  parseMoneyToCents,
  payrollCategories,
  payrollCategoryLabel,
  payrollCategoryRequiresEmployment,
  payrollStatuses
} from "@/lib/payroll";
import { getM4Data } from "@/lib/payroll-m4";
import { prisma } from "@/lib/prisma";
import { getPlateContext } from "./_shared";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(text(value));

  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalValue(value: FormDataEntryValue | null, fallback = 0) {
  const raw = text(value).replace(",", ".");
  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateValue(value: FormDataEntryValue | null) {
  const raw = text(value);

  if (!raw) {
    return null;
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function requirePlateManageContext(returnPath: string) {
  const context = await getPlateContext("manage");

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    redirect(`${returnPath}?poruka=kontekst`);
  }

  if (!context.allowed) {
    redirect(`${returnPath}?poruka=prava`);
  }

  if (context.godina.zakljucena) {
    redirect(`${returnPath}?poruka=godina_zakljucena`);
  }

  return {
    user: context.user,
    agencijaId: context.user.agencija_id,
    firma: context.firma,
    godina: context.godina
  };
}

async function effectiveIncomeType(
  agencijaId: string,
  firmaId: string,
  incomeTypeId?: string | null,
  category: string = payrollCategories.regularWork
) {
  if (incomeTypeId) {
    const explicitIncomeType = await prisma.plateSifraPrimanja.findFirst({
      where: {
        id: incomeTypeId,
        aktivan: true,
        OR: [
          {
            agencija_id: agencijaId,
            firma_id: firmaId
          },
          {
            agencija_id: agencijaId,
            firma_id: null
          },
          {
            agencija_id: null,
            firma_id: null
          }
        ]
      }
    });

    if (explicitIncomeType) {
      return explicitIncomeType;
    }
  }

  const candidates = await prisma.plateSifraPrimanja.findMany({
    where: {
      sifra: defaultIncomeCodeForPayrollCategory(category),
      kategorija: category,
      aktivan: true,
      OR: [
        {
          agencija_id: agencijaId,
          firma_id: firmaId
        },
        {
          agencija_id: agencijaId,
          firma_id: null
        },
        {
          agencija_id: null,
          firma_id: null
        }
      ]
    },
    orderBy: {
      valid_from: "desc"
    }
  });

  return (
    candidates.find((item) => item.firma_id === firmaId) ??
    candidates.find((item) => item.agencija_id === agencijaId && item.firma_id === null) ??
    candidates.find((item) => item.agencija_id === null && item.firma_id === null) ??
    null
  );
}

function payrollEmployeeEligibilityWhere(
  context: Awaited<ReturnType<typeof requirePlateManageContext>>,
  category: string,
  employeeId?: string
): Prisma.PlateRadnikWhereInput {
  return {
    ...(employeeId ? { id: employeeId } : {}),
    agencija_id: context.agencijaId,
    firma_id: context.firma.id,
    aktivan: true,
    ...(payrollCategoryRequiresEmployment(category) ? { zaposlen: true } : {}),
    is_deleted: false
  };
}

async function effectiveCalculationType(calculationTypeId?: string | null) {
  if (calculationTypeId) {
    return prisma.plateVrstaObracuna.findFirst({
      where: {
        id: calculationTypeId,
        aktivan: true
      }
    });
  }

  return prisma.plateVrstaObracuna.findFirst({
    where: {
      sifra: "NET_WITHOUT_SENIORITY",
      aktivan: true
    }
  });
}

export async function savePayrollBasisRule(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate/podesavanja");
  const basisId = text(formData.get("osnova_id"));
  const ruleId = text(formData.get("pravilo_id"));
  const name = text(formData.get("naziv"));
  const validFrom = dateValue(formData.get("valid_from"));
  const validTo = dateValue(formData.get("valid_to"));
  const taxBasePercent = decimalValue(formData.get("osnovica_porez_proc"), 100);
  const taxRatePercent = decimalValue(formData.get("porez_stopa"), 0);

  if (!basisId || !name || !validFrom) {
    redirect("/agencija/plate/podesavanja?sekcija=ioppd&poruka=osnova_nevalidna");
  }

  const existing = await prisma.plateOsnovaObracuna.findUnique({
    where: {
      id: basisId
    },
    include: {
      pravila: {
        where: {
          ...(ruleId ? { id: ruleId } : { aktivan: true })
        },
        include: {
          stope: true
        },
        orderBy: {
          valid_from: "desc"
        },
        take: 1
      }
    }
  });

  if (!existing) {
    redirect("/agencija/plate/podesavanja?sekcija=ioppd&poruka=osnova_ne_postoji");
  }

  const saved = await prisma.$transaction(async (tx) => {
    const basis = await tx.plateOsnovaObracuna.update({
      where: {
        id: basisId
      },
      data: {
        naziv: name,
        opis: text(formData.get("opis")) || null,
        kategorija: text(formData.get("kategorija")) || null,
        m4_kategorija: text(formData.get("m4_kategorija")) || "NE_ULAZI",
        valid_from: validFrom,
        valid_to: validTo,
        aktivan: formData.get("aktivan") === "on",
        updated_by: context.user.id
      }
    });

    const ruleData = {
      valid_from: validFrom,
      valid_to: validTo,
      osnovica_porez_tip: text(formData.get("osnovica_porez_tip")) || null,
      osnovica_porez_proc: new Prisma.Decimal(taxBasePercent),
      porez_rok: text(formData.get("porez_rok")) || null,
      napomena: text(formData.get("napomena")) || null,
      aktivan: formData.get("pravilo_aktivan") === "on",
      updated_by: context.user.id
    };

    const rule =
      ruleId && existing.pravila[0]
        ? await tx.plateOsnovaPravilo.update({
            where: {
              id: ruleId
            },
            data: ruleData
          })
        : await tx.plateOsnovaPravilo.create({
            data: {
              osnova_id: basisId,
              ...ruleData,
              created_by: context.user.id
            }
          });

    const currentTaxRate = existing.pravila[0]?.stope.find((rate) => rate.tip === "POREZ");

    if (taxRatePercent > 0) {
      const taxRateData = {
        tip: "POREZ",
        teret: "POREZ",
        stopa: new Prisma.Decimal(taxRatePercent / 100),
        osnovica_tip: "OSNOVICA_POREZ",
        valid_from: validFrom,
        valid_to: validTo,
        napomena: text(formData.get("porez_napomena")) || null,
        aktivan: true,
        updated_by: context.user.id
      };

      if (currentTaxRate) {
        await tx.plateOsnovaStopa.update({
          where: {
            id: currentTaxRate.id
          },
          data: taxRateData
        });
      } else {
        await tx.plateOsnovaStopa.create({
          data: {
            pravilo_id: rule.id,
            ...taxRateData,
            created_by: context.user.id
          }
        });
      }
    }

    return {
      basis,
      rule
    };
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "update_basis_rule",
    tipEntiteta: "PlateOsnovaObracuna",
    entitetId: basisId,
    staraVrijednost: existing,
    novaVrijednost: saved
  });

  revalidatePath("/agencija/plate/podesavanja");
  redirect("/agencija/plate/podesavanja?sekcija=ioppd&poruka=osnova_sacuvana");
}

export async function saveM4MonthlyPayment(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate/m4");
  const month = numberValue(formData.get("mjesec"));
  const paymentMode = text(formData.get("nacin"));
  let moneyFields = {
    porez_cent: parseMoneyToCents(formData.get("porez")),
    zaposleni_pio_cent: parseMoneyToCents(formData.get("zaposleni_pio")),
    zaposleni_zdravstvo_cent: parseMoneyToCents(formData.get("zaposleni_zdravstvo")),
    zaposleni_nezaposleni_cent: parseMoneyToCents(formData.get("zaposleni_nezaposleni")),
    poslodavac_pio_cent: parseMoneyToCents(formData.get("poslodavac_pio")),
    poslodavac_zdravstvo_cent: parseMoneyToCents(formData.get("poslodavac_zdravstvo")),
    poslodavac_nezaposleni_cent: parseMoneyToCents(formData.get("poslodavac_nezaposleni")),
    fond_rada_cent: parseMoneyToCents(formData.get("fond_rada")),
    invalidi_cent: parseMoneyToCents(formData.get("invalidi"))
  };

  if (month < 1 || month > 12) {
    redirect("/agencija/plate/m4?poruka=m4_uplata_nevalidna");
  }

  if (paymentMode === "u_cijelosti") {
    const { report } = await getM4Data({
      agencijaId: context.agencijaId,
      firmaId: context.firma.id,
      poslovnaGodinaId: context.godina.id,
      godina: context.godina.godina
    });
    const calculatedMonth = report.months[month - 1];

    if (!calculatedMonth || calculatedMonth.ukupnoObracunatoCent <= 0) {
      redirect(`/agencija/plate/m4?poruka=m4_uplata_nema_obracuna&mjesec=${month}`);
    }

    moneyFields = {
      porez_cent: calculatedMonth.porezCent,
      zaposleni_pio_cent: calculatedMonth.zaposleniPioCent,
      zaposleni_zdravstvo_cent: calculatedMonth.zaposleniZdravstvoCent,
      zaposleni_nezaposleni_cent: calculatedMonth.zaposleniNezaposleniCent,
      poslodavac_pio_cent: calculatedMonth.poslodavacPioCent,
      poslodavac_zdravstvo_cent: calculatedMonth.poslodavacZdravstvoCent,
      poslodavac_nezaposleni_cent: calculatedMonth.poslodavacNezaposleniCent,
      fond_rada_cent: calculatedMonth.fondRadaCent,
      invalidi_cent: calculatedMonth.invalidiCent
    };
  }

  if (Object.values(moneyFields).some((value) => value === null || value < 0)) {
    redirect("/agencija/plate/m4?poruka=m4_uplata_nevalidna");
  }

  const values = moneyFields as Record<keyof typeof moneyFields, number>;
  const unique = {
    firma_id_poslovna_godina_id_mjesec: {
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      mjesec: month
    }
  };
  const previous = await prisma.plateM4MjesecnaUplata.findUnique({ where: unique });
  const sharedData = {
    ...values,
    datum_uplate: dateValue(formData.get("datum_uplate")),
    referenca: text(formData.get("referenca")) || null,
    potvrdjena: paymentMode === "u_cijelosti" || formData.get("potvrdjena") === "on",
    updated_by: context.user.id
  };
  const saved = await prisma.plateM4MjesecnaUplata.upsert({
    where: unique,
    create: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      mjesec: month,
      ...sharedData,
      created_by: context.user.id
    },
    update: sharedData
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: paymentMode === "u_cijelosti" ? "confirm_m4_full_payment" : "save_m4_payment",
    tipEntiteta: "PlateM4MjesecnaUplata",
    entitetId: saved.id,
    staraVrijednost: previous,
    novaVrijednost: saved
  });

  revalidatePath("/agencija/plate/m4");
  revalidatePath("/stampa/plate/m4");
  const message = paymentMode === "u_cijelosti" ? "m4_uplata_puna_sacuvana" : "m4_uplata_sacuvana";
  redirect(`/agencija/plate/m4?poruka=${message}&mjesec=${month}`);
}

export async function createPayrollEmployee(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate");
  const ime = text(formData.get("ime"));
  const prezime = text(formData.get("prezime"));
  const neto = parseMoneyToCents(formData.get("neto_iznos"));
  const bruto = parseMoneyToCents(formData.get("bruto_iznos"));
  const fiksniDio = parseMoneyToCents(formData.get("fiksni_dio"));

  if (!ime || !prezime || neto === null || bruto === null || fiksniDio === null) {
    redirect("/agencija/plate?poruka=radnik_nevalidan");
  }

  const employee = await prisma.plateRadnik.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      ime,
      prezime,
      ime_roditelja: text(formData.get("ime_roditelja")) || null,
      jmbg: text(formData.get("jmbg")) || null,
      licni_broj_osiguranika: text(formData.get("licni_broj_osiguranika")) || null,
      m4_oznaka_staza: text(formData.get("m4_oznaka_staza")) || "01",
      opstina: text(formData.get("opstina")) || null,
      poreska_opstina: text(formData.get("poreska_opstina")) || null,
      tekuci_racun: text(formData.get("tekuci_racun")) || null,
      datum_pocetka: dateValue(formData.get("datum_pocetka")),
      radno_mjesto: text(formData.get("radno_mjesto")) || null,
      procenat_radnog_vremena: decimalValue(formData.get("procenat_radnog_vremena"), 100),
      mjesecni_sati: numberValue(formData.get("mjesecni_sati"), 0) || null,
      koristi_minuli_rad: formData.get("koristi_minuli_rad") === "on",
      minuli_rad_godina: numberValue(formData.get("minuli_rad_godina")),
      koeficijent_minuli_rad: decimalValue(formData.get("koeficijent_minuli_rad")),
      koeficijent_slozenosti: decimalValue(formData.get("koeficijent_slozenosti")) || null,
      fiksni_dio_cent: fiksniDio,
      neto_iznos_cent: neto,
      bruto_iznos_cent: bruto,
      podrazumijevana_sifra_id: text(formData.get("podrazumijevana_sifra_id")) || null,
      podrazumijevana_vrsta_id: text(formData.get("podrazumijevana_vrsta_id")) || null,
      created_by: context.user.id,
      updated_by: context.user.id
    },
    select: {
      id: true,
      ime: true,
      prezime: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "create_employee",
    tipEntiteta: "PlateRadnik",
    entitetId: employee.id,
    novaVrijednost: employee
  });

  revalidatePath("/agencija/plate");
  redirect("/agencija/plate?poruka=radnik_dodat");
}

export async function updatePayrollEmployee(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate");
  const employeeId = text(formData.get("radnik_id"));
  const ime = text(formData.get("ime"));
  const prezime = text(formData.get("prezime"));
  const neto = parseMoneyToCents(formData.get("neto_iznos"));
  const bruto = parseMoneyToCents(formData.get("bruto_iznos"));
  const fiksniDio = parseMoneyToCents(formData.get("fiksni_dio"));

  if (!employeeId || !ime || !prezime || neto === null || bruto === null || fiksniDio === null) {
    redirect("/agencija/plate?poruka=radnik_nevalidan");
  }

  const previous = await prisma.plateRadnik.findFirst({
    where: {
      id: employeeId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });

  if (!previous) {
    redirect("/agencija/plate?poruka=radnik_nevalidan");
  }

  const updated = await prisma.plateRadnik.update({
    where: {
      id: previous.id
    },
    data: {
      ime,
      prezime,
      ime_roditelja: text(formData.get("ime_roditelja")) || null,
      jmbg: text(formData.get("jmbg")) || null,
      licni_broj_osiguranika: text(formData.get("licni_broj_osiguranika")) || null,
      m4_oznaka_staza: text(formData.get("m4_oznaka_staza")) || "01",
      opstina: text(formData.get("opstina")) || null,
      poreska_opstina: text(formData.get("poreska_opstina")) || null,
      tekuci_racun: text(formData.get("tekuci_racun")) || null,
      datum_pocetka: dateValue(formData.get("datum_pocetka")),
      datum_prestanka: dateValue(formData.get("datum_prestanka")),
      radno_mjesto: text(formData.get("radno_mjesto")) || null,
      procenat_radnog_vremena: decimalValue(formData.get("procenat_radnog_vremena"), 100),
      mjesecni_sati: numberValue(formData.get("mjesecni_sati"), 0) || null,
      koristi_minuli_rad: formData.get("koristi_minuli_rad") === "on",
      minuli_rad_godina: numberValue(formData.get("minuli_rad_godina")),
      koeficijent_minuli_rad: decimalValue(formData.get("koeficijent_minuli_rad")),
      koeficijent_slozenosti: decimalValue(formData.get("koeficijent_slozenosti")) || null,
      fiksni_dio_cent: fiksniDio,
      neto_iznos_cent: neto,
      bruto_iznos_cent: bruto,
      podrazumijevana_sifra_id: text(formData.get("podrazumijevana_sifra_id")) || null,
      podrazumijevana_vrsta_id: text(formData.get("podrazumijevana_vrsta_id")) || null,
      aktivan: formData.get("aktivan") === "on",
      zaposlen: formData.get("zaposlen") === "on",
      updated_by: context.user.id
    },
    select: {
      id: true,
      ime: true,
      prezime: true,
      aktivan: true,
      zaposlen: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "update_employee",
    tipEntiteta: "PlateRadnik",
    entitetId: updated.id,
    staraVrijednost: previous,
    novaVrijednost: updated
  });

  revalidatePath("/agencija/plate");
  redirect(`/agencija/plate?tab=${updated.aktivan && updated.zaposlen ? "aktivni" : "neaktivni"}&poruka=radnik_izmijenjen`);
}

export async function deactivatePayrollEmployee(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate");
  const employeeId = text(formData.get("radnik_id"));
  const endDate = dateValue(formData.get("datum_prestanka"));
  const reason = text(formData.get("razlog_prestanka"));

  if (!employeeId || !endDate) {
    redirect("/agencija/plate?tab=aktivni&poruka=odjava_nevalidna");
  }

  const previous = await prisma.plateRadnik.findFirst({
    where: {
      id: employeeId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });

  if (!previous) {
    redirect("/agencija/plate?tab=aktivni&poruka=radnik_nevalidan");
  }

  const updated = await prisma.plateRadnik.update({
    where: {
      id: previous.id
    },
    data: {
      zaposlen: false,
      datum_prestanka: endDate,
      razlog_prestanka: reason || null,
      updated_by: context.user.id
    },
    select: {
      id: true,
      ime: true,
      prezime: true,
      datum_prestanka: true,
      razlog_prestanka: true,
      zaposlen: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "deactivate_employee",
    tipEntiteta: "PlateRadnik",
    entitetId: updated.id,
    staraVrijednost: previous,
    novaVrijednost: updated
  });

  revalidatePath("/agencija/plate");
  redirect("/agencija/plate?tab=neaktivni&poruka=radnik_odjavljen");
}

export async function reactivatePayrollEmployee(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate");
  const employeeId = text(formData.get("radnik_id"));

  if (!employeeId) {
    redirect("/agencija/plate?tab=neaktivni&poruka=radnik_nevalidan");
  }

  const previous = await prisma.plateRadnik.findFirst({
    where: {
      id: employeeId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });

  if (!previous) {
    redirect("/agencija/plate?tab=neaktivni&poruka=radnik_nevalidan");
  }

  const updated = await prisma.plateRadnik.update({
    where: {
      id: previous.id
    },
    data: {
      aktivan: true,
      zaposlen: true,
      datum_prestanka: null,
      razlog_prestanka: null,
      updated_by: context.user.id
    },
    select: {
      id: true,
      ime: true,
      prezime: true,
      aktivan: true,
      zaposlen: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "reactivate_employee",
    tipEntiteta: "PlateRadnik",
    entitetId: updated.id,
    staraVrijednost: previous,
    novaVrijednost: updated
  });

  revalidatePath("/agencija/plate");
  redirect("/agencija/plate?tab=aktivni&poruka=radnik_reaktiviran");
}

export async function createPayrollCalculation(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate/obracun");
  const category = text(formData.get("kategorija")) || payrollCategories.regularWork;
  const month = numberValue(formData.get("mjesec"));
  const year = numberValue(formData.get("godina"), context.godina.godina);
  const datumOd = dateValue(formData.get("datum_od"));
  const datumDo = dateValue(formData.get("datum_do"));
  const datumObracuna = dateValue(formData.get("datum_obracuna"));
  const datumIsplate = dateValue(formData.get("datum_isplate"));
  const fondSati = numberValue(formData.get("fond_sati"), 176);

  if (!isPayrollCategory(category) || month < 1 || month > 12 || !datumOd || !datumDo || !datumObracuna || fondSati <= 0) {
    redirect("/agencija/plate/obracun?poruka=obracun_nevalidan");
  }

  const last = await prisma.plateObracun.findFirst({
    where: {
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      kategorija: category
    },
    orderBy: {
      broj: "desc"
    },
    select: {
      broj: true
    }
  });
  const calculation = await prisma.plateObracun.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      kategorija: category,
      broj: (last?.broj ?? 0) + 1,
      oznaka: payrollCategoryLabel(category),
      godina: year,
      mjesec: month,
      datum_od: datumOd,
      datum_do: datumDo,
      datum_obracuna: datumObracuna,
      datum_isplate: datumIsplate,
      fond_sati: fondSati,
      koristi_minuli_rad: true,
      napomena: text(formData.get("napomena")) || null,
      created_by: context.user.id,
      updated_by: context.user.id
    },
    select: {
      id: true,
      broj: true,
      godina: true,
      mjesec: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "create_calculation",
    tipEntiteta: "PlateObracun",
    entitetId: calculation.id,
    novaVrijednost: calculation
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=obracun_dodat`);
}

export async function deletePayrollCalculation(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");

  if (!calculationId) {
    redirect("/agencija/plate/obracun?poruka=obracun_obavezan");
  }

  const calculation = await getEditableCalculation(calculationId, context);

  if (!calculation) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  await prisma.plateObracun.update({
    where: {
      id: calculation.id
    },
    data: {
      status: payrollStatuses.deleted,
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: context.user.id,
      delete_reason: "Obračun obrisan iz modula plata",
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "delete_calculation",
    tipEntiteta: "PlateObracun",
    entitetId: calculation.id,
    staraVrijednost: calculation,
    novaVrijednost: {
      is_deleted: true,
      status: payrollStatuses.deleted
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect("/agencija/plate/obracun?poruka=obracun_obrisan");
}

async function getEditableCalculation(calculationId: string, context: Awaited<ReturnType<typeof requirePlateManageContext>>) {
  const calculation = await prisma.plateObracun.findFirst({
    where: {
      id: calculationId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      is_deleted: false
    }
  });

  if (!calculation || [payrollStatuses.posted, payrollStatuses.locked].includes(calculation.status as never)) {
    return null;
  }

  return calculation;
}

function employeeSnapshot(employee: {
  ime: string;
  prezime: string;
  jmbg: string | null;
  opstina: string | null;
  poreska_opstina: string | null;
  tekuci_racun: string | null;
  radno_mjesto: string | null;
  neto_iznos_cent: number;
  bruto_iznos_cent: number;
  koeficijent_slozenosti: { toString(): string } | null;
}) {
  return JSON.parse(
    JSON.stringify({
      ime: employee.ime,
      prezime: employee.prezime,
      jmbg: employee.jmbg,
      opstina: employee.opstina,
      poreskaOpstina: employee.poreska_opstina,
      tekuciRacun: employee.tekuci_racun,
      radnoMjesto: employee.radno_mjesto,
      netoIznosCent: employee.neto_iznos_cent,
      brutoIznosCent: employee.bruto_iznos_cent,
      koeficijentSlozenosti: employee.koeficijent_slozenosti?.toString() ?? null
    })
  ) as Prisma.InputJsonValue;
}

function payrollBlockingIssuesForLine({
  employee,
  line,
  calculationDate
}: {
  employee: {
    ime: string;
    prezime: string;
    jmbg: string | null;
    opstina: string | null;
    poreska_opstina: string | null;
    datum_pocetka: Date | null;
    minuli_rad_godina: number;
  };
  line: {
    ukupno_sati: number;
    input_neto_cent: number;
    input_bruto_cent: number;
    fiksni_dio_cent: number;
    koeficijent_slozenosti: { toString(): string } | null;
    sifra_primanja_id: string;
    vrsta_obracuna_id: string;
    koristi_minuli_rad: boolean;
  };
  calculationDate: Date;
}) {
  const issues: string[] = [];
  const employeeName = `${employee.prezime} ${employee.ime}`;

  if (!employee.jmbg?.trim()) {
    issues.push(`${employeeName}: nedostaje JMBG.`);
  }

  if (!(employee.poreska_opstina ?? employee.opstina)?.trim()) {
    issues.push(`${employeeName}: nedostaje poreska opština/opština.`);
  }

  if (!line.sifra_primanja_id || !line.vrsta_obracuna_id) {
    issues.push(`${employeeName}: nedostaje šifra primanja ili vrsta obračuna.`);
  }

  if (line.ukupno_sati <= 0) {
    issues.push(`${employeeName}: sati za obračun moraju biti veći od nule.`);
  }

  if (
    line.input_neto_cent === 0 &&
    line.input_bruto_cent === 0 &&
    line.fiksni_dio_cent === 0 &&
    Number(line.koeficijent_slozenosti ?? 0) === 0
  ) {
    issues.push(`${employeeName}: nedostaje neto/bruto/fiksni dio ili koeficijent za obračun.`);
  }

  if (
    line.koristi_minuli_rad &&
    effectiveSeniorityYears({
      manualYears: employee.minuli_rad_godina,
      startDate: employee.datum_pocetka,
      referenceDate: calculationDate
    }) === 0
  ) {
    issues.push(`${employeeName}: uključen je minuli rad, ali nema navršenih godina staža.`);
  }

  return issues;
}

async function createCalculationWorkerWithDefaultLine({
  tx,
  calculation,
  employee,
  context,
  redniBroj
}: {
  tx: Prisma.TransactionClient;
  calculation: PlateObracun;
  employee: PlateRadnik | null;
  context: Awaited<ReturnType<typeof requirePlateManageContext>>;
  redniBroj: number;
}) {
  if (!employee) {
    return null;
  }

  const incomeType = await effectiveIncomeType(
    context.agencijaId,
    context.firma.id,
    employee.podrazumijevana_sifra_id,
    calculation.kategorija
  );
  const calculationType = await effectiveCalculationType(
    calculation.kategorija === payrollCategories.regularWork
      ? employee.podrazumijevana_vrsta_id ?? incomeType?.vrsta_obracuna_id
      : incomeType?.vrsta_obracuna_id
  );

  if (!incomeType || !calculationType) {
    return null;
  }

  const seniorityYears = effectiveSeniorityYears({
    manualYears: employee.minuli_rad_godina,
    startDate: employee.datum_pocetka,
    referenceDate: calculation.datum_do
  });
  const employeeHours = employee.mjesecni_sati ?? Math.round(
    calculation.fond_sati * (Number(employee.procenat_radnog_vremena) / 100)
  );
  const calculationEmployee = await tx.plateObracunRadnik.upsert({
    where: {
      obracun_id_radnik_id: {
        obracun_id: calculation.id,
        radnik_id: employee.id
      }
    },
    update: {
      snapshot: employeeSnapshot(employee),
      minuli_rad_godina: seniorityYears,
      minuli_rad_mjeseci: employee.minuli_rad_mjeseci,
      minuli_rad_dana: employee.minuli_rad_dana,
      fond_sati: calculation.fond_sati,
      ukupno_sati: employeeHours,
      status: payrollStatuses.draft,
      updated_by: context.user.id
    },
    create: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      obracun_id: calculation.id,
      radnik_id: employee.id,
      snapshot: employeeSnapshot(employee),
      minuli_rad_godina: seniorityYears,
      minuli_rad_mjeseci: employee.minuli_rad_mjeseci,
      minuli_rad_dana: employee.minuli_rad_dana,
      fond_sati: calculation.fond_sati,
      ukupno_sati: employeeHours,
      status: payrollStatuses.draft,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });
  const seniorityCoefficient = employee.koristi_minuli_rad
    ? calculateSeniorityCoefficient(seniorityYears)
    : 0;

  const line = await tx.plateObracunStavka.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      obracun_id: calculation.id,
      radnik_id: employee.id,
      obracun_radnik_id: calculationEmployee.id,
      redni_broj: redniBroj,
      sifra_primanja_id: incomeType.id,
      ioppd_sifra_id: incomeType.ioppd_sifra_id,
      vrsta_obracuna_id: calculationType.id,
      sifra_primanja: incomeType.sifra,
      naziv_primanja: incomeType.naziv,
      datum_od: calculation.datum_od,
      datum_do: calculation.datum_do,
      fond_sati: calculation.fond_sati,
      ukupno_sati: employeeHours,
      procenat: 100,
      input_neto_cent: employee.neto_iznos_cent,
      input_bruto_cent: employee.bruto_iznos_cent,
      fiksni_dio_cent: employee.fiksni_dio_cent,
      koeficijent_slozenosti: employee.koeficijent_slozenosti,
      koeficijent_minuli_rad: seniorityCoefficient,
      koristi_minuli_rad: employee.koristi_minuli_rad,
      status: payrollStatuses.draft,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  return {
    calculationEmployee,
    line
  };
}

async function preparePayrollLines(calculationId: string, context: Awaited<ReturnType<typeof requirePlateManageContext>>) {
  const calculation = await getEditableCalculation(calculationId, context);

  if (!calculation) {
    return null;
  }

  const existingLines = await prisma.plateObracunStavka.count({
    where: {
      obracun_id: calculation.id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });

  if (existingLines > 0) {
    return {
      calculation,
      lineCount: existingLines
    };
  }

  const employees = await prisma.plateRadnik.findMany({
    where: payrollEmployeeEligibilityWhere(context, calculation.kategorija),
    orderBy: [
      {
        prezime: "asc"
      },
      {
        ime: "asc"
      }
    ]
  });

  if (employees.length === 0) {
    return {
      calculation,
      lineCount: 0
    };
  }

  const lineCount = await prisma.$transaction(async (tx) => {
    let count = 0;

    for (const employee of employees) {
      const created = await createCalculationWorkerWithDefaultLine({
        tx,
        calculation,
        employee,
        context,
        redniBroj: count + 1
      });

      if (created) {
        count += 1;
      }
    }

    await tx.plateObracun.update({
      where: {
        id: calculation.id
      },
      data: {
        status: payrollStatuses.draft,
        updated_by: context.user.id
      }
    });

    return count;
  });

  return {
    calculation,
    lineCount
  };
}

export async function preparePayrollCalculation(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");

  if (!calculationId) {
    redirect("/agencija/plate/obracun?poruka=obracun_obavezan");
  }

  const prepared = await preparePayrollLines(calculationId, context);

  if (!prepared?.calculation) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  if (prepared.lineCount === 0) {
    redirect(`/agencija/plate/obracun?obracun=${prepared.calculation.id}&poruka=radnici_prazno`);
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "prepare_payroll",
    tipEntiteta: "PlateObracun",
    entitetId: prepared.calculation.id,
    novaVrijednost: {
      lines: prepared.lineCount
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${prepared.calculation.id}&poruka=obracun_pripremljen`);
}

export async function addPayrollWorkerToCalculation(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const employeeId = text(formData.get("radnik_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");

  if (!calculationId || !employeeId) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=radnik_nevalidan`);
  }

  const calculation = await getEditableCalculation(calculationId, context);

  if (!calculation) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  const [employee, existingWorker, lastLine] = await Promise.all([
    prisma.plateRadnik.findFirst({
      where: payrollEmployeeEligibilityWhere(context, calculation.kategorija, employeeId)
    }),
    prisma.plateObracunRadnik.findFirst({
      where: {
        obracun_id: calculation.id,
        radnik_id: employeeId,
        agencija_id: context.agencijaId,
        firma_id: context.firma.id
      }
    }),
    prisma.plateObracunStavka.findFirst({
      where: {
        obracun_id: calculation.id,
        agencija_id: context.agencijaId,
        firma_id: context.firma.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    })
  ]);

  if (!employee) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=radnik_nevalidan`);
  }

  if (existingWorker) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&radnik=${employee.id}&poruka=radnik_vec_u_obracunu`);
  }

  const created = await prisma.$transaction(async (tx) => {
    const worker = await createCalculationWorkerWithDefaultLine({
      tx,
      calculation,
      employee,
      context,
      redniBroj: (lastLine?.redni_broj ?? 0) + 1
    });

    await tx.plateObracun.update({
      where: {
        id: calculation.id
      },
      data: {
        status: payrollStatuses.draft,
        calculated_at: null,
        calculated_by: null,
        updated_by: context.user.id
      }
    });

    return worker;
  });

  if (!created) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=radnik_nevalidan`);
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "add_payroll_worker",
    tipEntiteta: "PlateObracunRadnik",
    entitetId: created.calculationEmployee.id,
    novaVrijednost: {
      obracunId: calculation.id,
      radnikId: employee.id,
      stavkaId: created.line.id
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&radnik=${employee.id}&poruka=radnik_dodat_u_obracun`);
}

export async function removePayrollWorkerFromCalculation(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const employeeId = text(formData.get("radnik_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");

  if (!calculationId || !employeeId) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=radnik_nevalidan`);
  }

  const calculation = await getEditableCalculation(calculationId, context);

  if (!calculation) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  const worker = await prisma.plateObracunRadnik.findFirst({
    where: {
      obracun_id: calculation.id,
      radnik_id: employeeId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });

  if (!worker) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=radnik_nevalidan`);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const deletedLines = await tx.plateObracunStavka.deleteMany({
      where: {
        obracun_id: calculation.id,
        radnik_id: employeeId,
        agencija_id: context.agencijaId,
        firma_id: context.firma.id
      }
    });
    await tx.plateObracunRadnik.delete({
      where: {
        id: worker.id
      }
    });
    await tx.plateObracun.update({
      where: {
        id: calculation.id
      },
      data: {
        status: payrollStatuses.draft,
        calculated_at: null,
        calculated_by: null,
        updated_by: context.user.id
      }
    });

    return deletedLines.count;
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "remove_payroll_worker",
    tipEntiteta: "PlateObracunRadnik",
    entitetId: worker.id,
    staraVrijednost: worker,
    novaVrijednost: {
      obracunId: calculation.id,
      radnikId: employeeId,
      deletedLines: deleted
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=radnik_izbacen_iz_obracuna`);
}

export async function updatePayrollCalculationLine(formData: FormData) {
  const lineId = text(formData.get("stavka_id"));
  const calculationId = text(formData.get("obracun_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");
  const neto = parseMoneyToCents(formData.get("input_neto"));
  const bruto = parseMoneyToCents(formData.get("input_bruto"));
  const fiksniDio = parseMoneyToCents(formData.get("fiksni_dio"));
  const hours = numberValue(formData.get("ukupno_sati"));
  const calculationType = await effectiveCalculationType(text(formData.get("vrsta_obracuna_id")));

  if (!lineId || !calculationId || neto === null || bruto === null || fiksniDio === null || hours < 0) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=stavka_nevalidna`);
  }

  const calculation = await getEditableCalculation(calculationId, context);
  const incomeType = calculation
    ? await effectiveIncomeType(
        context.agencijaId,
        context.firma.id,
        text(formData.get("sifra_primanja_id")),
        calculation.kategorija
      )
    : null;

  if (!calculation || !incomeType || !calculationType) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  const line = await prisma.plateObracunStavka.findFirst({
    where: {
      id: lineId,
      obracun_id: calculation.id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });

  if (!line) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=stavka_nevalidna`);
  }

  const calculationWorker = await prisma.plateObracunRadnik.findFirst({
    where: {
      obracun_id: calculation.id,
      radnik_id: line.radnik_id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });
  const employee = await prisma.plateRadnik.findFirst({
    where: {
      id: line.radnik_id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });
  const seniorityYears = effectiveSeniorityYears({
    manualYears: calculationWorker?.minuli_rad_godina || employee?.minuli_rad_godina || 0,
    startDate: employee?.datum_pocetka,
    referenceDate: calculation.datum_do
  });
  const usesSeniority = formData.get("koristi_minuli_rad") === "on";
  const seniorityCoefficient = usesSeniority ? calculateSeniorityCoefficient(seniorityYears) : 0;

  await prisma.$transaction([
    prisma.plateObracunStavka.update({
      where: {
        id: line.id
      },
      data: {
        sifra_primanja_id: incomeType.id,
        ioppd_sifra_id: incomeType.ioppd_sifra_id,
        vrsta_obracuna_id: calculationType.id,
        sifra_primanja: incomeType.sifra,
        naziv_primanja: incomeType.naziv,
        ukupno_sati: hours,
        input_neto_cent: neto,
        input_bruto_cent: bruto,
        fiksni_dio_cent: fiksniDio,
        koeficijent_slozenosti: decimalValue(formData.get("koeficijent_slozenosti")) || null,
        koeficijent_minuli_rad: seniorityCoefficient,
        koristi_minuli_rad: usesSeniority,
        osnovica_cent: 0,
        iznos_za_obracun_cent: 0,
        neto_cent: 0,
        bruto_cent: 0,
        oporezivi_bruto_cent: 0,
        porez_cent: 0,
        prirez_cent: 0,
        zaposleni_pio_cent: 0,
        zaposleni_zdravstvo_cent: 0,
        zaposleni_nezaposleni_cent: 0,
        poslodavac_pio_cent: 0,
        poslodavac_zdravstvo_cent: 0,
        poslodavac_nezaposleni_cent: 0,
        fond_rada_cent: 0,
        sindikat_cent: 0,
        privredna_komora_cent: 0,
        doprinosi_zaposleni_cent: 0,
        doprinosi_poslodavac_cent: 0,
        ukupni_trosak_cent: 0,
        neto_za_isplatu_cent: 0,
        stopa_prireza: 0,
        detalji: Prisma.JsonNull,
        status: payrollStatuses.draft,
        updated_by: context.user.id
      }
    }),
    prisma.plateObracunRadnik.updateMany({
      where: {
        obracun_id: calculation.id,
        radnik_id: line.radnik_id,
        agencija_id: context.agencijaId,
        firma_id: context.firma.id
      },
      data: {
        ukupno_sati: hours,
        status: payrollStatuses.draft,
        updated_by: context.user.id
      }
    }),
    prisma.plateObracun.update({
      where: {
        id: calculation.id
      },
      data: {
        status: payrollStatuses.draft,
        calculated_at: null,
        calculated_by: null,
        updated_by: context.user.id
      }
    })
  ]);

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "update_payroll_line",
    tipEntiteta: "PlateObracunStavka",
    entitetId: line.id,
    novaVrijednost: {
      neto,
      bruto,
      hours
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&radnik=${line.radnik_id}&poruka=stavka_sacuvana`);
}

export async function addPayrollCalculationLine(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const workerId = text(formData.get("radnik_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");
  const neto = parseMoneyToCents(formData.get("input_neto"));
  const bruto = parseMoneyToCents(formData.get("input_bruto"));
  const fiksniDio = parseMoneyToCents(formData.get("fiksni_dio"));
  const calculationType = await effectiveCalculationType(text(formData.get("vrsta_obracuna_id")));

  if (!calculationId || !workerId || neto === null || bruto === null || fiksniDio === null) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=stavka_nevalidna`);
  }

  const calculation = await getEditableCalculation(calculationId, context);
  const incomeType = calculation
    ? await effectiveIncomeType(
        context.agencijaId,
        context.firma.id,
        text(formData.get("sifra_primanja_id")),
        calculation.kategorija
      )
    : null;
  const calculationWorker = await prisma.plateObracunRadnik.findFirst({
    where: {
      obracun_id: calculationId,
      radnik_id: workerId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });
  const employee = await prisma.plateRadnik.findFirst({
    where: {
      id: workerId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });

  if (!calculation || !calculationWorker || !employee || !incomeType || !calculationType) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  const lastLine = await prisma.plateObracunStavka.findFirst({
    where: {
      obracun_id: calculation.id
    },
    orderBy: {
      redni_broj: "desc"
    },
    select: {
      redni_broj: true
    }
  });
  const usesSeniority = formData.get("koristi_minuli_rad") === "on";
  const seniorityYears = effectiveSeniorityYears({
    manualYears: calculationWorker.minuli_rad_godina || employee.minuli_rad_godina,
    startDate: employee.datum_pocetka,
    referenceDate: calculation.datum_do
  });
  const seniorityCoefficient = usesSeniority ? calculateSeniorityCoefficient(seniorityYears) : 0;
  const line = await prisma.plateObracunStavka.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      obracun_id: calculation.id,
      radnik_id: workerId,
      obracun_radnik_id: calculationWorker.id,
      redni_broj: (lastLine?.redni_broj ?? 0) + 1,
      sifra_primanja_id: incomeType.id,
      ioppd_sifra_id: incomeType.ioppd_sifra_id,
      vrsta_obracuna_id: calculationType.id,
      sifra_primanja: incomeType.sifra,
      naziv_primanja: incomeType.naziv,
      datum_od: calculation.datum_od,
      datum_do: calculation.datum_do,
      fond_sati: calculation.fond_sati,
      ukupno_sati: numberValue(formData.get("ukupno_sati"), calculationWorker.ukupno_sati),
      input_neto_cent: neto,
      input_bruto_cent: bruto,
      fiksni_dio_cent: fiksniDio,
      koeficijent_slozenosti: decimalValue(formData.get("koeficijent_slozenosti")) || null,
      koeficijent_minuli_rad: seniorityCoefficient,
      koristi_minuli_rad: usesSeniority,
      status: payrollStatuses.draft,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await prisma.plateObracun.update({
    where: {
      id: calculation.id
    },
    data: {
      status: payrollStatuses.draft,
      calculated_at: null,
      calculated_by: null,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "add_payroll_line",
    tipEntiteta: "PlateObracunStavka",
    entitetId: line.id,
    novaVrijednost: {
      radnikId: workerId,
      neto,
      bruto
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&radnik=${workerId}&poruka=stavka_dodata`);
}

export async function calculatePayrollCalculation(formData: FormData) {
  const calculationId = text(formData.get("obracun_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");

  if (!calculationId) {
    redirect("/agencija/plate/obracun?poruka=obracun_obavezan");
  }

  const prepared = await preparePayrollLines(calculationId, context);
  const calculation = prepared?.calculation;

  if (!calculation) {
    redirect("/agencija/plate/obracun?poruka=obracun_zakljucan");
  }

  if (prepared.lineCount === 0) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=radnici_prazno`);
  }

  const lines = await prisma.plateObracunStavka.findMany({
    where: {
      obracun_id: calculation.id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    },
    orderBy: {
      redni_broj: "asc"
    }
  });
  const employees = await prisma.plateRadnik.findMany({
    where: {
      id: {
        in: lines.map((line) => line.radnik_id)
      },
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });
  const calculationWorkers = await prisma.plateObracunRadnik.findMany({
    where: {
      obracun_id: calculation.id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const calculationWorkersByEmployeeId = new Map(
    calculationWorkers.map((calculationWorker) => [calculationWorker.radnik_id, calculationWorker])
  );
  const blockingIssues = lines.flatMap((line) => {
    const employee = employeesById.get(line.radnik_id);

    if (!employee) {
      return [`Stavka ${line.redni_broj}: radnik nije pronađen.`];
    }

    return payrollBlockingIssuesForLine({
      employee,
      line,
      calculationDate: calculation.datum_do
    });
  });

  if (blockingIssues.length > 0) {
    redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=kontrole_greske`);
  }

  const createdLines = await prisma.$transaction(async (tx) => {
    let lineCount = 0;

    for (const existingLine of lines) {
      const incomeType = await effectiveIncomeType(
        context.agencijaId,
        context.firma.id,
        existingLine.sifra_primanja_id,
        calculation.kategorija
      );
      const calculationType = await effectiveCalculationType(existingLine.vrsta_obracuna_id);
      const employee = employeesById.get(existingLine.radnik_id);
      const calculationWorker = calculationWorkersByEmployeeId.get(existingLine.radnik_id);

      if (!incomeType || !calculationType || !employee) {
        continue;
      }

      const seniorityYears = effectiveSeniorityYears({
        manualYears: calculationWorker?.minuli_rad_godina || employee.minuli_rad_godina,
        startDate: employee.datum_pocetka,
        referenceDate: calculation.datum_do
      });
      const line = await calculatePayrollLine({
        calculationDate: calculation.datum_obracuna,
        incomeType,
        calculationType,
        netAmountCents: existingLine.input_neto_cent,
        grossAmountCents: existingLine.input_bruto_cent,
        fixedPartCents: existingLine.fiksni_dio_cent,
        complexityCoefficient: Number(existingLine.koeficijent_slozenosti ?? 0),
        usesSeniority: existingLine.koristi_minuli_rad,
        seniorityCoefficient: Number(existingLine.koeficijent_minuli_rad),
        seniorityYears,
        seniorityMonths: calculationWorker?.minuli_rad_mjeseci ?? employee.minuli_rad_mjeseci,
        seniorityDays: calculationWorker?.minuli_rad_dana ?? employee.minuli_rad_dana,
        workingHours: existingLine.ukupno_sati,
        workingHoursFund: existingLine.fond_sati,
        municipality: employee.poreska_opstina ?? employee.opstina
      });

      lineCount += 1;

      await tx.plateObracunStavka.update({
        where: {
          id: existingLine.id
        },
        data: {
          iznos_za_obracun_cent: line.amountForCalculationCents,
          osnovica_cent: line.baseAmountCents,
          neto_cent: line.netAmountCents,
          bruto_cent: line.grossAmountCents,
          oporezivi_bruto_cent: line.taxableGrossCents,
          porez_cent: line.personalIncomeTaxCents,
          prirez_cent: line.surtaxCents,
          zaposleni_pio_cent: line.employeePioCents,
          zaposleni_zdravstvo_cent: line.employeeHealthCents,
          zaposleni_nezaposleni_cent: line.employeeUnemploymentCents,
          poslodavac_pio_cent: line.employerPioCents,
          poslodavac_zdravstvo_cent: line.employerHealthCents,
          poslodavac_nezaposleni_cent: line.employerUnemploymentCents,
          fond_rada_cent: line.laborFundCents,
          sindikat_cent: line.unionCents,
          privredna_komora_cent: line.chamberCents,
          doprinosi_zaposleni_cent: line.totalEmployeeContributionsCents,
          doprinosi_poslodavac_cent: line.totalEmployerContributionsCents,
          ukupni_trosak_cent: line.totalCostCents,
          neto_za_isplatu_cent: line.netForPaymentCents,
          stopa_prireza: line.surtaxRate,
          koeficijent_minuli_rad: line.seniorityCoefficient,
          detalji: line.details as Prisma.InputJsonValue,
          status: payrollStatuses.calculated,
          updated_by: context.user.id
        }
      });
    }

    await tx.plateObracun.update({
      where: {
        id: calculation.id
      },
      data: {
        status: payrollStatuses.calculated,
        calculated_at: new Date(),
        calculated_by: context.user.id,
        updated_by: context.user.id
      }
    });

    return lineCount;
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "plate",
    akcija: "calculate_payroll",
    tipEntiteta: "PlateObracun",
    entitetId: calculation.id,
    novaVrijednost: {
      lines: createdLines
    }
  });

  revalidatePath("/agencija/plate/obracun");
  redirect(`/agencija/plate/obracun?obracun=${calculation.id}&poruka=obracun_obradjen`);
}
