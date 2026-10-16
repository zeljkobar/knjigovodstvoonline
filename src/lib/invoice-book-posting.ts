import "server-only";
import type { Prisma } from "@prisma/client";
import { accountOverrideTypes, invoicePostingDocumentTypes, invoicePostingAccountSources, invoicePostingFields, importAccountPurposes, importPostingSchemeFields, invoicePostingDefaultScope } from "./account-plan";
import { invoiceExecutionUser, type InvoiceExecution } from "./invoice-execution";
import { normalizeFiscalInvoiceNumber } from "./invoice-number";
import { formatJournalCode, journalStatuses } from "./journals";
import { kifEntryKinds, pazarPaymentLabel, pazarPostingSchemeFields, pazarPostingSubtype } from "./kif-pazar";
import { hasPermission } from "./permissions";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";

function centsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}
function decimalToCents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}
async function resolveCompanyAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  const companyAccount = await tx.firmaKonto.findUnique({
    where: {
      firma_id_sifra: {
        firma_id: firmaId,
        sifra: accountCode
      }
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });

  if (companyAccount) {
    if (
      !companyAccount.aktivan ||
      companyAccount.override_type === accountOverrideTypes.deactivated ||
      (companyAccount.tip_konta !== "analiticko" || companyAccount.sifra.trim().length < 4)
    ) {
      return null;
    }

    return companyAccount;
  }

  const baseAccount = await tx.konto.findUnique({
    where: {
      sifra: accountCode
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true,
      aktivan: true
    }
  });

  if (!baseAccount?.aktivan || (baseAccount.tip_konta !== "analiticko" || baseAccount.sifra.trim().length < 4)) {
    return null;
  }

  return tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv: baseAccount.naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });
}

type PostingRule = {
  polje_sifra: string;
  polje_naziv: string;
  pdv_stopa_sifra: string | null;
  smjer: string;
  konto_izvor: string;
  sifra_konta: string | null;
};

type PostingLineInput = {
  kufEntryId?: string;
  accountCode: string;
  direction: "D" | "P";
  amountCents: number;
  partnerId: string;
  documentNumber: string;
  documentDate: Date;
  dueDate: Date | null;
  businessUnitId: string | null;
};

function amountForKufField(
  fieldCode: string,
  vatRateCode: string | null,
  entry: {
    total_gross: { toString(): string };
    tax_lines: Array<{
      vat_rate_code: string;
      tax_base: { toString(): string };
      deductible_vat_amount: { toString(): string };
      non_deductible_vat_amount: { toString(): string };
    }>;
  }
) {
  if (fieldCode === "UKUPAN_IZNOS") {
    return decimalToCents(entry.total_gross);
  }

  const taxLine = entry.tax_lines.find((line) => line.vat_rate_code === vatRateCode);

  if (!taxLine) {
    return 0;
  }

  if (fieldCode.startsWith("PDV_")) {
    return decimalToCents(taxLine.deductible_vat_amount);
  }

  return decimalToCents(taxLine.tax_base) + decimalToCents(taxLine.non_deductible_vat_amount);
}

function amountForKifField(
  fieldCode: string,
  vatRateCode: string | null,
  entry: {
    total_gross: { toString(): string };
    tax_lines: Array<{
      vat_rate_code: string;
      tax_base: { toString(): string };
      output_vat_amount: { toString(): string };
    }>;
  }
) {
  if (fieldCode === "UKUPAN_IZNOS") {
    return decimalToCents(entry.total_gross);
  }

  const taxLine = entry.tax_lines.find((line) => line.vat_rate_code === vatRateCode);

  if (!taxLine) {
    return 0;
  }

  if (fieldCode.startsWith("PDV_")) {
    return decimalToCents(taxLine.output_vat_amount);
  }

  return decimalToCents(taxLine.tax_base);
}

function postingLineTotals(lines: PostingLineInput[]) {
  return lines.reduce(
    (sum, line) => {
      if (line.direction === "D") {
        sum.debit += line.amountCents;
      } else {
        sum.credit += line.amountCents;
      }

      return sum;
    },
    {
      debit: 0,
      credit: 0
    }
  );
}

function postingLinesBalanced(lines: PostingLineInput[]) {
  const totals = postingLineTotals(lines);
  return totals.debit === totals.credit;
}

function postingDifferenceText(differenceCents: number) {
  const amount = centsToDecimal(Math.abs(differenceCents)).replace(".", ",");
  const side =
    differenceCents > 0
      ? "duguje je veće od potražuje"
      : "potražuje je veće od duguje";

  return `${amount} EUR (${side})`;
}

async function nextJournalNumber(
  tx: Prisma.TransactionClient,
  firmaId: string,
  yearId: string,
  journalTypeId: string
) {
  const lastJournal = await tx.nalog.findFirst({
    where: {
      firma_id: firmaId,
      poslovna_godina_id: yearId,
      vrsta_naloga_id: journalTypeId
    },
    orderBy: {
      broj: "desc"
    },
    select: {
      broj: true
    }
  });

  return (lastJournal?.broj ?? 0) + 1;
}

export async function postInvoiceBookInContext(
  input: { documentType: string; bookId: string; finalize?: boolean; entryIds?: string[]; beforeWrite?: () => Promise<void> },
  execution: InvoiceExecution
) {
  const user = await invoiceExecutionUser(execution);
  const workContext = { firmaId: execution.companyId, poslovnaGodinaId: execution.yearId };

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return { ok: false as const, reason: "knjizenje_kontekst" };
  }

  const documentType = input.documentType.toUpperCase();
  const bookId = input.bookId;


  if (
    !bookId ||
    (documentType !== invoicePostingDocumentTypes.kuf &&
      documentType !== invoicePostingDocumentTypes.kif)
  ) {
    return { ok: false as const, reason: "knjizenje_greska" };
  }

  const [firma, poslovnaGodina] = await Promise.all([
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
        id: true,
        pdv_obveznik: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true,
        zakljucena: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena) {
    return { ok: false as const, reason: "knjizenje_kontekst" };
  }

  if (!await hasPermission(user, { firmaId: firma.id, modul: documentType === "KIF" ? "izlazni_racuni" : "ulazni_racuni", akcija: "post" }) ||
      (input.finalize && !await hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "post" }))) {
    return { ok: false as const, reason: "prava" };
  }

  class PostingValidationError extends Error {
    constructor(readonly result: { ok: false; reason: string; detail?: string }) { super(result.reason); }
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${firma.id}::uuid FOR UPDATE`;
    await input.beforeWrite?.();
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${poslovnaGodina.id}::uuid FOR UPDATE`;
    const currentYear = await tx.poslovnaGodina.findFirst({ where: { id: poslovnaGodina.id, firma_id: firma.id, zakljucena: false } });
    if (!currentYear) throw new PostingValidationError({ ok: false, reason: "knjizenje_kontekst" });
    const outcome = await (async () => {
    const vatRates = await tx.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id!,
        aktivna: true
      },
      orderBy: [
        {
          procenat: "desc"
        },
        {
          redosljed: "asc"
        }
      ],
      select: {
        sifra: true,
        naziv: true,
        procenat: true
      }
    });

    if (vatRates.length === 0) {
      return { ok: false as const, reason: "knjizenje_pdv" };
    }

    const accountCache = new Map<string, Awaited<ReturnType<typeof resolveCompanyAccount>>>();
    const getAccount = async (accountCode: string) => {
      if (!accountCache.has(accountCode)) {
        accountCache.set(accountCode, await resolveCompanyAccount(tx, firma.id, accountCode));
      }

      return accountCache.get(accountCode) ?? null;
    };

    if (documentType === invoicePostingDocumentTypes.kuf) {
      const book = await tx.kufBook.findFirst({
        where: {
          id: bookId,
          agencija_id: user.agencija_id!,
          firma_id: firma.id,
          poslovna_godina_id: poslovnaGodina.id,
          status: "OPEN",
          is_deleted: false
        },
        select: {
          id: true,
          internal_kuf_number: true,
          kuf_date: true,
          racun_vrsta: {
            select: {
              id: true,
              naziv: true,
              dokument_tip: true,
              vrsta_naloga_id: true,
              kontiranjePravila: {
                where: {
                  aktivno: true
                },
                select: {
                  polje_sifra: true,
                  polje_naziv: true,
                  pdv_stopa_sifra: true,
                  smjer: true,
                  konto_izvor: true,
                  sifra_konta: true
                }
              }
            }
          },
          entries: {
            where: {
              is_deleted: false
            },
            orderBy: {
              redni_broj: "asc"
            },
            select: {
              id: true,
              internal_kuf_number: true,
              supplier_invoice_number: true,
              invoice_date: true,
              due_date: true,
              poslovna_jedinica_id: true,
              total_gross: true,
              is_import: true,
              goods_value: true,
              customs_duty_amount: true,
              customs_vat_amount: true,
              expense_account: {
                select: {
                  sifra: true
                }
              },
              posting_status: true,
              posting_mode: true,
              journal_id: true,
              dobavljac_id: true,
              dobavljac: {
                select: {
                  naziv: true
                }
              },
              tax_lines: {
                select: {
                  vat_rate_code: true,
                  tax_base: true,
                  deductible_vat_amount: true,
                  non_deductible_vat_amount: true
                }
              }
            }
          }
        }
      });

      if (!book) {
        return { ok: false as const, reason: "knjizenje_greska" };
      }
      const periods = await tx.$queryRaw<{status: string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${firma.id}::uuid AND datum_od<=${book.kuf_date}::date AND datum_do>=${book.kuf_date}::date FOR UPDATE`;
      if (periods.some(period => period.status === "LOCKED")) return { ok: false as const, reason: "knjizenje_period" };
      if (book.kuf_date < currentYear.datum_od || book.kuf_date > currentYear.datum_do) return { ok: false as const, reason: "knjizenje_kontekst" };

      const journalTypeId = book.racun_vrsta.vrsta_naloga_id;

      if (!journalTypeId) {
        return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
      }

      const unpostedEntries = book.entries.filter(
        (entry) =>
          entry.posting_mode === "KUF_RULES" &&
          (!input.entryIds || input.entryIds.includes(entry.id)) && entry.posting_status === "UNPOSTED" &&
          !entry.journal_id
      );

      if (unpostedEntries.length === 0) {
        return { ok: false as const, reason: "knjizenje_nema" };
      }

      const journalType = await tx.vrstaNaloga.findFirst({
        where: {
          id: journalTypeId,
          aktivan: true
        },
        select: {
          id: true,
          prefiks: true
        }
      });

      if (!journalType) {
        return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
      }

      const existingJournalId =
        book.entries.find(
          (entry) => entry.posting_mode === "KUF_RULES" && entry.journal_id
        )?.journal_id ??
        (
          await tx.nalog.findFirst({
            where: {
              firma_id: firma.id,
              poslovna_godina_id: poslovnaGodina.id,
              source_type: invoicePostingDocumentTypes.kuf,
              izvorni_dokument_id: book.id,
              is_deleted: false
            },
            select: {
              id: true
            }
          })
        )?.id ??
        null;

      if (existingJournalId) await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${existingJournalId}::uuid FOR UPDATE`;
      const existingJournal = existingJournalId
        ? await tx.nalog.findFirst({
            where: {
              id: existingJournalId,
              agencija_id: user.agencija_id!,
              firma_id: firma.id,
              poslovna_godina_id: poslovnaGodina.id,
              is_deleted: false
            },
            select: {
              id: true,
              sifra: true,
              status: true,
              datum: true,
              source_type: true,
              izvorni_dokument_id: true
            }
          })
        : null;

      if (existingJournalId && (!existingJournal ||
        (existingJournal.status !== journalStatuses.draft && existingJournal.status !== journalStatuses.posted) ||
        existingJournal.source_type !== invoicePostingDocumentTypes.kuf || existingJournal.izvorni_dokument_id !== book.id)) {
        return { ok: false as const, reason: "knjizenje_nalog_zakljucan" };
      }
      if (existingJournal?.status === journalStatuses.posted) {
        if (!await hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "post" })) {
          return { ok: false as const, reason: "prava" };
        }
        if (existingJournal.datum < currentYear.datum_od || existingJournal.datum > currentYear.datum_do) {
          return { ok: false as const, reason: "knjizenje_kontekst" };
        }
        const journalPeriods = await tx.$queryRaw<{status: string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${firma.id}::uuid AND datum_od<=${existingJournal.datum}::date AND datum_do>=${existingJournal.datum}::date FOR UPDATE`;
        if (journalPeriods.some(period => period.status === "LOCKED")) return { ok: false as const, reason: "knjizenje_period" };
        const totals = await tx.stavkaNaloga.aggregate({ where: { nalog_id: existingJournal.id }, _sum: { duguje: true, potrazuje: true } });
        if (decimalToCents(totals._sum.duguje ?? "0") !== decimalToCents(totals._sum.potrazuje ?? "0")) {
          return { ok: false as const, reason: "knjizenje_nije_balansiran" };
        }
      }

      if (input.finalize && existingJournal?.status === journalStatuses.draft) return { ok: false as const, reason: "knjizenje_rucni_nacrt" };
    const journal =
        existingJournal ??
        (await (async () => {
          const number = await nextJournalNumber(tx, firma.id, poslovnaGodina.id, journalType.id);
          const code = formatJournalCode(journalType.prefiks, poslovnaGodina.godina, number);

          return tx.nalog.create({
            data: {
              agencija_id: user.agencija_id,
              firma_id: firma.id,
              poslovna_godina_id: poslovnaGodina.id,
              vrsta_naloga_id: journalType.id,
              broj: number,
              sifra: code,
              datum: book.kuf_date,
              opis: `${book.internal_kuf_number} - ${book.racun_vrsta.naziv}`,
              status: journalStatuses.draft,
              source_type: invoicePostingDocumentTypes.kuf,
              source_module: "agencija.racuni.kuf",
              izvorni_dokument_id: book.id,
              kreirao_korisnik_id: user.id,
              created_by: user.id,
              updated_by: user.id
            },
            select: {
              id: true,
              sifra: true,
              status: true
            }
          });
        })());

      const fields = invoicePostingFields(book.racun_vrsta.dokument_tip, vatRates);
      const ruleByField = new Map<string, PostingRule>(
        book.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
      );
      const lines: PostingLineInput[] = [];
      const roundingCorrections: Array<{
        entryId: string;
        internalKufNumber: string;
        supplierInvoiceNumber: string;
        adjustmentCents: number;
      }> = [];

      const importDefaultAccounts = await tx.firmaPodrazumijevanoKonto.findMany({
        where: {
          firma_id: firma.id,
          dokument_tip: invoicePostingDocumentTypes.general,
          podvrsta: invoicePostingDefaultScope.subtype,
          pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
          namjena: {
            in: [
              importAccountPurposes.goods,
              importAccountPurposes.customsDutyCost,
              importAccountPurposes.customsVat,
              importAccountPurposes.supplier,
              importAccountPurposes.customsPayable
            ]
          }
        },
        select: {
          namjena: true,
          sifra_konta: true,
          smjer: true,
          komitent_id: true
        }
      });
      const importAccountByPurpose = new Map(
        importDefaultAccounts.map((item) => [item.namjena, item.sifra_konta])
      );
      const importDirectionByPurpose = new Map(
        importDefaultAccounts.map((item) => [item.namjena, item.smjer])
      );
      const importKomitentByPurpose = new Map(
        importDefaultAccounts.map((item) => [item.namjena, item.komitent_id])
      );
      const importDefaultDirectionByPurpose = new Map<string, "D" | "P">(
        importPostingSchemeFields.map(([purpose, , direction]) => [purpose, direction])
      );
      const importDirectionFor = (purpose: string): "D" | "P" => {
        const saved = importDirectionByPurpose.get(purpose);
        if (saved === "D" || saved === "P") {
          return saved;
        }

        return importDefaultDirectionByPurpose.get(purpose) ?? "D";
      };

      for (const entry of unpostedEntries) {
        if (entry.is_import) {
          const goodsCents = decimalToCents(entry.goods_value);
          const dutyCents = decimalToCents(entry.customs_duty_amount);
          const vatCents = decimalToCents(entry.customs_vat_amount);

          // Konto robe/troška: prednost ima konto izabran na unosu, pa onda šema uvoza.
          const goodsAccount =
            entry.expense_account?.sifra ??
            importAccountByPurpose.get(importAccountPurposes.goods) ??
            null;
          const customsDutyCostAccount =
            importAccountByPurpose.get(importAccountPurposes.customsDutyCost) ?? null;
          const customsVatAccount =
            importAccountByPurpose.get(importAccountPurposes.customsVat) ?? null;
          const supplierAccount =
            importAccountByPurpose.get(importAccountPurposes.supplier) ?? null;
          const customsPayableAccount =
            importAccountByPurpose.get(importAccountPurposes.customsPayable) ?? null;

          const customsPayableCents = dutyCents + vatCents;

          if (
            !goodsAccount ||
            !supplierAccount ||
            (dutyCents > 0 && !customsDutyCostAccount) ||
            (vatCents > 0 && !customsVatAccount) ||
            (customsPayableCents > 0 && !customsPayableAccount)
          ) {
            return { ok: false as const, reason: "knjizenje_sema" };
          }

          const documentNumber = normalizeFiscalInvoiceNumber(entry.supplier_invoice_number);
          const importPartnerFor = (purpose: string) =>
            importKomitentByPurpose.get(purpose) ?? entry.dobavljac_id;
          const pushImportLine = (
            accountCode: string,
            direction: "D" | "P",
            amountCents: number,
            partnerId: string
          ) => {
            if (amountCents === 0) {
              return;
            }

            lines.push({
              kufEntryId: entry.id,
              accountCode,
              direction,
              amountCents,
              partnerId,
              documentNumber,
              documentDate: entry.invoice_date,
              dueDate: entry.due_date,
              businessUnitId: entry.poslovna_jedinica_id
            });
          };

          // Smjer i partner svake stavke su podesivi u šemi za uvoz (podešavanja).
          pushImportLine(
            goodsAccount,
            importDirectionFor(importAccountPurposes.goods),
            goodsCents,
            importPartnerFor(importAccountPurposes.goods)
          );

          if (customsDutyCostAccount) {
            pushImportLine(
              customsDutyCostAccount,
              importDirectionFor(importAccountPurposes.customsDutyCost),
              dutyCents,
              importPartnerFor(importAccountPurposes.customsDutyCost)
            );
          }

          if (customsVatAccount) {
            pushImportLine(
              customsVatAccount,
              importDirectionFor(importAccountPurposes.customsVat),
              vatCents,
              importPartnerFor(importAccountPurposes.customsVat)
            );
          }

          pushImportLine(
            supplierAccount,
            importDirectionFor(importAccountPurposes.supplier),
            goodsCents,
            importPartnerFor(importAccountPurposes.supplier)
          );

          if (customsPayableAccount) {
            pushImportLine(
              customsPayableAccount,
              importDirectionFor(importAccountPurposes.customsPayable),
              customsPayableCents,
              importPartnerFor(importAccountPurposes.customsPayable)
            );
          }

          continue;
        }

        const entryLines: Array<PostingLineInput & { isExpenseLine: boolean }> = [];

        for (const field of fields) {
          const rule = ruleByField.get(field.code);
          const source = rule?.konto_izvor ?? field.accountSource;
          const accountCode =
            source === invoicePostingAccountSources.inputExpense
              ? entry.expense_account?.sifra
              : rule?.sifra_konta;
          const amountCents = amountForKufField(field.code, field.vatRateCode, entry);

          if (amountCents === 0) {
            continue;
          }

          if (!accountCode) {
            return { ok: false as const, reason: "knjizenje_sema" };
          }

          entryLines.push({
            kufEntryId: entry.id,
            accountCode,
            direction: (rule?.smjer ?? field.direction) as "D" | "P",
            amountCents,
            partnerId: entry.dobavljac_id,
            documentNumber: normalizeFiscalInvoiceNumber(entry.supplier_invoice_number),
            documentDate: entry.invoice_date,
            dueDate: entry.due_date,
            businessUnitId: entry.poslovna_jedinica_id,
            isExpenseLine: source === invoicePostingAccountSources.inputExpense
          });
        }

        const entryTotals = postingLineTotals(entryLines);
        const differenceCents = entryTotals.debit - entryTotals.credit;

        if (differenceCents !== 0) {
          const invoiceDescription =
            `${entry.internal_kuf_number} · ${entry.dobavljac.naziv} · ` +
            `račun dobavljača ${entry.supplier_invoice_number}`;

          if (Math.abs(differenceCents) > 1) {
            return {
              ok: false as const,
              reason: "knjizenje_razlika_racuna",
              detail:
                `${invoiceDescription} ima razliku ${postingDifferenceText(differenceCents)}. ` +
                "Provjerite ukupan iznos, poreske osnovice i PDV."
            };
          }

          const expenseLine = entryLines
            .filter((line) => line.isExpenseLine)
            .sort((left, right) => right.amountCents - left.amountCents)[0];

          if (!expenseLine) {
            return {
              ok: false as const,
              reason: "knjizenje_razlika_racuna",
              detail:
                `${invoiceDescription} ima centnu razliku, ali šema nema stavku troška ` +
                "na kojoj se korekcija može evidentirati."
            };
          }

          const adjustmentCents =
            expenseLine.direction === "D" ? -differenceCents : differenceCents;
          const correctedAmountCents = expenseLine.amountCents + adjustmentCents;

          if (correctedAmountCents <= 0) {
            return {
              ok: false as const,
              reason: "knjizenje_razlika_racuna",
              detail:
                `${invoiceDescription} ima centnu razliku koju nije moguće primijeniti ` +
                "na stavku troška. Provjerite šemu knjiženja."
            };
          }

          expenseLine.amountCents = correctedAmountCents;
          roundingCorrections.push({
            entryId: entry.id,
            internalKufNumber: entry.internal_kuf_number,
            supplierInvoiceNumber: entry.supplier_invoice_number,
            adjustmentCents
          });
        }

        if (!postingLinesBalanced(entryLines)) {
          return {
            ok: false as const,
            reason: "knjizenje_razlika_racuna",
            detail:
              `${entry.internal_kuf_number} · ${entry.dobavljac.naziv} · ` +
              `račun dobavljača ${entry.supplier_invoice_number} nije izbalansiran nakon ` +
              "kontrole centne razlike."
          };
        }

        lines.push(...entryLines);
      }

      if (lines.length === 0) {
        return { ok: false as const, reason: "knjizenje_nema" };
      }

      if (!postingLinesBalanced(lines)) {
        const totals = postingLineTotals(lines);
        return {
          ok: false as const,
          reason: "knjizenje_nije_balansiran",
          detail:
            `Ukupna razlika naloga je ` +
            `${postingDifferenceText(totals.debit - totals.credit)}.`
        };
      }

      const lastLine = await tx.stavkaNaloga.findFirst({
        where: {
          nalog_id: journal.id
        },
        orderBy: {
          redni_broj: "desc"
        },
        select: {
          redni_broj: true
        }
      });
      let nextLineNumber = (lastLine?.redni_broj ?? 0) + 1;

      for (const line of lines) {
        const account = await getAccount(line.accountCode);

        if (!account) {
          return { ok: false as const, reason: "knjizenje_konto" };
        }

        if (input.finalize || existingJournal?.status === journalStatuses.posted) {
          const dimensions = await tx.firmaKonto.findUniqueOrThrow({ where: { id: account.id }, select: { koristi_radnu_jedinicu: true } });
          if (!line.partnerId || !await tx.komitent.findFirst({ where: {
            id: line.partnerId, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: user.agencija_id }, { scope: "COMPANY", firma_id: firma.id, agencija_id: user.agencija_id }]
          } })) return { ok: false as const, reason: "knjizenje_konto" };
          if ((dimensions.koristi_radnu_jedinicu && !line.businessUnitId) || (line.businessUnitId && !await tx.poslovnaJedinica.findFirst({ where: {
            id: line.businessUnitId, firma_id: firma.id, agencija_id: user.agencija_id!, aktivna: true, is_deleted: false
          } }))) return { ok: false as const, reason: "knjizenje_konto" };
        }

        await tx.stavkaNaloga.create({
          data: {
            nalog_id: journal.id,
            kuf_entry_id: line.kufEntryId,
            konto_id: account.id,
            komitent_id: line.partnerId,
            poslovna_jedinica_id: line.businessUnitId,
            duguje: line.direction === "D" ? centsToDecimal(line.amountCents) : "0.00",
            potrazuje: line.direction === "P" ? centsToDecimal(line.amountCents) : "0.00",
            opis: "racun",
            broj_dokumenta: line.documentNumber,
            datum_dokumenta: line.documentDate,
            datum_valute: line.dueDate,
            redni_broj: nextLineNumber,
            created_by: user.id,
            updated_by: user.id
          }
        });
        nextLineNumber += 1;
      }

      await tx.kufEntry.updateMany({
        where: {
          id: {
            in: unpostedEntries.map((entry) => entry.id)
          }
        },
        data: {
          posting_status: "POSTED",
          journal_id: journal.id,
          updated_by: user.id
        }
      });

      await tx.nalog.update({
        where: {
          id: journal.id
        },
        data: {
          updated_by: user.id,
          ...(input.finalize && !existingJournal ? { status: journalStatuses.posted, datum_knjizenja: new Date(), proknjizen_at: new Date(), proknjizen_by: user.id } : {})
        }
      });

      return {
        ok: true as const,
        created: !existingJournal,
        journalId: journal.id,
        journalCode: journal.sifra ?? "NALOG",
        journalStatus: input.finalize ? journalStatuses.posted : journal.status,
        appendedEntryIds: unpostedEntries.map(entry => entry.id),
        roundingCorrections
      };
    }

    const book = await tx.kifBook.findFirst({
      where: {
        id: bookId,
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        status: "OPEN",
        is_deleted: false
      },
      select: {
        id: true,
        internal_kif_number: true,
        kif_date: true,
        racun_vrsta: {
          select: {
            id: true,
            naziv: true,
            dokument_tip: true,
            vrsta_naloga_id: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              select: {
                polje_sifra: true,
                polje_naziv: true,
                pdv_stopa_sifra: true,
                smjer: true,
                konto_izvor: true,
                sifra_konta: true
              }
            }
          }
        },
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            id: true,
            internal_kif_number: true,
            customer_invoice_number: true,
            entry_kind: true,
            invoice_date: true,
            due_date: true,
            poslovna_jedinica_id: true,
            total_gross: true,
            revenue_account: {
              select: {
                sifra: true
              }
            },
            posting_status: true,
            posting_mode: true,
            journal_id: true,
            kupac_id: true,
            kupac: {
              select: {
                naziv: true
              }
            },
            tax_lines: {
              select: {
                vat_rate_code: true,
                tax_base: true,
                output_vat_amount: true
              }
            },
            pazar_payments: {
              select: {
                payment_method: true,
                amount: true
              }
            }
          }
        }
      }
    });

    if (!book) {
      return { ok: false as const, reason: "knjizenje_greska" };
    }
    const periods = await tx.$queryRaw<{status: string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${firma.id}::uuid AND datum_od<=${book.kif_date}::date AND datum_do>=${book.kif_date}::date FOR UPDATE`;
    if (periods.some(period => period.status === "LOCKED")) return { ok: false as const, reason: "knjizenje_period" };
    if (book.kif_date < currentYear.datum_od || book.kif_date > currentYear.datum_do) return { ok: false as const, reason: "knjizenje_kontekst" };

    const journalTypeId = book.racun_vrsta.vrsta_naloga_id;

    if (!journalTypeId) {
      return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
    }

    const unpostedEntries = book.entries.filter(
      (entry) => entry.posting_mode === "KIF_RULES" && (!input.entryIds || input.entryIds.includes(entry.id)) && entry.posting_status === "UNPOSTED" && !entry.journal_id
    );

    if (unpostedEntries.length === 0) {
      return { ok: false as const, reason: "knjizenje_nema" };
    }

    const journalType = await tx.vrstaNaloga.findFirst({
      where: {
        id: journalTypeId,
        aktivan: true
      },
      select: {
        id: true,
        prefiks: true
      }
    });

    if (!journalType) {
      return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
    }

    // Pojedinačno knjižene fiskalne fakture imaju sopstvene naloge i njihovi
    // KIF redovi nose journal_id. Ti nalozi nisu nalog KIF knjige i ne smiju se
    // dopunjavati ručno unesenim računima ili zbirnim pazarom.
    const existingJournalId =
      (
        await tx.nalog.findFirst({
          where: {
            firma_id: firma.id,
            poslovna_godina_id: poslovnaGodina.id,
            source_type: invoicePostingDocumentTypes.kif,
            izvorni_dokument_id: book.id,
            is_deleted: false
          },
          select: {
            id: true
          }
        })
      )?.id ?? null;

    if (existingJournalId) await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${existingJournalId}::uuid FOR UPDATE`;
    const existingJournal = existingJournalId
      ? await tx.nalog.findFirst({
          where: {
            id: existingJournalId,
            agencija_id: user.agencija_id!,
            firma_id: firma.id,
            poslovna_godina_id: poslovnaGodina.id,
            is_deleted: false
          },
          select: {
            id: true,
            sifra: true,
            status: true,
            datum: true,
            source_type: true,
            izvorni_dokument_id: true
          }
        })
      : null;

    if (existingJournalId && (!existingJournal ||
      (existingJournal.status !== journalStatuses.draft && existingJournal.status !== journalStatuses.posted) ||
      existingJournal.source_type !== invoicePostingDocumentTypes.kif || existingJournal.izvorni_dokument_id !== book.id)) {
      return { ok: false as const, reason: "knjizenje_nalog_zakljucan" };
    }
    if (existingJournal?.status === journalStatuses.posted) {
      if (!await hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "post" })) {
        return { ok: false as const, reason: "prava" };
      }
      if (existingJournal.datum < currentYear.datum_od || existingJournal.datum > currentYear.datum_do) {
        return { ok: false as const, reason: "knjizenje_kontekst" };
      }
      const journalPeriods = await tx.$queryRaw<{status: string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${firma.id}::uuid AND datum_od<=${existingJournal.datum}::date AND datum_do>=${existingJournal.datum}::date FOR UPDATE`;
      if (journalPeriods.some(period => period.status === "LOCKED")) return { ok: false as const, reason: "knjizenje_period" };
      const totals = await tx.stavkaNaloga.aggregate({ where: { nalog_id: existingJournal.id }, _sum: { duguje: true, potrazuje: true } });
      if (decimalToCents(totals._sum.duguje ?? "0") !== decimalToCents(totals._sum.potrazuje ?? "0")) {
        return { ok: false as const, reason: "knjizenje_nije_balansiran" };
      }
    }

    if (input.finalize && existingJournal?.status === journalStatuses.draft) return { ok: false as const, reason: "knjizenje_rucni_nacrt" };
    const journal =
      existingJournal ??
      (await (async () => {
        const number = await nextJournalNumber(tx, firma.id, poslovnaGodina.id, journalType.id);
        const code = formatJournalCode(journalType.prefiks, poslovnaGodina.godina, number);

        return tx.nalog.create({
          data: {
            agencija_id: user.agencija_id,
            firma_id: firma.id,
            poslovna_godina_id: poslovnaGodina.id,
            vrsta_naloga_id: journalType.id,
            broj: number,
            sifra: code,
            datum: book.kif_date,
            opis: `${book.internal_kif_number} - ${book.racun_vrsta.naziv}`,
            status: journalStatuses.draft,
            source_type: invoicePostingDocumentTypes.kif,
            source_module: "agencija.racuni.kif",
            izvorni_dokument_id: book.id,
            kreirao_korisnik_id: user.id,
            created_by: user.id,
            updated_by: user.id
          },
          select: {
            id: true,
            sifra: true,
            status: true
          }
        });
      })());

    const fields = invoicePostingFields(book.racun_vrsta.dokument_tip, vatRates);
    const ruleByField = new Map<string, PostingRule>(
      book.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
    );
    const lines: PostingLineInput[] = [];
    const roundingCorrections: Array<{
      entryId: string;
      internalKifNumber: string;
      documentNumber: string;
      adjustmentCents: number;
    }> = [];
    const pazarAccountRows = await tx.firmaPodrazumijevanoKonto.findMany({
      where: {
        firma_id: firma.id,
        dokument_tip: invoicePostingDocumentTypes.kif,
        podvrsta: pazarPostingSubtype,
        pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
        namjena: {
          in: pazarPostingSchemeFields.map(([purpose]) => purpose)
        }
      },
      select: {
        namjena: true,
        sifra_konta: true
      }
    });
    const pazarAccountByMethod = new Map<string, string | null>(
      pazarPostingSchemeFields.map(([purpose, , method]) => [
        method,
        pazarAccountRows.find((row) => row.namjena === purpose)?.sifra_konta ?? null
      ])
    );

    for (const entry of unpostedEntries) {
      const entryLines: Array<PostingLineInput & { isRevenueLine: boolean }> = [];
      const documentNumber =
        entry.entry_kind === kifEntryKinds.pazar
          ? entry.customer_invoice_number
          : normalizeFiscalInvoiceNumber(entry.customer_invoice_number);

      if (entry.entry_kind === kifEntryKinds.pazar) {
        for (const payment of entry.pazar_payments) {
          const amountCents = decimalToCents(payment.amount);

          if (amountCents === 0) {
            continue;
          }

          const accountCode = pazarAccountByMethod.get(payment.payment_method);
          if (!accountCode) {
            return {
              ok: false as const,
              reason: "knjizenje_pazar_sema",
              detail:
                `${entry.internal_kif_number} · ${entry.customer_invoice_number} koristi način ` +
                `naplate „${pazarPaymentLabel(payment.payment_method)}“. ` +
                "Podesite njegovo konto u Računi / Podešavanja."
            };
          }

          entryLines.push({
            accountCode,
            direction: "D",
            amountCents,
            partnerId: entry.kupac_id,
            documentNumber,
            documentDate: entry.invoice_date,
            dueDate: entry.due_date,
            businessUnitId: entry.poslovna_jedinica_id,
            isRevenueLine: false
          });
        }
      }

      for (const field of fields) {
        if (
          entry.entry_kind === kifEntryKinds.pazar &&
          field.code === "UKUPAN_IZNOS"
        ) {
          continue;
        }

        const rule = ruleByField.get(field.code);
        const source = rule?.konto_izvor ?? field.accountSource;
        const accountCode =
          source === invoicePostingAccountSources.inputExpense
            ? entry.revenue_account?.sifra
            : rule?.sifra_konta;
        const amountCents = amountForKifField(field.code, field.vatRateCode, entry);

        if (amountCents === 0) {
          continue;
        }

        if (!accountCode) {
          return { ok: false as const, reason: "knjizenje_sema" };
        }

        entryLines.push({
          accountCode,
          direction: (rule?.smjer ?? field.direction) as "D" | "P",
          amountCents,
          partnerId: entry.kupac_id,
          documentNumber,
          documentDate: entry.invoice_date,
          dueDate: entry.due_date,
          businessUnitId: entry.poslovna_jedinica_id,
          isRevenueLine:
            field.code.startsWith("OSNOVICA_") ||
            field.code.startsWith("OSLOBODJENO_")
        });
      }

      const entryTotals = postingLineTotals(entryLines);
      const differenceCents = entryTotals.debit - entryTotals.credit;

      if (differenceCents !== 0) {
        const description =
          `${entry.internal_kif_number} · ${entry.kupac.naziv} · ` +
          `${entry.customer_invoice_number}`;

        if (Math.abs(differenceCents) > 1) {
          return {
            ok: false as const,
            reason: "knjizenje_razlika_racuna",
            detail:
              `${description} ima razliku ${postingDifferenceText(differenceCents)}. ` +
              "Provjerite ukupan iznos, poreske osnovice, PDV i naplatu pazara."
          };
        }

        const revenueLine = entryLines
          .filter((line) => line.isRevenueLine)
          .sort((left, right) => right.amountCents - left.amountCents)[0];

        if (!revenueLine) {
          return {
            ok: false as const,
            reason: "knjizenje_razlika_racuna",
            detail:
              `${description} ima centnu razliku, ali nema stavku prihoda ` +
              "na kojoj se korekcija može evidentirati."
          };
        }

        const adjustmentCents =
          revenueLine.direction === "D" ? -differenceCents : differenceCents;
        const correctedAmountCents = revenueLine.amountCents + adjustmentCents;

        if (correctedAmountCents <= 0) {
          return {
            ok: false as const,
            reason: "knjizenje_razlika_racuna",
            detail:
              `${description} ima centnu razliku koju nije moguće primijeniti ` +
              "na stavku prihoda."
          };
        }

        revenueLine.amountCents = correctedAmountCents;
        roundingCorrections.push({
          entryId: entry.id,
          internalKifNumber: entry.internal_kif_number,
          documentNumber: entry.customer_invoice_number,
          adjustmentCents
        });
      }

      if (!postingLinesBalanced(entryLines)) {
        return {
          ok: false as const,
          reason: "knjizenje_razlika_racuna",
          detail:
            `${entry.internal_kif_number} · ${entry.customer_invoice_number} nije ` +
            "izbalansiran nakon kontrole centne razlike."
        };
      }

      lines.push(...entryLines);
    }

    if (lines.length === 0) {
      return { ok: false as const, reason: "knjizenje_nema" };
    }

    if (!postingLinesBalanced(lines)) {
      const totals = postingLineTotals(lines);
      return {
        ok: false as const,
        reason: "knjizenje_nije_balansiran",
        detail: `Ukupna razlika naloga je ${postingDifferenceText(
          totals.debit - totals.credit
        )}.`
      };
    }

    const lastLine = await tx.stavkaNaloga.findFirst({
      where: {
        nalog_id: journal.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    let nextLineNumber = (lastLine?.redni_broj ?? 0) + 1;

    for (const line of lines) {
      const account = await getAccount(line.accountCode);

      if (!account) {
        return { ok: false as const, reason: "knjizenje_konto" };
      }

      if (input.finalize || existingJournal?.status === journalStatuses.posted) {
        const dimensions = await tx.firmaKonto.findUniqueOrThrow({ where: { id: account.id }, select: { koristi_radnu_jedinicu: true } });
        if (!line.partnerId || !await tx.komitent.findFirst({ where: {
          id: line.partnerId, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: user.agencija_id }, { scope: "COMPANY", firma_id: firma.id, agencija_id: user.agencija_id }]
        } })) return { ok: false as const, reason: "knjizenje_konto" };
        if ((dimensions.koristi_radnu_jedinicu && !line.businessUnitId) || (line.businessUnitId && !await tx.poslovnaJedinica.findFirst({ where: {
          id: line.businessUnitId, firma_id: firma.id, agencija_id: user.agencija_id!, aktivna: true, is_deleted: false
        } }))) return { ok: false as const, reason: "knjizenje_konto" };
      }

      await tx.stavkaNaloga.create({
        data: {
          nalog_id: journal.id,
          konto_id: account.id,
          komitent_id: line.partnerId,
          poslovna_jedinica_id: line.businessUnitId,
          duguje: line.direction === "D" ? centsToDecimal(line.amountCents) : "0.00",
          potrazuje: line.direction === "P" ? centsToDecimal(line.amountCents) : "0.00",
          opis: "racun",
          broj_dokumenta: line.documentNumber,
          datum_dokumenta: line.documentDate,
          datum_valute: line.dueDate,
          redni_broj: nextLineNumber,
          created_by: user.id,
          updated_by: user.id
        }
      });
      nextLineNumber += 1;
    }

    await tx.kifEntry.updateMany({
      where: {
        id: {
          in: unpostedEntries.map((entry) => entry.id)
        }
      },
      data: {
        posting_status: "POSTED",
        journal_id: journal.id,
        updated_by: user.id
      }
    });

    const postedEntryIds = unpostedEntries.map((entry) => entry.id);
    await tx.posAccountingBatch.updateMany({
      where: {
        pos_kif_batch: {
          kif_entry_id: { in: postedEntryIds }
        }
      },
      data: {
        journal_id: journal.id,
        status: input.finalize || journal.status === journalStatuses.posted ? "POSTED" : "JOURNAL_DRAFT"
      }
    });
    await tx.posKifBatch.updateMany({
      where: { kif_entry_id: { in: postedEntryIds } },
      data: { status: "POSTED_TO_JOURNAL" }
    });

    await tx.nalog.update({
      where: {
        id: journal.id
      },
      data: {
        updated_by: user.id,
        ...(input.finalize && !existingJournal ? { status: journalStatuses.posted, datum_knjizenja: new Date(), proknjizen_at: new Date(), proknjizen_by: user.id } : {})
      }
    });

    return {
      ok: true as const,
      created: !existingJournal,
      journalId: journal.id,
      journalCode: journal.sifra ?? "NALOG",
      journalStatus: input.finalize ? journalStatuses.posted : journal.status,
      appendedEntryIds: unpostedEntries.map(entry => entry.id),
      roundingCorrections
    };
    })();
    if (!outcome.ok) throw new PostingValidationError(outcome);
    await auditLogInTransaction(tx, {
      korisnikId: user.id,
      agencijaId: user.agencija_id,
      firmaId: firma.id,
      modul: `agencija.racuni.${documentType.toLowerCase()}`,
      akcija: outcome.created ? "create_journal_from_book" : "append_journal_from_book",
      tipEntiteta: "Nalog",
      entitetId: outcome.journalId,
      novaVrijednost: {
        documentType,
        bookId,
        journalCode: outcome.journalCode,
        ...("journalStatus" in outcome ? { journalStatus: outcome.journalStatus, appendedEntryIds: outcome.appendedEntryIds } : {}),
        roundingCorrections:
          "roundingCorrections" in outcome ? outcome.roundingCorrections : []
      }
    });
    return outcome;
  }, { timeout: 120000, maxWait: 10000 }).catch((error: unknown) => {
    if (error instanceof PostingValidationError) return error.result;
    throw error;
  });

  return result;
}
