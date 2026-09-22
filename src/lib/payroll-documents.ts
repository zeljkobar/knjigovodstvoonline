import { findMunicipalitySurtax } from "./municipalities";
import { payrollStatuses } from "./payroll";
import { prisma } from "./prisma";

export const payrollDocumentStatuses = [
  payrollStatuses.calculated,
  payrollStatuses.reviewed,
  payrollStatuses.posted,
  payrollStatuses.locked
] as const;

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function snapshotText(snapshot: JsonRecord, key: string, fallback: string | null | undefined) {
  const value = snapshot[key];
  return typeof value === "string" && value.trim() ? value : fallback ?? null;
}

function detailNumber(value: unknown, key: string) {
  const record = jsonRecord(value);
  const number = Number(record[key] ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function fullName(person: { ime: string; prezime: string }) {
  return `${person.prezime} ${person.ime}`.trim();
}

export async function getPayrollDocumentData({
  agencijaId,
  firmaId,
  poslovnaGodinaId,
  obracunId
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  obracunId: string;
}) {
  const [firma, obracun] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false
      },
      select: {
        id: true,
        naziv: true,
        pib: true,
        maticni_broj: true,
        adresa: true,
        opstina: true,
        grad: true,
        telefon: true,
        email: true,
        bankovni_racuni: {
          where: {
            aktivan: true,
            is_deleted: false
          },
          orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
          select: {
            id: true,
            naziv_banke: true,
            broj_racuna: true,
            glavni: true
          }
        },
        odgovorna_lica: {
          where: {
            aktivan: true,
            is_deleted: false,
            primarno: true
          },
          orderBy: { created_at: "asc" },
          take: 1,
          select: { ime_prezime: true }
        }
      }
    }),
    prisma.plateObracun.findFirst({
      where: {
        id: obracunId,
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        is_deleted: false
      },
      include: {
        radnici: {
          orderBy: { created_at: "asc" }
        },
        stavke: {
          orderBy: [{ radnik_id: "asc" }, { redni_broj: "asc" }, { created_at: "asc" }]
        }
      }
    })
  ]);

  if (!firma || !obracun) {
    return null;
  }

  const employeeIds = Array.from(
    new Set([
      ...obracun.radnici.map((row) => row.radnik_id),
      ...obracun.stavke.map((row) => row.radnik_id)
    ])
  );
  const employees = employeeIds.length
    ? await prisma.plateRadnik.findMany({
        where: {
          id: { in: employeeIds },
          agencija_id: agencijaId,
          firma_id: firmaId
        }
      })
    : [];
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));

  const workers = obracun.radnici.map((calculationWorker) => {
    const employee = employeesById.get(calculationWorker.radnik_id);
    const snapshot = jsonRecord(calculationWorker.snapshot);
    const workerLines = obracun.stavke.filter(
      (line) => line.radnik_id === calculationWorker.radnik_id
    );
    const identity = {
      id: calculationWorker.radnik_id,
      ime: snapshotText(snapshot, "ime", employee?.ime) ?? "",
      prezime: snapshotText(snapshot, "prezime", employee?.prezime) ?? "",
      jmbg: snapshotText(snapshot, "jmbg", employee?.jmbg),
      adresa: employee?.adresa ?? null,
      opstina: snapshotText(snapshot, "opstina", employee?.opstina),
      poreskaOpstina: snapshotText(snapshot, "poreskaOpstina", employee?.poreska_opstina),
      tekuciRacun: snapshotText(snapshot, "tekuciRacun", employee?.tekuci_racun),
      radnoMjesto: snapshotText(snapshot, "radnoMjesto", employee?.radno_mjesto),
      telefon: employee?.telefon ?? null,
      email: employee?.email ?? null,
      procenatRadnogVremena: Number(employee?.procenat_radnog_vremena ?? 100),
      isplataGotovina: employee?.isplata_gotovina ?? false
    };
    const totals = workerLines.reduce(
      (sum, line) => ({
        osnovicaCent: sum.osnovicaCent + line.osnovica_cent,
        iznosZaObracunCent: sum.iznosZaObracunCent + line.iznos_za_obracun_cent,
        netoCent: sum.netoCent + line.neto_cent,
        brutoCent: sum.brutoCent + line.bruto_cent,
        porezCent: sum.porezCent + line.porez_cent,
        prirezCent: sum.prirezCent + line.prirez_cent,
        zaposleniPioCent: sum.zaposleniPioCent + line.zaposleni_pio_cent,
        zaposleniZdravstvoCent:
          sum.zaposleniZdravstvoCent + line.zaposleni_zdravstvo_cent,
        zaposleniNezaposleniCent:
          sum.zaposleniNezaposleniCent + line.zaposleni_nezaposleni_cent,
        poslodavacPioCent: sum.poslodavacPioCent + line.poslodavac_pio_cent,
        poslodavacZdravstvoCent:
          sum.poslodavacZdravstvoCent + line.poslodavac_zdravstvo_cent,
        poslodavacNezaposleniCent:
          sum.poslodavacNezaposleniCent + line.poslodavac_nezaposleni_cent,
        fondRadaCent: sum.fondRadaCent + line.fond_rada_cent,
        sindikatCent: sum.sindikatCent + line.sindikat_cent,
        privrednaKomoraCent: sum.privrednaKomoraCent + line.privredna_komora_cent,
        doprinosiZaposleniCent:
          sum.doprinosiZaposleniCent + line.doprinosi_zaposleni_cent,
        doprinosiPoslodavacCent:
          sum.doprinosiPoslodavacCent + line.doprinosi_poslodavac_cent,
        ukupniTrosakCent: sum.ukupniTrosakCent + line.ukupni_trosak_cent,
        netoZaIsplatuCent: sum.netoZaIsplatuCent + line.neto_za_isplatu_cent,
        minuliRadCent:
          sum.minuliRadCent + detailNumber(line.detalji, "seniorityAmountCents")
      }),
      {
        osnovicaCent: 0,
        iznosZaObracunCent: 0,
        netoCent: 0,
        brutoCent: 0,
        porezCent: 0,
        prirezCent: 0,
        zaposleniPioCent: 0,
        zaposleniZdravstvoCent: 0,
        zaposleniNezaposleniCent: 0,
        poslodavacPioCent: 0,
        poslodavacZdravstvoCent: 0,
        poslodavacNezaposleniCent: 0,
        fondRadaCent: 0,
        sindikatCent: 0,
        privrednaKomoraCent: 0,
        doprinosiZaposleniCent: 0,
        doprinosiPoslodavacCent: 0,
        ukupniTrosakCent: 0,
        netoZaIsplatuCent: 0,
        minuliRadCent: 0
      }
    );

    return {
      calculationWorker,
      employee: identity,
      name: fullName(identity),
      lines: workerLines,
      totals
    };
  });

  const totals = workers.reduce(
    (sum, worker) => {
      for (const [key, value] of Object.entries(worker.totals)) {
        sum[key as keyof typeof sum] += value;
      }
      return sum;
    },
    {
      osnovicaCent: 0,
      iznosZaObracunCent: 0,
      netoCent: 0,
      brutoCent: 0,
      porezCent: 0,
      prirezCent: 0,
      zaposleniPioCent: 0,
      zaposleniZdravstvoCent: 0,
      zaposleniNezaposleniCent: 0,
      poslodavacPioCent: 0,
      poslodavacZdravstvoCent: 0,
      poslodavacNezaposleniCent: 0,
      fondRadaCent: 0,
      sindikatCent: 0,
      privrednaKomoraCent: 0,
      doprinosiZaposleniCent: 0,
      doprinosiPoslodavacCent: 0,
      ukupniTrosakCent: 0,
      netoZaIsplatuCent: 0,
      minuliRadCent: 0
    }
  );

  return {
    firma,
    obracun,
    workers,
    totals,
    isPreview: ![payrollStatuses.posted, payrollStatuses.locked].includes(
      obracun.status as never
    ),
    isPrintable: payrollDocumentStatuses.includes(obracun.status as never)
  };
}

export type PayrollDocumentData = NonNullable<
  Awaited<ReturnType<typeof getPayrollDocumentData>>
>;

export type PayrollPaymentOrder = {
  id: string;
  type: string;
  typeLabel: string;
  payerName: string;
  payerAccount: string | null;
  purpose: string;
  recipientName: string;
  recipientAccount: string | null;
  amountCent: number;
  paymentCode: string | null;
  debitReference: string | null;
  creditReference: string | null;
  paymentDate: Date | null;
  municipality: string | null;
  errors: string[];
};

const TAX_AND_CONTRIBUTIONS_ACCOUNT = "820-30000-74";

function paymentOrder({
  data,
  id,
  type,
  typeLabel,
  purpose,
  recipientName,
  recipientAccount,
  amountCent,
  paymentCode = null,
  creditReference = null,
  municipality = null,
  extraErrors = []
}: {
  data: PayrollDocumentData;
  id: string;
  type: string;
  typeLabel: string;
  purpose: string;
  recipientName: string;
  recipientAccount: string | null;
  amountCent: number;
  paymentCode?: string | null;
  creditReference?: string | null;
  municipality?: string | null;
  extraErrors?: string[];
}): PayrollPaymentOrder {
  const payerAccount = data.firma.bankovni_racuni[0]?.broj_racuna ?? null;
  const paymentDate = data.obracun.datum_isplate ?? data.obracun.datum_obracuna;
  const errors = [...extraErrors];

  if (!payerAccount) errors.push("Firma nema aktivan bankovni račun.");
  if (!recipientAccount) errors.push("Nedostaje račun primaoca.");

  return {
    id,
    type,
    typeLabel,
    payerName: data.firma.naziv,
    payerAccount,
    purpose,
    recipientName,
    recipientAccount,
    amountCent,
    paymentCode,
    debitReference: null,
    creditReference,
    paymentDate,
    municipality,
    errors
  };
}

export async function buildPayrollPaymentOrders(data: PayrollDocumentData) {
  const orders: PayrollPaymentOrder[] = [];
  const cashWorkers: string[] = [];
  const period = `${String(data.obracun.mjesec).padStart(2, "0")}/${data.obracun.godina}`;

  for (const worker of data.workers) {
    if (worker.totals.netoZaIsplatuCent <= 0) continue;

    if (worker.employee.isplataGotovina) {
      cashWorkers.push(worker.name);
      continue;
    }

    orders.push(
      paymentOrder({
        data,
        id: `neto-${worker.employee.id}`,
        type: "NET_SALARY",
        typeLabel: "Neto zarada",
        purpose: `Isplata zarade za ${period}`,
        recipientName: worker.name,
        recipientAccount: worker.employee.tekuciRacun,
        amountCent: worker.totals.netoZaIsplatuCent
      })
    );
  }

  const municipalityGroups = new Map<
    string,
    { municipality: string; surtaxCent: number }
  >();

  for (const worker of data.workers) {
    const municipality =
      worker.employee.poreskaOpstina ??
      worker.employee.opstina ??
      data.firma.opstina ??
      data.firma.grad ??
      "";
    const key = municipality.trim().toLocaleLowerCase("sr-Latn-ME");
    const current = municipalityGroups.get(key) ?? {
      municipality,
      surtaxCent: 0
    };
    current.surtaxCent += worker.totals.prirezCent;
    municipalityGroups.set(key, current);
  }

  for (const [key, group] of municipalityGroups) {
    if (group.surtaxCent <= 0) continue;
    const setting = await findMunicipalitySurtax(
      group.municipality,
      data.obracun.datum_isplate ?? data.obracun.datum_obracuna
    );
    const missingMunicipality = setting ? [] : ["Opština nije pronađena u šifarniku prireza."];

    orders.push(
      paymentOrder({
        data,
        id: `prirez-${key || "bez-opstine"}`,
        type: "SURTAX",
        typeLabel: "Prirez",
        purpose: `Prirez porezu na dohodak za ${period}`,
        recipientName: setting?.opstina
          ? `Opština ${setting.opstina}`
          : "Opština – prirez porezu na dohodak",
        recipientAccount: setting?.prirez_ziro_racun ?? null,
        amountCent: group.surtaxCent,
        paymentCode: setting?.prirez_sifra_placanja ?? null,
        creditReference: data.firma.pib,
        municipality: (setting?.opstina ?? group.municipality) || null,
        extraErrors: missingMunicipality
      })
    );
  }

  const taxAndContributionsCent =
    data.totals.porezCent +
    data.totals.zaposleniPioCent +
    data.totals.poslodavacPioCent +
    data.totals.zaposleniNezaposleniCent +
    data.totals.poslodavacNezaposleniCent +
    data.totals.fondRadaCent;

  if (taxAndContributionsCent > 0) {
    orders.push(
      paymentOrder({
        data,
        id: "tax-and-contributions",
        type: "TAX_AND_CONTRIBUTIONS",
        typeLabel: "Porez i doprinosi",
        purpose: `Porez i doprinosi na zarade za ${period}`,
        recipientName: "Jedinstveni račun poreza i doprinosa",
        recipientAccount: TAX_AND_CONTRIBUTIONS_ACCOUNT,
        amountCent: taxAndContributionsCent,
        creditReference: data.firma.pib
      })
    );
  }

  const otherOrders = [
    ["UNION", "Sindikat", data.totals.sindikatCent],
    ["CHAMBER", "Privredna komora", data.totals.privrednaKomoraCent]
  ] as const;

  for (const [type, label, amountCent] of otherOrders) {
    if (amountCent <= 0) continue;
    orders.push(
      paymentOrder({
        data,
        id: type.toLocaleLowerCase("en"),
        type,
        typeLabel: label,
        purpose: `${label} za ${period}`,
        recipientName: label,
        recipientAccount: null,
        amountCent,
        extraErrors: ["Račun za ovu vrstu obaveze još nije podešen u aplikaciji."]
      })
    );
  }

  return {
    orders,
    readyOrders: orders.filter((order) => order.errors.length === 0),
    invalidOrders: orders.filter((order) => order.errors.length > 0),
    cashWorkers
  };
}
