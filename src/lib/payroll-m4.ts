import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const m4StatusesForPrint = ["CALCULATED", "REVIEWED", "POSTED", "LOCKED"] as const;

export const m4Categories = {
  excluded: "NE_ULAZI",
  salary: "ZARADA_OSNOVICA",
  healthOrParental: "NAKNADA_ZDRAVSTVENO_RODITELJSKO",
  increasedService: "STAZ_SA_UVECANIM_TRAJANJEM"
} as const;

export const m4MonthNames = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
] as const;

type M4Calculation = Prisma.PlateObracunGetPayload<{
  include: {
    radnici: true;
    stavke: true;
  };
}>;

type M4Employee = Prisma.PlateRadnikGetPayload<Record<string, never>>;
type M4Payment = Prisma.PlateM4MjesecnaUplataGetPayload<Record<string, never>>;

export type M4MoneyColumns = {
  osnovicaCent: number;
  porezCent: number;
  zaposleniPioCent: number;
  zaposleniZdravstvoCent: number;
  zaposleniNezaposleniCent: number;
  poslodavacPioCent: number;
  poslodavacZdravstvoCent: number;
  poslodavacNezaposleniCent: number;
  fondRadaCent: number;
  invalidiCent: number;
};

export type M4MonthRow = M4MoneyColumns & {
  mjesec: number;
  naziv: string;
  ukupnoObracunatoCent: number;
  ukupnoUplacenoCent: number;
  m4BrutoCent: number;
  ostaloBrutoCent: number;
  uplataPotvrdjena: boolean;
  datumUplate: Date | null;
  referenca: string | null;
};

export type M4WorkerRow = {
  radnikId: string;
  imePrezime: string;
  jmbg: string;
  licniBrojOsiguranika: string;
  identifikator: string;
  periodOd: Date | null;
  periodDo: Date | null;
  stazMjeseci: number;
  stazDani: number;
  zaradaOsnovicaCent: number;
  zaradaPioUplacenoCent: number;
  naknadaOsnovicaCent: number;
  naknadaPioUplacenoCent: number;
  ukupnaM4OsnovicaCent: number;
  ukupnoPioUplacenoCent: number;
  oznakaStaza: string;
  blockers: string[];
  warnings: string[];
};

export type M4Report = {
  godina: number;
  months: M4MonthRow[];
  workers: M4WorkerRow[];
  totals: M4MonthRow;
  blockers: string[];
  warnings: string[];
};

function emptyMoneyColumns(): M4MoneyColumns {
  return {
    osnovicaCent: 0,
    porezCent: 0,
    zaposleniPioCent: 0,
    zaposleniZdravstvoCent: 0,
    zaposleniNezaposleniCent: 0,
    poslodavacPioCent: 0,
    poslodavacZdravstvoCent: 0,
    poslodavacNezaposleniCent: 0,
    fondRadaCent: 0,
    invalidiCent: 0
  };
}

function sumLiabilities(row: M4MoneyColumns) {
  return (
    row.porezCent +
    row.zaposleniPioCent +
    row.zaposleniZdravstvoCent +
    row.zaposleniNezaposleniCent +
    row.poslodavacPioCent +
    row.poslodavacZdravstvoCent +
    row.poslodavacNezaposleniCent +
    row.fondRadaCent +
    row.invalidiCent
  );
}

function addLine(target: M4MoneyColumns, line: M4Calculation["stavke"][number]) {
  target.osnovicaCent += line.bruto_cent || line.osnovica_cent;
  target.porezCent += line.porez_cent;
  target.zaposleniPioCent += line.zaposleni_pio_cent;
  target.zaposleniZdravstvoCent += line.zaposleni_zdravstvo_cent;
  target.zaposleniNezaposleniCent += line.zaposleni_nezaposleni_cent;
  target.poslodavacPioCent += line.poslodavac_pio_cent;
  target.poslodavacZdravstvoCent += line.poslodavac_zdravstvo_cent;
  target.poslodavacNezaposleniCent += line.poslodavac_nezaposleni_cent;
  target.fondRadaCent += line.fond_rada_cent;
}

function paymentColumns(payment: M4Payment | undefined): M4MoneyColumns {
  if (!payment?.potvrdjena) {
    return emptyMoneyColumns();
  }

  return {
    osnovicaCent: 0,
    porezCent: payment.porez_cent,
    zaposleniPioCent: payment.zaposleni_pio_cent,
    zaposleniZdravstvoCent: payment.zaposleni_zdravstvo_cent,
    zaposleniNezaposleniCent: payment.zaposleni_nezaposleni_cent,
    poslodavacPioCent: payment.poslodavac_pio_cent,
    poslodavacZdravstvoCent: payment.poslodavac_zdravstvo_cent,
    poslodavacNezaposleniCent: payment.poslodavac_nezaposleni_cent,
    fondRadaCent: payment.fond_rada_cent,
    invalidiCent: payment.invalidi_cent
  };
}

function jsonText(snapshot: Prisma.JsonValue, key: string) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return "";
  }

  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function startOfYear(godina: number) {
  return new Date(Date.UTC(godina, 0, 1));
}

function endOfYear(godina: number) {
  return new Date(Date.UTC(godina, 11, 31));
}

function clampPeriod(employee: M4Employee | undefined, godina: number, lineDates: Date[]) {
  const fallbackStart = lineDates.length ? new Date(Math.min(...lineDates.map((value) => value.getTime()))) : null;
  const fallbackEnd = lineDates.length ? new Date(Math.max(...lineDates.map((value) => value.getTime()))) : null;
  const rawStart = employee?.datum_pocetka ?? fallbackStart;
  const rawEnd = employee?.datum_prestanka ?? fallbackEnd ?? endOfYear(godina);

  if (!rawStart || !rawEnd) {
    return { od: null, do: null };
  }

  const od = new Date(Math.max(rawStart.getTime(), startOfYear(godina).getTime()));
  const doDate = new Date(Math.min(rawEnd.getTime(), endOfYear(godina).getTime()));

  return od.getTime() <= doDate.getTime() ? { od, do: doDate } : { od: null, do: null };
}

export function calculateM4Service(periodOd: Date | null, periodDo: Date | null) {
  if (!periodOd || !periodDo || periodOd.getTime() > periodDo.getTime()) {
    return { mjeseci: 0, dani: 0 };
  }

  let cursor = new Date(Date.UTC(periodOd.getUTCFullYear(), periodOd.getUTCMonth(), periodOd.getUTCDate()));
  const end = new Date(Date.UTC(periodDo.getUTCFullYear(), periodDo.getUTCMonth(), periodDo.getUTCDate()));
  let months = 0;

  while (cursor.getUTCDate() === 1) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));

    if (monthEnd.getTime() > end.getTime()) {
      break;
    }

    months += 1;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  let days = cursor.getTime() <= end.getTime() ? Math.floor((end.getTime() - cursor.getTime()) / 86_400_000) + 1 : 0;
  months += Math.floor(days / 30);
  days %= 30;

  return {
    mjeseci: Math.min(months, 12),
    dani: months >= 12 ? 0 : days
  };
}

export function formatM4Money(cents: number, dashForZero = true) {
  if (!cents && dashForZero) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export function formatM4Date(value: Date | null) {
  if (!value) {
    return "";
  }

  return `${String(value.getUTCDate()).padStart(2, "0")}.${String(value.getUTCMonth() + 1).padStart(2, "0")}.${value.getUTCFullYear()}`;
}

export function buildM4Report({
  godina,
  calculations,
  employees,
  categoriesByIncomeTypeId,
  payments
}: {
  godina: number;
  calculations: M4Calculation[];
  employees: M4Employee[];
  categoriesByIncomeTypeId: Map<string, string>;
  payments: M4Payment[];
}): M4Report {
  const calculationsByMonth = new Map<number, M4Calculation[]>();
  const paymentsByMonth = new Map(payments.map((payment) => [payment.mjesec, payment]));
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));

  for (const calculation of calculations) {
    calculationsByMonth.set(calculation.mjesec, [
      ...(calculationsByMonth.get(calculation.mjesec) ?? []),
      calculation
    ]);
  }

  const months: M4MonthRow[] = m4MonthNames.map((naziv, index) => {
    const mjesec = index + 1;
    const monthCalculations = calculationsByMonth.get(mjesec) ?? [];
    const calculated = emptyMoneyColumns();
    let m4BrutoCent = 0;

    for (const calculation of monthCalculations) {
      for (const line of calculation.stavke) {
        addLine(calculated, line);

        if ((categoriesByIncomeTypeId.get(line.sifra_primanja_id) ?? m4Categories.excluded) !== m4Categories.excluded) {
          m4BrutoCent += line.bruto_cent;
        }
      }
    }

    const payment = paymentsByMonth.get(mjesec);
    const paid = paymentColumns(payment);

    return {
      mjesec,
      naziv,
      ...calculated,
      ukupnoObracunatoCent: sumLiabilities(calculated),
      ukupnoUplacenoCent: sumLiabilities(paid),
      m4BrutoCent,
      ostaloBrutoCent: calculated.osnovicaCent - m4BrutoCent,
      uplataPotvrdjena: payment?.potvrdjena ?? false,
      datumUplate: payment?.datum_uplate ?? null,
      referenca: payment?.referenca ?? null
    };
  });

  const workerSnapshots = new Map<string, Prisma.JsonValue>();
  const linesByWorker = new Map<string, M4Calculation["stavke"]>();

  for (const calculation of calculations) {
    for (const worker of calculation.radnici) {
      if (!workerSnapshots.has(worker.radnik_id)) {
        workerSnapshots.set(worker.radnik_id, worker.snapshot);
      }
    }

    for (const line of calculation.stavke) {
      const category = categoriesByIncomeTypeId.get(line.sifra_primanja_id) ?? m4Categories.excluded;

      if (category !== m4Categories.excluded) {
        linesByWorker.set(line.radnik_id, [...(linesByWorker.get(line.radnik_id) ?? []), line]);
      }
    }
  }

  const workers = Array.from(linesByWorker.entries())
    .map(([radnikId, lines]) => {
      const employee = employeesById.get(radnikId);
      const snapshot = workerSnapshots.get(radnikId) ?? null;
      const prezime = employee?.prezime ?? jsonText(snapshot, "prezime");
      const ime = employee?.ime ?? jsonText(snapshot, "ime");
      const jmbg = (employee?.jmbg ?? jsonText(snapshot, "jmbg")).replace(/\D/g, "");
      const licniBroj = employee?.licni_broj_osiguranika ?? "";
      const period = clampPeriod(
        employee,
        godina,
        lines.flatMap((line) => [line.datum_od, line.datum_do])
      );
      const service = calculateM4Service(period.od, period.do);
      let zaradaOsnovicaCent = 0;
      let zaradaPioUplacenoCent = 0;
      let naknadaOsnovicaCent = 0;
      let naknadaPioUplacenoCent = 0;

      for (const line of lines) {
        const category = categoriesByIncomeTypeId.get(line.sifra_primanja_id) ?? m4Categories.excluded;
        const calculation = calculations.find((item) => item.id === line.obracun_id);
        const month = calculation?.mjesec ?? 0;
        const monthRow = months[month - 1];
        const payment = paymentsByMonth.get(month);
        const pioFullyPaid = Boolean(
          payment?.potvrdjena &&
            monthRow &&
            payment.zaposleni_pio_cent === monthRow.zaposleniPioCent &&
            payment.poslodavac_pio_cent === monthRow.poslodavacPioCent
        );
        const linePio = pioFullyPaid ? line.zaposleni_pio_cent + line.poslodavac_pio_cent : 0;

        if (category === m4Categories.healthOrParental) {
          naknadaOsnovicaCent += line.bruto_cent;
          naknadaPioUplacenoCent += linePio;
        } else {
          zaradaOsnovicaCent += line.bruto_cent;
          zaradaPioUplacenoCent += linePio;
        }
      }

      const blockers: string[] = [];
      const warnings: string[] = [];

      if (jmbg.length !== 13 && !licniBroj) {
        blockers.push("Nedostaje validan JMBG ili lični broj osiguranika.");
      }

      if (!period.od || !period.do) {
        blockers.push("Nedostaje validan period osiguranja u izabranoj godini.");
      }

      if (!employee?.datum_pocetka) {
        warnings.push("Period je izveden iz obračunskih stavki jer datum zaposlenja nije unesen.");
      }

      return {
        radnikId,
        imePrezime: `${prezime} ${ime}`.trim().toUpperCase(),
        jmbg,
        licniBrojOsiguranika: licniBroj,
        identifikator: jmbg.length === 13 ? jmbg : licniBroj,
        periodOd: period.od,
        periodDo: period.do,
        stazMjeseci: service.mjeseci,
        stazDani: service.dani,
        zaradaOsnovicaCent,
        zaradaPioUplacenoCent,
        naknadaOsnovicaCent,
        naknadaPioUplacenoCent,
        ukupnaM4OsnovicaCent: zaradaOsnovicaCent + naknadaOsnovicaCent,
        ukupnoPioUplacenoCent: zaradaPioUplacenoCent + naknadaPioUplacenoCent,
        oznakaStaza: (employee?.m4_oznaka_staza ?? "01").replace(/\D/g, "").slice(0, 2).padStart(2, "0"),
        blockers,
        warnings
      };
    })
    .sort((a, b) => a.imePrezime.localeCompare(b.imePrezime, "sr-Latn-ME"));

  const totals = months.reduce<M4MonthRow>(
    (total, month) => {
      total.osnovicaCent += month.osnovicaCent;
      total.porezCent += month.porezCent;
      total.zaposleniPioCent += month.zaposleniPioCent;
      total.zaposleniZdravstvoCent += month.zaposleniZdravstvoCent;
      total.zaposleniNezaposleniCent += month.zaposleniNezaposleniCent;
      total.poslodavacPioCent += month.poslodavacPioCent;
      total.poslodavacZdravstvoCent += month.poslodavacZdravstvoCent;
      total.poslodavacNezaposleniCent += month.poslodavacNezaposleniCent;
      total.fondRadaCent += month.fondRadaCent;
      total.invalidiCent += month.invalidiCent;
      total.ukupnoObracunatoCent += month.ukupnoObracunatoCent;
      total.ukupnoUplacenoCent += month.ukupnoUplacenoCent;
      total.m4BrutoCent += month.m4BrutoCent;
      total.ostaloBrutoCent += month.ostaloBrutoCent;
      return total;
    },
    {
      mjesec: 0,
      naziv: "UKUPNO",
      ...emptyMoneyColumns(),
      ukupnoObracunatoCent: 0,
      ukupnoUplacenoCent: 0,
      m4BrutoCent: 0,
      ostaloBrutoCent: 0,
      uplataPotvrdjena: false,
      datumUplate: null,
      referenca: null
    }
  );

  const blockers = workers.flatMap((worker) => worker.blockers.map((issue) => `${worker.imePrezime}: ${issue}`));
  const warnings = workers.flatMap((worker) => worker.warnings.map((issue) => `${worker.imePrezime}: ${issue}`));

  for (const month of months) {
    if (month.ukupnoObracunatoCent > 0 && !month.uplataPotvrdjena) {
      warnings.push(`${month.naziv}: uplata nije potvrđena; uplaćeni iznosi su prikazani kao 0,00.`);
    }
  }

  return {
    godina,
    months,
    workers,
    totals,
    blockers,
    warnings
  };
}

export async function getM4Data({
  agencijaId,
  firmaId,
  poslovnaGodinaId,
  godina
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  godina: number;
}) {
  const [calculations, employees, payments] = await Promise.all([
    prisma.plateObracun.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        godina,
        status: { in: [...m4StatusesForPrint] },
        is_deleted: false
      },
      include: {
        radnici: true,
        stavke: true
      },
      orderBy: [{ mjesec: "asc" }, { kategorija: "asc" }, { broj: "asc" }]
    }),
    prisma.plateRadnik.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.plateM4MjesecnaUplata.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId
      },
      orderBy: { mjesec: "asc" }
    })
  ]);

  const incomeTypeIds = Array.from(new Set(calculations.flatMap((calculation) => calculation.stavke.map((line) => line.sifra_primanja_id))));
  const incomeTypes = incomeTypeIds.length
    ? await prisma.plateSifraPrimanja.findMany({
        where: { id: { in: incomeTypeIds } },
        select: {
          id: true,
          osnova_obracuna: {
            select: { m4_kategorija: true }
          }
        }
      })
    : [];
  const categoriesByIncomeTypeId = new Map(
    incomeTypes.map((incomeType) => [
      incomeType.id,
      incomeType.osnova_obracuna?.m4_kategorija ?? m4Categories.excluded
    ])
  );

  return {
    payments,
    report: buildM4Report({
      godina,
      calculations,
      employees,
      categoriesByIncomeTypeId,
      payments
    })
  };
}
