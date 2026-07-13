"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import {
  calculatePayrollLine,
  parseMoneyToCents,
  payrollCategories,
  payrollStatuses
} from "@/lib/payroll";
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

async function effectiveIncomeType(agencijaId: string, firmaId: string, incomeTypeId?: string | null) {
  if (incomeTypeId) {
    return prisma.plateSifraPrimanja.findFirst({
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
  }

  const candidates = await prisma.plateSifraPrimanja.findMany({
    where: {
      sifra: "001",
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

export async function createPayrollCalculation(formData: FormData) {
  const context = await requirePlateManageContext("/agencija/plate/obracun");
  const month = numberValue(formData.get("mjesec"));
  const year = numberValue(formData.get("godina"), context.godina.godina);
  const datumOd = dateValue(formData.get("datum_od"));
  const datumDo = dateValue(formData.get("datum_do"));
  const datumObracuna = dateValue(formData.get("datum_obracuna"));
  const datumIsplate = dateValue(formData.get("datum_isplate"));
  const fondSati = numberValue(formData.get("fond_sati"), 176);

  if (month < 1 || month > 12 || !datumOd || !datumDo || !datumObracuna || fondSati <= 0) {
    redirect("/agencija/plate/obracun?poruka=obracun_nevalidan");
  }

  const last = await prisma.plateObracun.findFirst({
    where: {
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      kategorija: payrollCategories.regularWork
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
      kategorija: payrollCategories.regularWork,
      broj: (last?.broj ?? 0) + 1,
      oznaka: text(formData.get("oznaka")) || "Redovan rad",
      godina: year,
      mjesec: month,
      datum_od: datumOd,
      datum_do: datumDo,
      datum_obracuna: datumObracuna,
      datum_isplate: datumIsplate,
      fond_sati: fondSati,
      koristi_minuli_rad: formData.get("koristi_minuli_rad") === "on",
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
    where: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      aktivan: true,
      zaposlen: true,
      is_deleted: false
    },
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
      const incomeType = await effectiveIncomeType(
        context.agencijaId,
        context.firma.id,
        employee.podrazumijevana_sifra_id
      );
      const calculationType = await effectiveCalculationType(
        employee.podrazumijevana_vrsta_id ?? incomeType?.vrsta_obracuna_id
      );

      if (!incomeType || !calculationType) {
        continue;
      }

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
          minuli_rad_godina: employee.minuli_rad_godina,
          minuli_rad_mjeseci: employee.minuli_rad_mjeseci,
          minuli_rad_dana: employee.minuli_rad_dana,
          fond_sati: calculation.fond_sati,
          ukupno_sati: employeeHours,
          status: payrollStatuses.draft,
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });

      count += 1;

      await tx.plateObracunStavka.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: context.firma.id,
          obracun_id: calculation.id,
          radnik_id: employee.id,
          obracun_radnik_id: calculationEmployee.id,
          redni_broj: count,
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
          koeficijent_minuli_rad: employee.koeficijent_minuli_rad,
          koristi_minuli_rad: calculation.koristi_minuli_rad && employee.koristi_minuli_rad,
          status: payrollStatuses.draft,
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
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

export async function updatePayrollCalculationLine(formData: FormData) {
  const lineId = text(formData.get("stavka_id"));
  const calculationId = text(formData.get("obracun_id"));
  const context = await requirePlateManageContext("/agencija/plate/obracun");
  const neto = parseMoneyToCents(formData.get("input_neto"));
  const bruto = parseMoneyToCents(formData.get("input_bruto"));
  const fiksniDio = parseMoneyToCents(formData.get("fiksni_dio"));
  const hours = numberValue(formData.get("ukupno_sati"));
  const incomeType = await effectiveIncomeType(
    context.agencijaId,
    context.firma.id,
    text(formData.get("sifra_primanja_id"))
  );
  const calculationType = await effectiveCalculationType(text(formData.get("vrsta_obracuna_id")));

  if (!lineId || !calculationId || neto === null || bruto === null || fiksniDio === null || hours < 0) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=stavka_nevalidna`);
  }

  const calculation = await getEditableCalculation(calculationId, context);

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
        koeficijent_minuli_rad: decimalValue(formData.get("koeficijent_minuli_rad")),
        koristi_minuli_rad: formData.get("koristi_minuli_rad") === "on",
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
  const incomeType = await effectiveIncomeType(
    context.agencijaId,
    context.firma.id,
    text(formData.get("sifra_primanja_id"))
  );
  const calculationType = await effectiveCalculationType(text(formData.get("vrsta_obracuna_id")));

  if (!calculationId || !workerId || neto === null || bruto === null || fiksniDio === null) {
    redirect(`/agencija/plate/obracun?obracun=${calculationId}&poruka=stavka_nevalidna`);
  }

  const calculation = await getEditableCalculation(calculationId, context);
  const calculationWorker = await prisma.plateObracunRadnik.findFirst({
    where: {
      obracun_id: calculationId,
      radnik_id: workerId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id
    }
  });

  if (!calculation || !calculationWorker || !incomeType || !calculationType) {
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
      koeficijent_minuli_rad: decimalValue(formData.get("koeficijent_minuli_rad")),
      koristi_minuli_rad: formData.get("koristi_minuli_rad") === "on",
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
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const createdLines = await prisma.$transaction(async (tx) => {
    let lineCount = 0;

    for (const existingLine of lines) {
      const incomeType = await effectiveIncomeType(context.agencijaId, context.firma.id, existingLine.sifra_primanja_id);
      const calculationType = await effectiveCalculationType(existingLine.vrsta_obracuna_id);
      const employee = employeesById.get(existingLine.radnik_id);

      if (!incomeType || !calculationType || !employee) {
        continue;
      }

      const line = await calculatePayrollLine({
        calculationDate: calculation.datum_obracuna,
        incomeType,
        calculationType,
        netAmountCents: existingLine.input_neto_cent,
        grossAmountCents: existingLine.input_bruto_cent,
        fixedPartCents: existingLine.fiksni_dio_cent,
        complexityCoefficient: Number(existingLine.koeficijent_slozenosti ?? 0),
        usesSeniority: calculation.koristi_minuli_rad && existingLine.koristi_minuli_rad,
        seniorityCoefficient: Number(existingLine.koeficijent_minuli_rad),
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
