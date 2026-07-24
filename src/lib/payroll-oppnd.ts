import type { Prisma } from "@prisma/client";
import { payrollCategories } from "./payroll";
import { ioppdStatusesForPrint } from "./payroll-ioppd";
import { prisma } from "./prisma";

type OppndCalculation = Prisma.PlateObracunGetPayload<{
  include: {
    stavke: true;
  };
}>;

export type OppndTaxRow = {
  redniBroj: number;
  naziv: string;
  porezCent: number;
  stopaPrireza: number | null;
  prirezCent: number;
  obracunatiPrirezCent: number;
};

export type OppndMonthData = {
  godina: number;
  mjesec: number;
  calculations: OppndCalculation[];
  rows: OppndTaxRow[];
  ukupnoPorezCent: number;
  ukupnoPrirezCent: number;
  ukupnoObracunatiPrirezCent: number;
};

const taxTypes = [
  {
    redniBroj: 1,
    naziv: "Porez na prihode od ličnih primanja",
    categories: [payrollCategories.regularWork]
  },
  {
    redniBroj: 2,
    naziv: "Porez na dohodak od samostalne djelatnosti",
    categories: [
      payrollCategories.serviceContract,
      payrollCategories.otherContracts
    ]
  },
  {
    redniBroj: 3,
    naziv: "Porez na prihode od imovine i imovinskih prava",
    categories: [payrollCategories.rent]
  },
  {
    redniBroj: 4,
    naziv: "Porez na prihode od kapitala",
    categories: []
  }
] as const;

export function buildOppndMonthData(
  godina: number,
  mjesec: number,
  calculations: OppndCalculation[],
  stopaPrireza: number | null
): OppndMonthData {
  const rows = taxTypes.map((taxType) => {
    const matchingCalculations = calculations.filter((calculation) =>
      taxType.categories.includes(calculation.kategorija as never)
    );
    const lines = matchingCalculations.flatMap((calculation) => calculation.stavke);
    const porezCent = lines.reduce((sum, line) => sum + line.porez_cent, 0);
    const obracunatiPrirezCent = lines.reduce(
      (sum, line) => sum + line.prirez_cent,
      0
    );

    return {
      redniBroj: taxType.redniBroj,
      naziv: taxType.naziv,
      porezCent,
      stopaPrireza,
      prirezCent:
        stopaPrireza === null
          ? 0
          : Math.round(porezCent * stopaPrireza),
      obracunatiPrirezCent
    };
  });

  return {
    godina,
    mjesec,
    calculations,
    rows,
    ukupnoPorezCent: rows.reduce((sum, row) => sum + row.porezCent, 0),
    ukupnoPrirezCent: rows.reduce((sum, row) => sum + row.prirezCent, 0),
    ukupnoObracunatiPrirezCent: rows.reduce(
      (sum, row) => sum + row.obracunatiPrirezCent,
      0
    )
  };
}

export async function getOppndCalculationsForMonth({
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
