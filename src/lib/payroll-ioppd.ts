import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const ioppdStatusesForPrint = ["CALCULATED", "REVIEWED", "POSTED", "LOCKED"] as const;

type IoppdCalculation = Prisma.PlateObracunGetPayload<{
  include: {
    radnici: true;
    stavke: true;
  };
}>;

export type IoppdLine = {
  redniBroj: number;
  jmbg: string;
  imePrezime: string;
  sifra: string;
  nazivPrimanja: string;
  periodOd: Date;
  periodDo: Date;
  brutoCent: number;
  osnovicaCent: number;
  porezCent: number;
  zaposleniPioCent: number;
  zaposleniZdravstvoCent: number;
  zaposleniNezaposleniCent: number;
  poslodavacPioCent: number;
  poslodavacZdravstvoCent: number;
  poslodavacNezaposleniCent: number;
  fondRadaCent: number;
};

export type IoppdTotals = Omit<
  IoppdLine,
  "redniBroj" | "jmbg" | "imePrezime" | "sifra" | "nazivPrimanja" | "periodOd" | "periodDo" | "brutoCent"
>;

export type IoppdMonthData = {
  godina: number;
  mjesec: number;
  calculations: IoppdCalculation[];
  lines: IoppdLine[];
  totals: IoppdTotals;
  employeeCount: number;
  invalidEmployeeCount: number;
};

export type IoppdReportLine = IoppdLine;

function cloneLine(line: IoppdLine): IoppdReportLine {
  return {
    ...line
  };
}

function shouldSplitTaxToCode097(line: IoppdLine) {
  return line.sifra === "001" && line.porezCent > 0;
}

export function buildIoppdReportLines(data: IoppdMonthData): IoppdReportLine[] {
  const lines: IoppdReportLine[] = [];

  for (const line of data.lines) {
    if (!shouldSplitTaxToCode097(line)) {
      lines.push(cloneLine(line));
      continue;
    }

    lines.push({
      ...line,
      redniBroj: 0,
      porezCent: 0
    });

    if (line.porezCent > 0) {
      lines.push({
        ...line,
        redniBroj: 0,
        sifra: "097",
        nazivPrimanja: line.nazivPrimanja || "Porez na zarade",
        osnovicaCent: line.brutoCent,
        porezCent: line.porezCent,
        zaposleniPioCent: 0,
        zaposleniZdravstvoCent: 0,
        zaposleniNezaposleniCent: 0,
        poslodavacPioCent: 0,
        poslodavacZdravstvoCent: 0,
        poslodavacNezaposleniCent: 0,
        fondRadaCent: 0
      });
    }
  }

  return lines.map((line, index) => ({
    ...line,
    redniBroj: index + 1
  }));
}

export function totalIoppdReportLines(lines: IoppdReportLine[]): IoppdTotals {
  return lines.reduce((total, line) => {
    addTotals(total, line);

    return total;
  }, emptyIoppdTotals());
}

function workerName(snapshot: Prisma.JsonValue, fallbackId: string) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const data = snapshot as Record<string, unknown>;
    const ime = typeof data.ime === "string" ? data.ime : "";
    const prezime = typeof data.prezime === "string" ? data.prezime : "";
    const combined = `${prezime} ${ime}`.trim();

    if (combined) {
      return combined.toUpperCase();
    }
  }

  return fallbackId;
}

function workerJmbg(snapshot: Prisma.JsonValue) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const data = snapshot as Record<string, unknown>;

    return typeof data.jmbg === "string" ? data.jmbg : "";
  }

  return "";
}

function workerInvalid(snapshot: Prisma.JsonValue) {
  return Boolean(
    snapshot &&
      typeof snapshot === "object" &&
      !Array.isArray(snapshot) &&
      (snapshot as Record<string, unknown>).invalid
  );
}

function addTotals(total: IoppdTotals, line: Omit<IoppdLine, "redniBroj">) {
  total.osnovicaCent += line.osnovicaCent;
  total.porezCent += line.porezCent;
  total.zaposleniPioCent += line.zaposleniPioCent;
  total.zaposleniZdravstvoCent += line.zaposleniZdravstvoCent;
  total.zaposleniNezaposleniCent += line.zaposleniNezaposleniCent;
  total.poslodavacPioCent += line.poslodavacPioCent;
  total.poslodavacZdravstvoCent += line.poslodavacZdravstvoCent;
  total.poslodavacNezaposleniCent += line.poslodavacNezaposleniCent;
  total.fondRadaCent += line.fondRadaCent;
}

export function emptyIoppdTotals(): IoppdTotals {
  return {
    osnovicaCent: 0,
    porezCent: 0,
    zaposleniPioCent: 0,
    zaposleniZdravstvoCent: 0,
    zaposleniNezaposleniCent: 0,
    poslodavacPioCent: 0,
    poslodavacZdravstvoCent: 0,
    poslodavacNezaposleniCent: 0,
    fondRadaCent: 0
  };
}

export function buildIoppdMonthData(godina: number, mjesec: number, calculations: IoppdCalculation[]): IoppdMonthData {
  const workersById = new Map(
    calculations.flatMap((calculation) => calculation.radnici.map((worker) => [worker.radnik_id, worker]))
  );
  const totals = emptyIoppdTotals();
  const invalidWorkerIds = new Set<string>();

  const linesWithoutNumbers = calculations
    .flatMap((calculation) => calculation.stavke)
    .sort((a, b) => {
      const nameA = workerName(workersById.get(a.radnik_id)?.snapshot ?? null, a.radnik_id);
      const nameB = workerName(workersById.get(b.radnik_id)?.snapshot ?? null, b.radnik_id);

      return nameA.localeCompare(nameB, "sr-Latn-ME") || a.sifra_primanja.localeCompare(b.sifra_primanja);
    })
    .map((line) => {
      const worker = workersById.get(line.radnik_id);
      const row = {
        jmbg: workerJmbg(worker?.snapshot ?? null),
        imePrezime: workerName(worker?.snapshot ?? null, line.radnik_id),
        sifra: line.sifra_primanja,
        nazivPrimanja: line.naziv_primanja,
        periodOd: line.datum_od,
        periodDo: line.datum_do,
        brutoCent: line.bruto_cent,
        osnovicaCent: line.oporezivi_bruto_cent || line.bruto_cent || line.osnovica_cent,
        porezCent: line.porez_cent,
        zaposleniPioCent: line.zaposleni_pio_cent,
        zaposleniZdravstvoCent: line.zaposleni_zdravstvo_cent,
        zaposleniNezaposleniCent: line.zaposleni_nezaposleni_cent,
        poslodavacPioCent: line.poslodavac_pio_cent,
        poslodavacZdravstvoCent: line.poslodavac_zdravstvo_cent,
        poslodavacNezaposleniCent: line.poslodavac_nezaposleni_cent,
        fondRadaCent: line.fond_rada_cent
      };

      addTotals(totals, row);

      if (workerInvalid(worker?.snapshot ?? null)) {
        invalidWorkerIds.add(line.radnik_id);
      }

      return row;
    });

  return {
    godina,
    mjesec,
    calculations,
    lines: linesWithoutNumbers.map((line, index) => ({
      redniBroj: index + 1,
      ...line
    })),
    totals,
    employeeCount: new Set(calculations.flatMap((calculation) => calculation.radnici.map((worker) => worker.radnik_id))).size,
    invalidEmployeeCount: invalidWorkerIds.size
  };
}

export async function getIoppdCalculationsForMonth({
  agencijaId,
  firmaId,
  poslovnaGodinaId,
  godina,
  mjesec
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  godina: number;
  mjesec: number;
}) {
  return prisma.plateObracun.findMany({
    where: {
      agencija_id: agencijaId,
      firma_id: firmaId,
      poslovna_godina_id: poslovnaGodinaId,
      godina,
      mjesec,
      status: {
        in: [...ioppdStatusesForPrint]
      },
      is_deleted: false
    },
    orderBy: [
      {
        kategorija: "asc"
      },
      {
        broj: "asc"
      }
    ],
    include: {
      radnici: {
        orderBy: {
          created_at: "asc"
        }
      },
      stavke: {
        orderBy: [
          {
            redni_broj: "asc"
          },
          {
            created_at: "asc"
          }
        ]
      }
    }
  });
}
