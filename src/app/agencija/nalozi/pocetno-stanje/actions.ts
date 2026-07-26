"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import {
  accountClassFilter,
  buildOpeningBalanceLines,
  openingBalanceJournalType,
  openingBalanceSourceModule,
  openingBalanceSourceType,
  openingBalanceTotals
} from "@/lib/opening-balance";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function centsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}

function redirectOpeningBalance(message: string): never {
  redirect(`/agencija/nalozi/pocetno-stanje?poruka=${encodeURIComponent(message)}`);
}

const openingBalanceErrors = new Set([
  "godina_zakljucena",
  "kontekst",
  "nema_salda",
  "pocetno_postoji",
  "prethodna_godina",
  "prava",
  "saldo_nebalansiran",
  "vrsta_naloga"
]);

export async function generateOpeningBalance(formData: FormData) {
  const firmaId = value(formData, "firma_id");
  const poslovnaGodinaId = value(formData, "poslovna_godina_id");
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id || !firmaId || !poslovnaGodinaId) {
    redirectOpeningBalance("kontekst");
  }

  const allowed = await hasPermission(user, {
    firmaId,
    modul: "nalozi",
    akcija: "create"
  });

  if (!allowed) {
    redirectOpeningBalance("prava");
  }

  const accessFilter =
    user.rola === "admin_agencije"
      ? {}
      : {
          korisnici: {
            some: {
              korisnik_id: user.id,
              is_deleted: false
            }
          }
        };

  let result: {
    journal: {
      id: string;
      sifra: string | null;
      status: string;
    };
    sourceYear: number;
    targetYear: number;
    lineCount: number;
    totalCents: number;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      const targetYear = await tx.poslovnaGodina.findFirst({
        where: {
          id: poslovnaGodinaId,
          firma_id: firmaId,
          firma: {
            agencija_id: user.agencija_id!,
            is_deleted: false,
            aktivan: true,
            ...accessFilter
          }
        },
        select: {
          id: true,
          godina: true,
          datum_od: true,
          zakljucena: true,
          firma: {
            select: {
              id: true,
              agencija_id: true
            }
          }
        }
      });

      if (!targetYear) {
        throw new Error("kontekst");
      }

      if (targetYear.zakljucena) {
        throw new Error("godina_zakljucena");
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtext(${targetYear.firma.id}),
          hashtext(${targetYear.id})
        )`
      );

      const [sourceYear, journalType, existingJournal] = await Promise.all([
        tx.poslovnaGodina.findUnique({
          where: {
            firma_id_godina: {
              firma_id: firmaId,
              godina: targetYear.godina - 1
            }
          },
          select: {
            id: true,
            godina: true
          }
        }),
        tx.vrstaNaloga.findFirst({
          where: {
            sifra: openingBalanceJournalType,
            aktivan: true,
            OR: [
              {
                sistemska: true
              },
              {
                agencija_id: user.agencija_id!
              },
              {
                firma_id: firmaId
              }
            ]
          },
          select: {
            id: true,
            prefiks: true
          }
        }),
        tx.nalog.findFirst({
          where: {
            firma_id: firmaId,
            poslovna_godina_id: targetYear.id,
            is_deleted: false,
            vrsta_naloga: {
              sifra: openingBalanceJournalType
            }
          },
          select: {
            id: true
          }
        })
      ]);

      if (!sourceYear) {
        throw new Error("prethodna_godina");
      }

      if (!journalType) {
        throw new Error("vrsta_naloga");
      }

      if (existingJournal) {
        throw new Error("pocetno_postoji");
      }

      const sourceLines = await tx.stavkaNaloga.findMany({
        where: {
          nalog: {
            firma_id: firmaId,
            poslovna_godina_id: sourceYear.id,
            status: journalStatuses.posted,
            is_deleted: false
          },
          firma_konto: {
            firma_id: firmaId
          },
          OR: accountClassFilter(["0", "1", "2", "3", "4"])
        },
        select: {
          duguje: true,
          potrazuje: true,
          komitent_id: true,
          komitent: {
            select: {
              naziv: true
            }
          },
          firma_konto: {
            select: {
              id: true,
              sifra: true,
              naziv: true
            }
          }
        }
      });
      const lines = buildOpeningBalanceLines(sourceLines);
      const totals = openingBalanceTotals(lines);

      if (lines.length === 0 || totals.debitCents === 0) {
        throw new Error("nema_salda");
      }

      if (totals.debitCents !== totals.creditCents) {
        throw new Error("saldo_nebalansiran");
      }

      const lastJournal = await tx.nalog.findFirst({
        where: {
          firma_id: firmaId,
          poslovna_godina_id: targetYear.id,
          vrsta_naloga_id: journalType.id
        },
        orderBy: {
          broj: "desc"
        },
        select: {
          broj: true
        }
      });
      const number = (lastJournal?.broj ?? 0) + 1;
      const journal = await tx.nalog.create({
        data: {
          agencija_id: targetYear.firma.agencija_id,
          firma_id: firmaId,
          poslovna_godina_id: targetYear.id,
          vrsta_naloga_id: journalType.id,
          broj: number,
          sifra: formatJournalCode(journalType.prefiks, targetYear.godina, number),
          datum: targetYear.datum_od,
          opis: `Početno stanje preneseno iz ${sourceYear.godina}. godine`,
          status: journalStatuses.draft,
          source_type: openingBalanceSourceType,
          source_module: openingBalanceSourceModule,
          kreirao_korisnik_id: user.id,
          created_by: user.id,
          updated_by: user.id,
          stavke: {
            create: lines.map((line, index) => ({
              konto_id: line.accountId,
              komitent_id: line.partnerId,
              duguje: centsToDecimal(line.debitCents),
              potrazuje: centsToDecimal(line.creditCents),
              opis: `Početno stanje ${line.accountCode}${
                line.partnerName ? ` - ${line.partnerName}` : ""
              }`,
              redni_broj: index + 1,
              created_by: user.id,
              updated_by: user.id
            }))
          }
        },
        select: {
          id: true,
          sifra: true,
          status: true
        }
      });

      return {
        journal,
        sourceYear: sourceYear.godina,
        targetYear: targetYear.godina,
        lineCount: lines.length,
        totalCents: totals.debitCents
      };
    });
  } catch (error) {
    const message =
      error instanceof Error && openingBalanceErrors.has(error.message)
        ? error.message
        : "greska";

    redirectOpeningBalance(message);
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId,
    modul: "agencija.nalozi",
    akcija: "generate_opening_balance",
    tipEntiteta: "Nalog",
    entitetId: result.journal.id,
    novaVrijednost: result
  });

  revalidatePath("/agencija/nalozi");
  revalidatePath("/agencija/nalozi/pocetno-stanje");
  revalidatePath("/agencija/nalozi/bruto-bilans");
  redirect(`/agencija/nalozi/${result.journal.id}?poruka=nalog_kreiran`);
}
