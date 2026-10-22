import "server-only";
import type { Prisma } from "@prisma/client";
import { requireAnyRole } from "./auth";
import { requirePermissionForUser, hasPermission } from "./permissions";
import { journalStatuses } from "./journals";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";
import { decimalToScaled } from "./inventory-calculation";

export type PartnerSummaryParams = { datum_od?: string; datum_do?: string; konto?: string };
export type PartnerSummaryRow = {
  balance: number;
  credit: number;
  debit: number;
  kontoId: string;
  kontoNaziv: string;
  kontoSifra: string;
  partnerId: string;
  partnerName: string;
  partnerPib: string | null;
};


// Monetary values in rows and totals are integer cents.
export function partnerSummaryMoney(value: number) {
  return (value / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function dateFilter(value?: string) {
  if (!value) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
export function partnerSummaryQuery(params: PartnerSummaryParams = {}) {
  const query = new URLSearchParams();
  for (const key of ["konto", "datum_od", "datum_do"] as const) if (params[key]) query.set(key, params[key]!);
  return query.toString();
}
export async function loadPartnerSummary(params: PartnerSummaryParams = {}, print = false) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) return null;
  await requirePermissionForUser(user, { firmaId: workContext.firmaId, modul: "nalozi", akcija: "view" });
  if (print) await requirePermissionForUser(user, { firmaId: workContext.firmaId, modul: "nalozi", akcija: "export" });
  const selectedAccount = params.konto ?? "";
  const dateFrom = dateFilter(params.datum_od), dateTo = dateFilter(params.datum_do);
  const filterError = (params.datum_od && !dateFrom) || (params.datum_do && !dateTo) ||
    (dateFrom && dateTo && dateFrom > dateTo) ||
    (selectedAccount && selectedAccount !== "ALL" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedAccount))
    ? "Provjerite izabrani konto i period izvještaja." : null;
  const [firma, godina, accounts, lines] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true, naziv: true, pib: true, adresa: true, grad: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: workContext.firmaId,
        aktivan: true,
        tip_konta: "analiticko",
        analitika_obavezna: true,
        stavke_naloga: {
          some: {
            komitent_id: {
              not: null
            },
            nalog: {
              agencija_id: user.agencija_id,
              firma_id: workContext.firmaId,
              poslovna_godina_id: workContext.poslovnaGodinaId,
              status: journalStatuses.posted,
              is_deleted: false
            }
          }
        }
      },
      orderBy: {
        sifra: "asc"
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    }),
    filterError ? Promise.resolve([]) : prisma.stavkaNaloga.findMany({
      where: {
        komitent_id: {
          not: null
        },
        firma_konto: {
          firma_id: workContext.firmaId,
          analitika_obavezna: true
        },
        ...(selectedAccount && selectedAccount !== "ALL"
          ? {
              konto_id: selectedAccount
            }
          : {}),
        nalog: {
          agencija_id: user.agencija_id,
          firma_id: workContext.firmaId,
          poslovna_godina_id: workContext.poslovnaGodinaId,
          status: journalStatuses.posted,
          is_deleted: false,
          ...(dateFrom || dateTo
            ? {
                datum: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {})
                }
              }
            : {})
        }
      } satisfies Prisma.StavkaNalogaWhereInput,
      select: {
        duguje: true,
        potrazuje: true,
        firma_konto: {
          select: {
            id: true,
            sifra: true,
            naziv: true
          }
        },
        komitent: {
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        }
      }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const rows = Array.from(
    lines
      .reduce((map, line) => {
        const partner = line.komitent;

        if (!partner) {
          return map;
        }

        const key = `${line.firma_konto.id}:${partner.id}`;
        const existing = map.get(key) ?? {
          credit: 0,
          debit: 0,
          kontoId: line.firma_konto.id,
          kontoNaziv: line.firma_konto.naziv,
          kontoSifra: line.firma_konto.sifra,
          partnerId: partner.id,
          partnerName: partner.naziv,
          partnerPib: partner.pib
        };

        existing.debit += Number(decimalToScaled(line.duguje, 2));
        existing.credit += Number(decimalToScaled(line.potrazuje, 2));
        map.set(key, existing);

        return map;
      }, new Map<string, Omit<PartnerSummaryRow, "balance">>())
      .values()
  )
    .map((row) => ({
      ...row,
      balance: row.debit - row.credit
    }))
    .filter((row) => row.balance !== 0)
    .sort((first, second) => {
      if (first.kontoSifra !== second.kontoSifra) {
        return first.kontoSifra.localeCompare(second.kontoSifra);
      }

      return (
        Math.abs(second.balance) - Math.abs(first.balance) ||
        first.partnerName.localeCompare(second.partnerName)
      );
    });

  const totalDebitBalance = rows.reduce(
    (sum, row) => sum + (row.balance > 0 ? row.balance : 0),
    0
  );
  const totalCreditBalance = rows.reduce(
    (sum, row) => sum + (row.balance < 0 ? Math.abs(row.balance) : 0),
    0
  );

  const canPrint = await hasPermission(user, { firmaId: workContext.firmaId, modul: "nalozi", akcija: "export" });
  const account = accounts.find(row => row.id === selectedAccount);
  return { firma, godina, accounts, rows, totalDebitBalance, totalCreditBalance, canPrint, filterError, account,
    totalDebit: rows.reduce((sum, row) => sum + row.debit, 0),
    totalCredit: rows.reduce((sum, row) => sum + row.credit, 0) };
}
