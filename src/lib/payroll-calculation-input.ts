import { Prisma } from "@prisma/client";
import { effectiveSeniorityYears } from "./payroll";
import { allowedPayrollPeriod, isPayrollPeriodAllowed } from "./payroll-hours";

export function employeeSnapshot(employee: {
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

export function payrollBlockingIssuesForLine({
  employee,
  line,
  calculationDate,
  calculationFrom,
  calculationTo,
  requiresEmployment
}: {
  employee: {
    ime: string;
    prezime: string;
    jmbg: string | null;
    opstina: string | null;
    poreska_opstina: string | null;
    datum_pocetka: Date | null;
    datum_prestanka: Date | null;
    minuli_rad_godina: number;
  };
  line: {
    datum_od: Date;
    datum_do: Date;
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
  calculationFrom: Date;
  calculationTo: Date;
  requiresEmployment: boolean;
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

  const allowedPeriod = allowedPayrollPeriod({
    calculationFrom,
    calculationTo,
    employmentFrom: requiresEmployment ? employee.datum_pocetka : null,
    employmentTo: requiresEmployment ? employee.datum_prestanka : null
  });

  if (
    !allowedPeriod ||
    !isPayrollPeriodAllowed({ from: line.datum_od, to: line.datum_do, allowed: allowedPeriod })
  ) {
    issues.push(
      `${employeeName}: period stavke mora biti unutar mjeseca obračuna i trajanja zaposlenja.`
    );
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
