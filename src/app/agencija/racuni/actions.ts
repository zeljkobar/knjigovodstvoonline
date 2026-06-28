"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import {
  accountOverrideTypes,
  invoicePostingDocumentTypes,
  invoicePostingAccountSources,
  invoicePostingFields,
  importAccountPurposes,
  invoicePostingDefaultScope,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeVatTransactionType, vatTransactionTypes } from "@/lib/vat-transaction";
import { readWorkContext } from "@/lib/work-context";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function parseDate(formData: FormData, key: string) {
  const data = value(formData, key);

  if (!data) {
    return null;
  }

  return new Date(`${data}T00:00:00.000Z`);
}

function parseFiscalDateTime(value: string) {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/ (\d{2}:\d{2})$/, "+$1");
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePib(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

function parseMoneyToCents(input: string) {
  const normalized = input.trim().replace(",", ".");

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

function centsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}

function decimalToCents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}

function percentToNumber(value: { toString(): string }) {
  const parsed = Number(value.toString());

  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercentInput(input: string) {
  const normalized = input.trim().replace(",", ".");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function invoicePermissionModule(documentType: string) {
  return documentType.toUpperCase() === invoicePostingDocumentTypes.kif
    ? "izlazni_racuni"
    : "ulazni_racuni";
}

async function requireInvoicePermission(
  user: Awaited<ReturnType<typeof requireAnyRole>>,
  firmaId: string,
  documentType: string,
  akcija: PermissionAction,
  redirectTo: (message: string) => never
) {
  const allowed = await hasPermission(user, {
    firmaId,
    modul: invoicePermissionModule(documentType),
    akcija
  });

  if (!allowed) {
    redirectTo("prava");
  }
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
      companyAccount.tip_konta !== "analiticko"
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

  if (!baseAccount?.aktivan || baseAccount.tip_konta !== "analiticko") {
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

async function saveSupplierKufDefaults(
  tx: Prisma.TransactionClient,
  firmaId: string,
  supplierId: string,
  accountCode: string,
  vatRateCode: string | null
) {
  await tx.firmaKomitent.upsert({
    where: {
      firma_id_komitent_id: {
        firma_id: firmaId,
        komitent_id: supplierId
      }
    },
    update: {
      default_kuf_konto_sifra: accountCode,
      default_kuf_pdv_stopa_sifra: vatRateCode,
      aktivan: true
    },
    create: {
      firma_id: firmaId,
      komitent_id: supplierId,
      tip_komitenta: "dobavljac",
      default_kuf_konto_sifra: accountCode,
      default_kuf_pdv_stopa_sifra: vatRateCode,
      aktivan: true
    }
  });
}

function redirectKuf(message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/kuf?${params.toString()}`);
}

function redirectKif(message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/kif?${params.toString()}`);
}

function redirectInvoiceSettings(message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/podesavanja?${params.toString()}`);
}

function redirectKufEntry(kufBookId: string, message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/kuf/${kufBookId}?${params.toString()}`);
}

function redirectKifEntry(kifBookId: string, message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/racuni/kif/${kifBookId}?${params.toString()}`);
}

function redirectInvoicePosting(returnTo: string, message: string, journalCode?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (journalCode) {
    params.set("nalog", journalCode);
  }

  redirect(`${returnTo}?${params.toString()}`);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

export async function createInvoiceBookType(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId) {
    redirectInvoiceSettings("vrsta_kontekst");
  }

  const documentType = value(formData, "dokument_tip").toUpperCase();
  const code = value(formData, "sifra").toUpperCase();
  const name = value(formData, "naziv");
  const description = nullableValue(formData, "opis");

  if (
    documentType !== invoicePostingDocumentTypes.kuf &&
    documentType !== invoicePostingDocumentTypes.kif
  ) {
    redirectInvoiceSettings("vrsta_tip");
  }

  if (!code || !name) {
    redirectInvoiceSettings("vrsta_obavezno");
  }

  const firma = await prisma.firma.findFirst({
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
                is_deleted: false,
                moze_da_mijenja: true
              }
            }
          })
    },
    select: {
      id: true
    }
  });

  if (!firma) {
    redirectInvoiceSettings("vrsta_greska");
  }

  await requireInvoicePermission(user, firma.id, documentType, "manage", redirectInvoiceSettings);

  const lastType = await prisma.racunVrsta.findFirst({
    where: {
      firma_id: firma.id,
      dokument_tip: documentType
    },
    orderBy: {
      redosljed: "desc"
    },
    select: {
      redosljed: true
    }
  });

  const invoiceType = await prisma.racunVrsta.create({
    data: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      dokument_tip: documentType,
      sifra: code,
      naziv: name,
      opis: description,
      redosljed: (lastType?.redosljed ?? 0) + 10,
      created_by: user.id,
      updated_by: user.id
    },
    select: {
      id: true,
      dokument_tip: true,
      sifra: true,
      naziv: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.podesavanja",
    akcija: "create_invoice_book_type",
    tipEntiteta: "RacunVrsta",
    entitetId: invoiceType.id,
    novaVrijednost: invoiceType
  });

  revalidatePath("/agencija/racuni/podesavanja");
  redirect(`/agencija/racuni/podesavanja?vrsta=${invoiceType.id}&poruka=vrsta_sacuvana`);
}

export async function saveInvoicePostingRules(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId) {
    redirectInvoiceSettings("sema_kontekst");
  }

  const typeId = value(formData, "racun_vrsta_id");
  const journalTypeId = value(formData, "vrsta_naloga_id");

  if (!typeId) {
    redirectInvoiceSettings("sema_vrsta");
  }

  if (!journalTypeId) {
    redirect(`/agencija/racuni/podesavanja?vrsta=${typeId}&poruka=sema_vrsta_naloga`);
  }

  const invoiceType = await prisma.racunVrsta.findFirst({
    where: {
      id: typeId,
      agencija_id: user.agencija_id,
      firma_id: workContext.firmaId,
      aktivna: true,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false,
                  moze_da_mijenja: true
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      dokument_tip: true,
      sifra: true,
      naziv: true
    }
  });

  if (!invoiceType) {
    redirectInvoiceSettings("sema_vrsta");
  }

  await requireInvoicePermission(
    user,
    invoiceType.firma_id,
    invoiceType.dokument_tip,
    "manage",
    redirectInvoiceSettings
  );

  const [baseAccounts, companyOverrides, activeVatRates, journalType] = await Promise.all([
    prisma.konto.findMany({
      where: {
        aktivan: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true,
        klasa: true,
        tip_konta: true,
        analitika_obavezna: true,
        sinteticki_konto: true,
        normalni_saldo: true,
        koristi_radnu_jedinicu: true,
        aktivan: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: invoiceType.firma_id
      },
      select: {
        id: true,
        konto_id: true,
        sifra: true,
        naziv: true,
        tip_konta: true,
        analitika_obavezna: true,
        sinteticki_konto: true,
        normalni_saldo: true,
        koristi_radnu_jedinicu: true,
        override_type: true,
        napomena: true,
        aktivan: true
      }
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
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
    }),
    prisma.vrstaNaloga.findFirst({
      where: {
        id: journalTypeId,
        aktivan: true,
        OR: [
          {
            sistemska: true
          },
          {
            agencija_id: user.agencija_id
          },
          {
            firma_id: invoiceType.firma_id
          }
        ]
      },
      select: {
        id: true
      }
    })
  ]);

  if (activeVatRates.length === 0) {
    redirectInvoiceSettings("sema_pdv");
  }

  if (!journalType) {
    redirect(`/agencija/racuni/podesavanja?vrsta=${typeId}&poruka=sema_vrsta_naloga`);
  }

  const activeAccountCodes = new Set(
    mergeCompanyAccountPlan(baseAccounts, companyOverrides)
      .filter((account) => account.aktivan)
      .map((account) => account.sifra)
  );
  const fields = invoicePostingFields(invoiceType.dokument_tip, activeVatRates);
  const rules = fields.map((field) => {
    const direction = value(formData, `smjer_${field.code}`) || field.direction;
    const source =
      value(formData, `konto_izvor_${field.code}`) || field.accountSource;
    const accountCode = value(formData, `sifra_konta_${field.code}`);

    if (direction !== "D" && direction !== "P") {
      redirect(`/agencija/racuni/podesavanja?vrsta=${typeId}&poruka=sema_smjer`);
    }

    if (
      source !== invoicePostingAccountSources.fixed &&
      source !== invoicePostingAccountSources.inputExpense
    ) {
      redirect(`/agencija/racuni/podesavanja?vrsta=${typeId}&poruka=sema_izvor`);
    }

    if (source === invoicePostingAccountSources.fixed && !activeAccountCodes.has(accountCode)) {
      redirect(`/agencija/racuni/podesavanja?vrsta=${typeId}&poruka=sema_konto`);
    }

    return {
      ...field,
      direction,
      accountSource: source,
      accountCode: source === invoicePostingAccountSources.fixed ? accountCode : null
    };
  });

  const savedRules = await prisma.$transaction(async (tx) => {
    await tx.racunVrsta.update({
      where: {
        id: invoiceType.id
      },
      data: {
        vrsta_naloga_id: journalType.id,
        updated_by: user.id
      }
    });

    return Promise.all(
      rules.map((rule) =>
        tx.racunKontiranjePravilo.upsert({
        where: {
          racun_vrsta_id_polje_sifra: {
            racun_vrsta_id: invoiceType.id,
            polje_sifra: rule.code
          }
        },
        create: {
          racun_vrsta_id: invoiceType.id,
          polje_sifra: rule.code,
          polje_naziv: rule.label,
          pdv_stopa_sifra: rule.vatRateCode,
          smjer: rule.direction,
          konto_izvor: rule.accountSource,
          sifra_konta: rule.accountCode,
          redosljed: rule.order,
          created_by: user.id,
          updated_by: user.id
        },
        update: {
          polje_naziv: rule.label,
          pdv_stopa_sifra: rule.vatRateCode,
          smjer: rule.direction,
          konto_izvor: rule.accountSource,
          sifra_konta: rule.accountCode,
          redosljed: rule.order,
          aktivno: true,
          updated_by: user.id
        },
        select: {
          id: true,
          polje_sifra: true,
          polje_naziv: true,
          smjer: true,
          konto_izvor: true,
          sifra_konta: true
        }
      })
      )
    );
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: invoiceType.firma_id,
    modul: "agencija.racuni.podesavanja",
    akcija: "save_invoice_posting_rules",
    tipEntiteta: "RacunVrsta",
    entitetId: invoiceType.id,
    novaVrijednost: savedRules
  });

  revalidatePath("/agencija/racuni/podesavanja");
  redirect(`/agencija/racuni/podesavanja?vrsta=${invoiceType.id}&poruka=sema_sacuvana`);
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
  accountCode: string;
  direction: "D" | "P";
  amountCents: number;
  partnerId: string;
  documentNumber: string;
  documentDate: Date;
  dueDate: Date | null;
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

function postingLinesBalanced(lines: PostingLineInput[]) {
  const totals = lines.reduce(
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

  return totals.debit === totals.credit;
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

export async function postInvoiceBook(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectInvoicePosting("/agencija/racuni/neproknjizeno", "knjizenje_kontekst");
  }

  const documentType = value(formData, "dokument_tip").toUpperCase();
  const bookId = value(formData, "book_id");
  const returnTo = value(formData, "return_to") || "/agencija/racuni/neproknjizeno";

  if (
    !bookId ||
    (documentType !== invoicePostingDocumentTypes.kuf &&
      documentType !== invoicePostingDocumentTypes.kif)
  ) {
    redirectInvoicePosting(returnTo, "knjizenje_greska");
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
                  is_deleted: false,
                  moze_da_mijenja: true
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
    redirectInvoicePosting(returnTo, "knjizenje_kontekst");
  }

  await requireInvoicePermission(user, firma.id, documentType, "post", (message) =>
    redirectInvoicePosting(returnTo, message)
  );

  const result = await prisma.$transaction(async (tx) => {
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
              supplier_invoice_number: true,
              invoice_date: true,
              due_date: true,
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
              journal_id: true,
              dobavljac_id: true,
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

      const journalTypeId = book.racun_vrsta.vrsta_naloga_id;

      if (!journalTypeId) {
        return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
      }

      const unpostedEntries = book.entries.filter(
        (entry) => entry.posting_status === "UNPOSTED" && !entry.journal_id
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
        book.entries.find((entry) => entry.journal_id)?.journal_id ??
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

      const existingJournal = existingJournalId
        ? await tx.nalog.findFirst({
            where: {
              id: existingJournalId,
              firma_id: firma.id,
              poslovna_godina_id: poslovnaGodina.id,
              is_deleted: false
            },
            select: {
              id: true,
              sifra: true,
              status: true
            }
          })
        : null;

      if (existingJournal?.status === journalStatuses.posted) {
        return { ok: false as const, reason: "knjizenje_nalog_zakljucan" };
      }

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

      const importDefaultAccounts = await tx.firmaPodrazumijevanoKonto.findMany({
        where: {
          firma_id: firma.id,
          dokument_tip: invoicePostingDocumentTypes.general,
          podvrsta: invoicePostingDefaultScope.subtype,
          pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
          namjena: {
            in: [importAccountPurposes.customsDuty, importAccountPurposes.importVat]
          }
        },
        select: {
          namjena: true,
          sifra_konta: true
        }
      });
      const importAccountByPurpose = new Map(
        importDefaultAccounts.map((item) => [item.namjena, item.sifra_konta])
      );

      for (const entry of unpostedEntries) {
        if (entry.is_import) {
          const payable = firma.pdv_obveznik;
          const goodsCents = decimalToCents(entry.goods_value);
          const dutyCents = decimalToCents(entry.customs_duty_amount);
          const vatCents = decimalToCents(entry.customs_vat_amount);

          const goodsAccount = entry.expense_account?.sifra;
          const supplierAccount = ruleByField.get("UKUPAN_IZNOS")?.sifra_konta ?? null;
          const customsDutyAccount =
            importAccountByPurpose.get(importAccountPurposes.customsDuty) ?? null;
          const importVatAccount =
            importAccountByPurpose.get(importAccountPurposes.importVat) ?? null;

          const carinaCreditCents = dutyCents + vatCents;
          const needImportVatAccount = payable && vatCents > 0;

          if (
            !goodsAccount ||
            !supplierAccount ||
            (carinaCreditCents > 0 && !customsDutyAccount) ||
            (needImportVatAccount && !importVatAccount)
          ) {
            return { ok: false as const, reason: "knjizenje_sema" };
          }

          const documentNumber = normalizeFiscalInvoiceNumber(entry.supplier_invoice_number);
          const pushImportLine = (
            accountCode: string,
            direction: "D" | "P",
            amountCents: number
          ) => {
            if (amountCents === 0) {
              return;
            }

            lines.push({
              accountCode,
              direction,
              amountCents,
              partnerId: entry.dobavljac_id,
              documentNumber,
              documentDate: entry.invoice_date,
              dueDate: entry.due_date
            });
          };

          const goodsDebitCents = payable
            ? goodsCents + dutyCents
            : goodsCents + dutyCents + vatCents;

          pushImportLine(goodsAccount, "D", goodsDebitCents);

          if (payable && importVatAccount) {
            pushImportLine(importVatAccount, "D", vatCents);
          }

          pushImportLine(supplierAccount, "P", goodsCents);

          if (customsDutyAccount) {
            pushImportLine(customsDutyAccount, "P", carinaCreditCents);
          }

          continue;
        }

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

          lines.push({
            accountCode,
            direction: (rule?.smjer ?? field.direction) as "D" | "P",
            amountCents,
            partnerId: entry.dobavljac_id,
            documentNumber: normalizeFiscalInvoiceNumber(entry.supplier_invoice_number),
            documentDate: entry.invoice_date,
            dueDate: entry.due_date
          });
        }
      }

      if (lines.length === 0) {
        return { ok: false as const, reason: "knjizenje_nema" };
      }

      if (!postingLinesBalanced(lines)) {
        return { ok: false as const, reason: "knjizenje_nije_balansiran" };
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

        await tx.stavkaNaloga.create({
          data: {
            nalog_id: journal.id,
            konto_id: account.id,
            komitent_id: line.partnerId,
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
          updated_by: user.id
        }
      });

      return {
        ok: true as const,
        created: !existingJournal,
        journalId: journal.id,
        journalCode: journal.sifra ?? "NALOG"
      };
    }

    const book = await tx.kifBook.findFirst({
      where: {
        id: bookId,
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
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
            customer_invoice_number: true,
            invoice_date: true,
            due_date: true,
            total_gross: true,
            revenue_account: {
              select: {
                sifra: true
              }
            },
            posting_status: true,
            journal_id: true,
            kupac_id: true,
            tax_lines: {
              select: {
                vat_rate_code: true,
                tax_base: true,
                output_vat_amount: true
              }
            }
          }
        }
      }
    });

    if (!book) {
      return { ok: false as const, reason: "knjizenje_greska" };
    }

    const journalTypeId = book.racun_vrsta.vrsta_naloga_id;

    if (!journalTypeId) {
      return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
    }

    const unpostedEntries = book.entries.filter(
      (entry) => entry.posting_status === "UNPOSTED" && !entry.journal_id
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
      book.entries.find((entry) => entry.journal_id)?.journal_id ??
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
      )?.id ??
      null;

    const existingJournal = existingJournalId
      ? await tx.nalog.findFirst({
          where: {
            id: existingJournalId,
            firma_id: firma.id,
            poslovna_godina_id: poslovnaGodina.id,
            is_deleted: false
          },
          select: {
            id: true,
            sifra: true,
            status: true
          }
        })
      : null;

    if (existingJournal?.status === journalStatuses.posted) {
      return { ok: false as const, reason: "knjizenje_nalog_zakljucan" };
    }

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

    for (const entry of unpostedEntries) {
      for (const field of fields) {
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

        lines.push({
          accountCode,
          direction: (rule?.smjer ?? field.direction) as "D" | "P",
          amountCents,
          partnerId: entry.kupac_id,
          documentNumber: normalizeFiscalInvoiceNumber(entry.customer_invoice_number),
          documentDate: entry.invoice_date,
          dueDate: entry.due_date
        });
      }
    }

    if (lines.length === 0) {
      return { ok: false as const, reason: "knjizenje_nema" };
    }

    if (!postingLinesBalanced(lines)) {
      return { ok: false as const, reason: "knjizenje_nije_balansiran" };
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

      await tx.stavkaNaloga.create({
        data: {
          nalog_id: journal.id,
          konto_id: account.id,
          komitent_id: line.partnerId,
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

    await tx.nalog.update({
      where: {
        id: journal.id
      },
      data: {
        updated_by: user.id
      }
    });

    return {
      ok: true as const,
      created: !existingJournal,
      journalId: journal.id,
      journalCode: journal.sifra ?? "NALOG"
    };
  });

  if (!result.ok) {
    redirectInvoicePosting(returnTo, result.reason);
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: `agencija.racuni.${documentType.toLowerCase()}`,
    akcija: result.created ? "create_journal_from_book" : "append_journal_from_book",
    tipEntiteta: "Nalog",
    entitetId: result.journalId,
    novaVrijednost: {
      documentType,
      bookId,
      journalCode: result.journalCode
    }
  });

  revalidatePath("/agencija/racuni/neproknjizeno");
  revalidatePath("/agencija/nalozi");
  revalidatePath(`/agencija/nalozi/${result.journalId}`);
  revalidatePath(returnTo);
  redirectInvoicePosting(
    returnTo,
    result.created ? "knjizenje_kreiran" : "knjizenje_dodato",
    result.journalCode
  );
}

export async function createKufBook(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKuf("kuf_kontekst");
  }

  const month = Number(value(formData, "mjesec"));
  const invoiceTypeId = value(formData, "racun_vrsta_id");

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    redirectKuf("kuf_mjesec");
  }

  if (!invoiceTypeId) {
    redirectKuf("kuf_vrsta");
  }

  const [firma, poslovnaGodina, invoiceType] = await Promise.all([
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
        id: true
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
    }),
    prisma.racunVrsta.findFirst({
      where: {
        id: invoiceTypeId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        dokument_tip: invoicePostingDocumentTypes.kuf,
        aktivna: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !invoiceType) {
    redirectKuf("kuf_greska");
  }

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kuf,
    "create",
    redirectKuf
  );

  const kufDate = parseDate(formData, "kuf_date") ?? lastDayOfMonth(poslovnaGodina.godina, month);

  const kufBook = await prisma.$transaction(async (tx) => {
    const lastBook = await tx.kufBook.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastBook?.redni_broj ?? 0) + 1;
    const internalNumber = `KUF-${poslovnaGodina.godina}-${String(redniBroj).padStart(4, "0")}`;

    return tx.kufBook.create({
      data: {
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        racun_vrsta_id: invoiceType.id,
        redni_broj: redniBroj,
        internal_kuf_number: internalNumber,
        mjesec: month,
        kuf_date: kufDate,
        created_by: user.id,
        updated_by: user.id
      },
      select: {
        id: true,
        internal_kuf_number: true,
        racun_vrsta: {
          select: {
            sifra: true,
            naziv: true
          }
        },
        mjesec: true,
        kuf_date: true
      }
    });
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kuf",
    akcija: "create_book",
    tipEntiteta: "KufBook",
    entitetId: kufBook.id,
    novaVrijednost: kufBook
  });

  revalidatePath("/agencija/racuni/kuf");
  redirect(`/agencija/racuni/kuf/${kufBook.id}?poruka=kuf_knjiga_sacuvana`);
}

export async function createKifBook(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKif("kif_kontekst");
  }

  const month = Number(value(formData, "mjesec"));
  const invoiceTypeId = value(formData, "racun_vrsta_id");

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    redirectKif("kif_mjesec");
  }

  if (!invoiceTypeId) {
    redirectKif("kif_vrsta");
  }

  const [firma, poslovnaGodina, invoiceType] = await Promise.all([
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
        id: true
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
    }),
    prisma.racunVrsta.findFirst({
      where: {
        id: invoiceTypeId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        dokument_tip: invoicePostingDocumentTypes.kif,
        aktivna: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !invoiceType) {
    redirectKif("kif_greska");
  }

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kif,
    "create",
    redirectKif
  );

  const kifDate = parseDate(formData, "kif_date") ?? lastDayOfMonth(poslovnaGodina.godina, month);

  const kifBook = await prisma.$transaction(async (tx) => {
    const lastBook = await tx.kifBook.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastBook?.redni_broj ?? 0) + 1;
    const internalNumber = `KIF-${poslovnaGodina.godina}-${String(redniBroj).padStart(4, "0")}`;

    return tx.kifBook.create({
      data: {
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        racun_vrsta_id: invoiceType.id,
        redni_broj: redniBroj,
        internal_kif_number: internalNumber,
        mjesec: month,
        kif_date: kifDate,
        created_by: user.id,
        updated_by: user.id
      },
      select: {
        id: true,
        internal_kif_number: true,
        racun_vrsta: {
          select: {
            sifra: true,
            naziv: true
          }
        },
        mjesec: true,
        kif_date: true
      }
    });
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kif",
    akcija: "create_book",
    tipEntiteta: "KifBook",
    entitetId: kifBook.id,
    novaVrijednost: kifBook
  });

  revalidatePath("/agencija/racuni/kif");
  redirect(`/agencija/racuni/kif/${kifBook.id}?poruka=kif_knjiga_sacuvana`);
}

export async function createKufEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKuf("kuf_kontekst");
  }

  const kufBookId = value(formData, "kuf_book_id");
  const supplierId = value(formData, "dobavljac_id");
  const supplierInvoiceNumber = normalizeFiscalInvoiceNumber(value(formData, "supplier_invoice_number"));
  const invoiceDate = parseDate(formData, "invoice_date");
  const receiptDate = parseDate(formData, "receipt_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const expenseAccountCode = value(formData, "expense_account_code");
  const submittedVatTransactionType = value(formData, "vat_transaction_type");
  const fiscalIic = nullableValue(formData, "fiscal_iic");
  const fiscalFic = nullableValue(formData, "fiscal_fic");
  const fiscalSellerTin = normalizePib(value(formData, "fiscal_seller_tin")) || null;
  const fiscalDateTime = parseFiscalDateTime(value(formData, "fiscal_datetime"));
  const fiscalSourceUrl = nullableValue(formData, "fiscal_source_url");

  const isImport =
    submittedVatTransactionType.trim().toUpperCase() === vatTransactionTypes.import;

  if (
    !supplierId ||
    !kufBookId ||
    !supplierInvoiceNumber ||
    !invoiceDate ||
    !receiptDate ||
    !expenseAccountCode ||
    (!isImport && (invoiceTotalCents === null || invoiceTotalCents <= 0))
  ) {
    redirectKuf("kuf_obavezno");
  }

  const [firma, poslovnaGodina, supplier] = await Promise.all([
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
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        aktivan: true,
        OR: [
          {
            scope: "GLOBAL"
          },
          {
            scope: "AGENCY",
            agencija_id: user.agencija_id
          },
          {
            scope: "COMPANY",
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        pib: true,
        is_foreign: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !supplier) {
    if (kufBookId) {
      redirectKufEntry(kufBookId, "kuf_greska");
    }

    redirectKuf("kuf_greska");
  }

  const vatTransactionType = normalizeVatTransactionType(
    submittedVatTransactionType,
    invoicePostingDocumentTypes.kuf,
    supplier.is_foreign
  );

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kuf,
    "create",
    (message) => redirectKufEntry(kufBookId, message)
  );

  const kufBook = await prisma.kufBook.findFirst({
    where: {
      id: kufBookId,
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      is_deleted: false
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!kufBook || kufBook.status !== "OPEN") {
    redirectKuf("kuf_knjiga");
  }

  const duplicateSupplierEntry = await prisma.kufEntry.findFirst({
    where: {
      firma_id: firma.id,
      dobavljac_id: supplier.id,
      supplier_invoice_number: supplierInvoiceNumber,
      invoice_date: invoiceDate,
      is_deleted: false
    },
    select: {
      id: true
    }
  });

  if (duplicateSupplierEntry) {
    redirectKufEntry(kufBook.id, "kuf_dupli_broj");
  }

  if (fiscalIic && fiscalSellerTin && fiscalDateTime) {
    const duplicateFiscalEntry = await prisma.kufEntry.findFirst({
      where: {
        firma_id: firma.id,
        fiscal_iic: fiscalIic,
        fiscal_seller_tin: fiscalSellerTin,
        fiscal_datetime: fiscalDateTime,
        is_deleted: false
      },
      select: {
        id: true
      }
    });

    if (duplicateFiscalEntry) {
      redirectKufEntry(kufBook.id, "kuf_dupli_fiskalni");
    }
  }

  const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
  const baseValues = formData.getAll("tax_base").map((item) => String(item));
  const vatValues = formData.getAll("input_vat_amount").map((item) => String(item));
  const nonDeductibleValues = formData
    .getAll("non_deductible_vat_amount")
    .map((item) => String(item));

  const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
  let totalBaseCents = 0;
  let totalInputVatCents = 0;
  let deductibleVatCents = 0;
  let nonDeductibleVatCents = 0;
  let dominantVatRateCode: string | null = null;
  let grossCents = 0;
  let goodsValueCents = 0;
  let customsBaseCents = 0;
  let customsDutyCents = 0;
  let customsVatCents = 0;
  let customsVatRatePercent: number | null = null;

  if (isImport) {
    goodsValueCents = parseMoneyToCents(value(formData, "goods_value")) ?? 0;
    customsBaseCents = parseMoneyToCents(value(formData, "customs_base_amount")) ?? 0;
    customsDutyCents = parseMoneyToCents(value(formData, "customs_duty_amount")) ?? 0;
    customsVatCents = parseMoneyToCents(value(formData, "customs_vat_amount")) ?? 0;
    customsVatRatePercent = parsePercentInput(value(formData, "customs_vat_rate_percent"));

    if (goodsValueCents <= 0) {
      redirectKufEntry(kufBook.id, "kuf_obavezno");
    }

    grossCents = goodsValueCents + customsDutyCents + customsVatCents;
    totalBaseCents = customsBaseCents;
    totalInputVatCents = customsVatCents;

    if (firma.pdv_obveznik) {
      deductibleVatCents = customsVatCents;
      nonDeductibleVatCents = 0;
    } else {
      deductibleVatCents = 0;
      nonDeductibleVatCents = customsVatCents;
    }
  } else {
    const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
    const baseValues = formData.getAll("tax_base").map((item) => String(item));
    const activeRates = await prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
        aktivna: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    });
    const ratesById = new Map(activeRates.map((rate) => [rate.id, rate]));
    let dominantVatAmountCents = 0;

    for (let index = 0; index < vatRateIds.length; index += 1) {
      const rate = ratesById.get(vatRateIds[index]);
      const baseCents = parseMoneyToCents(baseValues[index] ?? "");
      const submittedVatCents = parseMoneyToCents(vatValues[index] ?? "");
      const nonDeductibleCents = parseMoneyToCents(nonDeductibleValues[index] ?? "");

      if (!rate || baseCents === null || submittedVatCents === null || nonDeductibleCents === null) {
        redirectKufEntry(kufBook.id, "kuf_iznosi");
      }

      const calculatedVatCents = Math.round(baseCents * percentToNumber(rate.procenat) / 100);
      const inputVatCents = baseCents > 0 ? calculatedVatCents : submittedVatCents;

      if (baseCents === 0 && inputVatCents === 0 && nonDeductibleCents === 0) {
        continue;
      }

      if (nonDeductibleCents > inputVatCents) {
        redirectKufEntry(kufBook.id, "kuf_iznosi");
      }

      const deductibleCents = inputVatCents - nonDeductibleCents;
      const lineGrossCents = baseCents + inputVatCents;

      if (lineGrossCents > dominantVatAmountCents) {
        dominantVatAmountCents = lineGrossCents;
        dominantVatRateCode = rate.sifra;
      }

      totalBaseCents += baseCents;
      totalInputVatCents += inputVatCents;
      deductibleVatCents += deductibleCents;
      nonDeductibleVatCents += nonDeductibleCents;

      taxLines.push({
        vat_rate_id: rate.id,
        vat_rate_code: rate.sifra,
        vat_rate_name: rate.naziv,
        vat_rate_percent: rate.procenat,
        tax_base: centsToDecimal(baseCents),
        input_vat_amount: centsToDecimal(inputVatCents),
        deductible_vat_amount: centsToDecimal(deductibleCents),
        non_deductible_vat_amount: centsToDecimal(nonDeductibleCents),
        total_with_vat: centsToDecimal(lineGrossCents),
        created_by: user.id
      });
    }

    if (taxLines.length === 0 || totalBaseCents + totalInputVatCents <= 0) {
      redirectKufEntry(kufBook.id, "kuf_iznosi");
    }

    const calculatedGrossCents = totalBaseCents + totalInputVatCents;

    if (invoiceTotalCents === null || Math.abs(invoiceTotalCents - calculatedGrossCents) > 1) {
      redirectKufEntry(kufBook.id, "kuf_ukupno");
    }

    grossCents = invoiceTotalCents;
  }

  const kufEntry = await prisma.$transaction(async (tx) => {
    const expenseAccount = await resolveCompanyAccount(tx, firma.id, expenseAccountCode);

    if (!expenseAccount) {
      return null;
    }

    await saveSupplierKufDefaults(
      tx,
      firma.id,
      supplier.id,
      expenseAccount.sifra,
      dominantVatRateCode
    );

    const lastEntry = await tx.kufEntry.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastEntry?.redni_broj ?? 0) + 1;
    const internalNumber = `KUF-${poslovnaGodina.godina}-${String(redniBroj).padStart(4, "0")}`;

    return tx.kufEntry.create({
      data: {
        agencija_id: user.agencija_id!,
        kuf_book_id: kufBook.id,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        dobavljac_id: supplier.id,
        redni_broj: redniBroj,
        internal_kuf_number: internalNumber,
        supplier_invoice_number: supplierInvoiceNumber,
        fiscal_iic: fiscalIic,
        fiscal_fic: fiscalFic,
        fiscal_seller_tin: fiscalSellerTin,
        fiscal_datetime: fiscalDateTime,
        fiscal_source_url: fiscalSourceUrl,
        invoice_date: invoiceDate,
        receipt_date: receiptDate,
        due_date: dueDate,
        vat_transaction_type: vatTransactionType,
        is_import: isImport,
        customs_declaration_number:
          isImport ? nullableValue(formData, "customs_declaration_number") : null,
        customs_declaration_date:
          isImport ? parseDate(formData, "customs_declaration_date") : null,
        goods_value: centsToDecimal(isImport ? goodsValueCents : 0),
        customs_base_amount: centsToDecimal(isImport ? customsBaseCents : 0),
        customs_duty_amount: centsToDecimal(isImport ? customsDutyCents : 0),
        customs_vat_rate_percent: isImport ? customsVatRatePercent : null,
        customs_vat_amount: centsToDecimal(isImport ? customsVatCents : 0),
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalInputVatCents),
        deductible_vat: centsToDecimal(deductibleVatCents),
        non_deductible_vat: centsToDecimal(nonDeductibleVatCents),
        total_gross: centsToDecimal(grossCents),
        expense_account_id: expenseAccount.id,
        note,
        created_by: user.id,
        updated_by: user.id,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        id: true,
        internal_kuf_number: true,
        supplier_invoice_number: true,
        total_gross: true
      }
    });
  });

  if (!kufEntry) {
    redirectKufEntry(kufBook.id, "kuf_konto");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kuf",
    akcija: "create",
    tipEntiteta: "KufEntry",
    entitetId: kufEntry.id,
    novaVrijednost: kufEntry
  });

  revalidatePath("/agencija/racuni/kuf");
  revalidatePath(`/agencija/racuni/kuf/${kufBook.id}`);
  redirectKufEntry(kufBook.id, "kuf_sacuvan");
}

export async function updateKufEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKuf("kuf_kontekst");
  }

  const kufBookId = value(formData, "kuf_book_id");
  const kufEntryId = value(formData, "kuf_entry_id");
  const supplierId = value(formData, "dobavljac_id");
  const supplierInvoiceNumber = normalizeFiscalInvoiceNumber(value(formData, "supplier_invoice_number"));
  const invoiceDate = parseDate(formData, "invoice_date");
  const receiptDate = parseDate(formData, "receipt_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const expenseAccountCode = value(formData, "expense_account_code");
  const submittedVatTransactionType = value(formData, "vat_transaction_type");
  const fiscalIic = nullableValue(formData, "fiscal_iic");
  const fiscalFic = nullableValue(formData, "fiscal_fic");
  const fiscalSellerTin = normalizePib(value(formData, "fiscal_seller_tin")) || null;
  const fiscalDateTime = parseFiscalDateTime(value(formData, "fiscal_datetime"));
  const fiscalSourceUrl = nullableValue(formData, "fiscal_source_url");

  const isImport =
    submittedVatTransactionType.trim().toUpperCase() === vatTransactionTypes.import;

  if (
    !supplierId ||
    !kufBookId ||
    !kufEntryId ||
    !supplierInvoiceNumber ||
    !invoiceDate ||
    !receiptDate ||
    !expenseAccountCode ||
    (!isImport && (invoiceTotalCents === null || invoiceTotalCents <= 0))
  ) {
    redirectKufEntry(kufBookId, "kuf_obavezno");
  }

  const [firma, poslovnaGodina, supplier, kufBook, existingEntry] = await Promise.all([
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
        zakljucena: true
      }
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        aktivan: true,
        OR: [
          {
            scope: "GLOBAL"
          },
          {
            scope: "AGENCY",
            agencija_id: user.agencija_id
          },
          {
            scope: "COMPANY",
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        pib: true,
        is_foreign: true
      }
    }),
    prisma.kufBook.findFirst({
      where: {
        id: kufBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        status: true
      }
    }),
    prisma.kufEntry.findFirst({
      where: {
        id: kufEntryId,
        kuf_book_id: kufBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        posting_status: true
      }
    })
  ]);

  if (
    !firma ||
    !poslovnaGodina ||
    poslovnaGodina.zakljucena ||
    !supplier ||
    !kufBook ||
    kufBook.status !== "OPEN" ||
    !existingEntry ||
    existingEntry.posting_status !== "UNPOSTED"
  ) {
    redirectKufEntry(kufBookId, "kuf_greska");
  }

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kuf,
    "update",
    (message) => redirectKufEntry(kufBookId, message)
  );

  const duplicateSupplierEntry = await prisma.kufEntry.findFirst({
    where: {
      firma_id: firma.id,
      dobavljac_id: supplier.id,
      supplier_invoice_number: supplierInvoiceNumber,
      invoice_date: invoiceDate,
      is_deleted: false,
      NOT: {
        id: existingEntry.id
      }
    },
    select: {
      id: true
    }
  });

  if (duplicateSupplierEntry) {
    redirectKufEntry(kufBook.id, "kuf_dupli_broj");
  }

  const vatTransactionType = normalizeVatTransactionType(
    submittedVatTransactionType,
    invoicePostingDocumentTypes.kuf,
    supplier.is_foreign
  );

  if (fiscalIic && fiscalSellerTin && fiscalDateTime) {
    const duplicateFiscalEntry = await prisma.kufEntry.findFirst({
      where: {
        firma_id: firma.id,
        fiscal_iic: fiscalIic,
        fiscal_seller_tin: fiscalSellerTin,
        fiscal_datetime: fiscalDateTime,
        is_deleted: false,
        NOT: {
          id: existingEntry.id
        }
      },
      select: {
        id: true
      }
    });

    if (duplicateFiscalEntry) {
      redirectKufEntry(kufBook.id, "kuf_dupli_fiskalni");
    }
  }

  const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
  const baseValues = formData.getAll("tax_base").map((item) => String(item));
  const vatValues = formData.getAll("input_vat_amount").map((item) => String(item));
  const nonDeductibleValues = formData
    .getAll("non_deductible_vat_amount")
    .map((item) => String(item));

  const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
  let totalBaseCents = 0;
  let totalInputVatCents = 0;
  let deductibleVatCents = 0;
  let nonDeductibleVatCents = 0;
  let dominantVatRateCode: string | null = null;
  let grossCents = 0;
  let goodsValueCents = 0;
  let customsBaseCents = 0;
  let customsDutyCents = 0;
  let customsVatCents = 0;
  let customsVatRatePercent: number | null = null;

  if (isImport) {
    goodsValueCents = parseMoneyToCents(value(formData, "goods_value")) ?? 0;
    customsBaseCents = parseMoneyToCents(value(formData, "customs_base_amount")) ?? 0;
    customsDutyCents = parseMoneyToCents(value(formData, "customs_duty_amount")) ?? 0;
    customsVatCents = parseMoneyToCents(value(formData, "customs_vat_amount")) ?? 0;
    customsVatRatePercent = parsePercentInput(value(formData, "customs_vat_rate_percent"));

    if (goodsValueCents <= 0) {
      redirectKufEntry(kufBook.id, "kuf_obavezno");
    }

    grossCents = goodsValueCents + customsDutyCents + customsVatCents;
    totalBaseCents = customsBaseCents;
    totalInputVatCents = customsVatCents;

    if (firma.pdv_obveznik) {
      deductibleVatCents = customsVatCents;
      nonDeductibleVatCents = 0;
    } else {
      deductibleVatCents = 0;
      nonDeductibleVatCents = customsVatCents;
    }
  } else {
    const activeRates = await prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
        aktivna: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    });
    const ratesById = new Map(activeRates.map((rate) => [rate.id, rate]));
    let dominantVatAmountCents = 0;

    for (let index = 0; index < vatRateIds.length; index += 1) {
      const rate = ratesById.get(vatRateIds[index]);
      const baseCents = parseMoneyToCents(baseValues[index] ?? "");
      const submittedVatCents = parseMoneyToCents(vatValues[index] ?? "");
      const nonDeductibleCents = parseMoneyToCents(nonDeductibleValues[index] ?? "");

      if (!rate || baseCents === null || submittedVatCents === null || nonDeductibleCents === null) {
        redirectKufEntry(kufBook.id, "kuf_iznosi");
      }

      const calculatedVatCents = Math.round(baseCents * percentToNumber(rate.procenat) / 100);
      const inputVatCents = baseCents > 0 ? calculatedVatCents : submittedVatCents;

      if (baseCents === 0 && inputVatCents === 0 && nonDeductibleCents === 0) {
        continue;
      }

      if (nonDeductibleCents > inputVatCents) {
        redirectKufEntry(kufBook.id, "kuf_iznosi");
      }

      const deductibleCents = inputVatCents - nonDeductibleCents;
      const lineGrossCents = baseCents + inputVatCents;

      if (lineGrossCents > dominantVatAmountCents) {
        dominantVatAmountCents = lineGrossCents;
        dominantVatRateCode = rate.sifra;
      }

      totalBaseCents += baseCents;
      totalInputVatCents += inputVatCents;
      deductibleVatCents += deductibleCents;
      nonDeductibleVatCents += nonDeductibleCents;

      taxLines.push({
        vat_rate_id: rate.id,
        vat_rate_code: rate.sifra,
        vat_rate_name: rate.naziv,
        vat_rate_percent: rate.procenat,
        tax_base: centsToDecimal(baseCents),
        input_vat_amount: centsToDecimal(inputVatCents),
        deductible_vat_amount: centsToDecimal(deductibleCents),
        non_deductible_vat_amount: centsToDecimal(nonDeductibleCents),
        total_with_vat: centsToDecimal(lineGrossCents),
        created_by: user.id
      });
    }

    if (taxLines.length === 0 || totalBaseCents + totalInputVatCents <= 0) {
      redirectKufEntry(kufBook.id, "kuf_iznosi");
    }

    const calculatedGrossCents = totalBaseCents + totalInputVatCents;

    if (invoiceTotalCents === null || Math.abs(invoiceTotalCents - calculatedGrossCents) > 1) {
      redirectKufEntry(kufBook.id, "kuf_ukupno");
    }

    grossCents = invoiceTotalCents;
  }

  const updatedEntry = await prisma.$transaction(async (tx) => {
    const expenseAccount = await resolveCompanyAccount(tx, firma.id, expenseAccountCode);

    if (!expenseAccount) {
      return null;
    }

    await saveSupplierKufDefaults(
      tx,
      firma.id,
      supplier.id,
      expenseAccount.sifra,
      dominantVatRateCode
    );

    await tx.kufEntryTaxLine.deleteMany({
      where: {
        kuf_entry_id: existingEntry.id
      }
    });

    return tx.kufEntry.update({
      where: {
        id: existingEntry.id
      },
      data: {
        dobavljac_id: supplier.id,
        supplier_invoice_number: supplierInvoiceNumber,
        fiscal_iic: fiscalIic,
        fiscal_fic: fiscalFic,
        fiscal_seller_tin: fiscalSellerTin,
        fiscal_datetime: fiscalDateTime,
        fiscal_source_url: fiscalSourceUrl,
        invoice_date: invoiceDate,
        receipt_date: receiptDate,
        due_date: dueDate,
        vat_transaction_type: vatTransactionType,
        is_import: isImport,
        customs_declaration_number:
          isImport ? nullableValue(formData, "customs_declaration_number") : null,
        customs_declaration_date:
          isImport ? parseDate(formData, "customs_declaration_date") : null,
        goods_value: centsToDecimal(isImport ? goodsValueCents : 0),
        customs_base_amount: centsToDecimal(isImport ? customsBaseCents : 0),
        customs_duty_amount: centsToDecimal(isImport ? customsDutyCents : 0),
        customs_vat_rate_percent: isImport ? customsVatRatePercent : null,
        customs_vat_amount: centsToDecimal(isImport ? customsVatCents : 0),
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalInputVatCents),
        deductible_vat: centsToDecimal(deductibleVatCents),
        non_deductible_vat: centsToDecimal(nonDeductibleVatCents),
        total_gross: centsToDecimal(grossCents),
        expense_account_id: expenseAccount.id,
        note,
        updated_by: user.id,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        id: true,
        internal_kuf_number: true,
        supplier_invoice_number: true,
        total_gross: true
      }
    });
  });

  if (!updatedEntry) {
    redirectKufEntry(kufBook.id, "kuf_konto");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kuf",
    akcija: "update",
    tipEntiteta: "KufEntry",
    entitetId: updatedEntry.id,
    novaVrijednost: updatedEntry
  });

  revalidatePath("/agencija/racuni/kuf");
  revalidatePath("/agencija/racuni/pregled-kuf");
  revalidatePath(`/agencija/racuni/kuf/${kufBook.id}`);
  redirectKufEntry(kufBook.id, "kuf_izmijenjen");
}

export async function deleteKufEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKuf("kuf_kontekst");
  }

  const kufBookId = value(formData, "kuf_book_id");
  const kufEntryId = value(formData, "kuf_entry_id");

  if (!kufBookId || !kufEntryId) {
    redirectKufEntry(kufBookId, "kuf_greska");
  }

  const [poslovnaGodina, kufBook, entry] = await Promise.all([
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        zakljucena: true
      }
    }),
    prisma.kufBook.findFirst({
      where: {
        id: kufBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        status: true
      }
    }),
    prisma.kufEntry.findFirst({
      where: {
        id: kufEntryId,
        kuf_book_id: kufBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        posting_status: true,
        journal_id: true,
        internal_kuf_number: true
      }
    })
  ]);

  if (
    !poslovnaGodina ||
    poslovnaGodina.zakljucena ||
    !kufBook ||
    kufBook.status !== "OPEN" ||
    !entry ||
    entry.posting_status !== "UNPOSTED" ||
    entry.journal_id
  ) {
    redirectKufEntry(kufBookId, "kuf_greska");
  }

  await requireInvoicePermission(
    user,
    workContext.firmaId,
    invoicePostingDocumentTypes.kuf,
    "delete",
    (message) => redirectKufEntry(kufBookId, message)
  );

  const deletedEntry = await prisma.kufEntry.update({
    where: {
      id: entry.id
    },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: user.id,
      delete_reason: "Korisnik je obrisao račun iz KUF knjige.",
      updated_by: user.id
    },
    select: {
      id: true,
      internal_kuf_number: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: workContext.firmaId,
    modul: "agencija.racuni.kuf",
    akcija: "delete",
    tipEntiteta: "KufEntry",
    entitetId: deletedEntry.id,
    novaVrijednost: deletedEntry
  });

  revalidatePath("/agencija/racuni/kuf");
  revalidatePath("/agencija/racuni/pregled-kuf");
  revalidatePath(`/agencija/racuni/kuf/${kufBook.id}`);
  redirectKufEntry(kufBook.id, "kuf_obrisan");
}

export async function createKifEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKif("kif_kontekst");
  }

  const kifBookId = value(formData, "kif_book_id");
  const buyerId = value(formData, "kupac_id");
  const customerInvoiceNumber = normalizeFiscalInvoiceNumber(value(formData, "customer_invoice_number"));
  const invoiceDate = parseDate(formData, "invoice_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const revenueAccountCode = value(formData, "revenue_account_code");
  const submittedVatTransactionType = value(formData, "vat_transaction_type");

  if (
    !buyerId ||
    !kifBookId ||
    !customerInvoiceNumber ||
    !invoiceDate ||
    invoiceTotalCents === null ||
    invoiceTotalCents <= 0
  ) {
    redirectKif(kifBookId ? "kif_obavezno" : "kif_kontekst");
  }

  const [firma, poslovnaGodina, buyer] = await Promise.all([
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
        id: true
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
    }),
    prisma.komitent.findFirst({
      where: {
        id: buyerId,
        aktivan: true,
        OR: [
          {
            scope: "GLOBAL"
          },
          {
            scope: "AGENCY",
            agencija_id: user.agencija_id
          },
          {
            scope: "COMPANY",
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        pib: true,
        is_foreign: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !buyer) {
    redirectKifEntry(kifBookId, "kif_greska");
  }

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kif,
    "create",
    (message) => redirectKifEntry(kifBookId, message)
  );

  const vatTransactionType = normalizeVatTransactionType(
    submittedVatTransactionType,
    invoicePostingDocumentTypes.kif,
    buyer.is_foreign
  );

  const kifBook = await prisma.kifBook.findFirst({
    where: {
      id: kifBookId,
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      status: "OPEN",
      is_deleted: false
    },
    select: {
      id: true,
      racun_vrsta_id: true,
      racun_vrsta: {
        select: {
          dokument_tip: true,
          kontiranjePravila: {
            where: {
              aktivno: true
            },
            select: {
              polje_sifra: true,
              konto_izvor: true,
              sifra_konta: true
            }
          }
        }
      }
    }
  });

  if (!kifBook) {
    redirectKif("kif_knjiga");
  }

  const duplicateCustomerEntry = await prisma.kifEntry.findFirst({
    where: {
      firma_id: firma.id,
      kupac_id: buyer.id,
      customer_invoice_number: customerInvoiceNumber,
      invoice_date: invoiceDate,
      is_deleted: false
    },
    select: {
      id: true
    }
  });

  if (duplicateCustomerEntry) {
    redirectKifEntry(kifBook.id, "kif_dupli_broj");
  }

  const activeRates = await prisma.pdvStopa.findMany({
    where: {
      agencija_id: user.agencija_id,
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
      id: true,
      sifra: true,
      naziv: true,
      procenat: true
    }
  });

  const fields = invoicePostingFields(kifBook.racun_vrsta.dokument_tip, activeRates);
  const fieldRules = new Map(
    kifBook.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
  );
  const baseFields = fields.filter(
    (field) => field.code.startsWith("OSNOVICA_") || field.code.startsWith("OSLOBODJENO_")
  );
  const requiresRevenueAccount = baseFields.some((field) => {
    const rule = fieldRules.get(field.code);

    return (rule?.konto_izvor ?? field.accountSource) === invoicePostingAccountSources.inputExpense;
  });

  if (requiresRevenueAccount && !revenueAccountCode) {
    redirectKifEntry(kifBook.id, "kif_konto_obavezan");
  }

  const taxLineRateIds = formData.getAll("vat_rate_id").map((entry) => String(entry));
  const taxLineBases = formData.getAll("tax_base").map((entry) => String(entry));
  const taxLineVatAmounts = formData.getAll("output_vat_amount").map((entry) => String(entry));

  const ratesById = new Map(activeRates.map((rate) => [rate.id, rate]));
  const taxLines: Prisma.KifEntryTaxLineCreateManyKif_entryInput[] = [];
  let baseTotalCents = 0;
  let vatTotalCents = 0;

  for (let index = 0; index < taxLineRateIds.length; index += 1) {
    const rate = ratesById.get(taxLineRateIds[index]);
    const baseCents = parseMoneyToCents(taxLineBases[index] ?? "");
    const vatCents = parseMoneyToCents(taxLineVatAmounts[index] ?? "");

    if (!rate || baseCents === null || vatCents === null) {
      redirectKifEntry(kifBook.id, "kif_iznosi");
    }

    if (baseCents === 0 && vatCents === 0) {
      continue;
    }

    baseTotalCents += baseCents;
    vatTotalCents += vatCents;
    taxLines.push({
      vat_rate_id: rate.id,
      vat_rate_code: rate.sifra,
      vat_rate_name: rate.naziv,
      vat_rate_percent: rate.procenat,
      tax_base: centsToDecimal(baseCents),
      output_vat_amount: centsToDecimal(vatCents),
      total_with_vat: centsToDecimal(baseCents + vatCents),
      created_by: user.id
    });
  }

  if (taxLines.length === 0 || baseTotalCents + vatTotalCents <= 0) {
    redirectKifEntry(kifBook.id, "kif_iznosi");
  }

  if (baseTotalCents + vatTotalCents !== invoiceTotalCents) {
    redirectKifEntry(kifBook.id, "kif_ukupno");
  }

  if (vatTransactionType === vatTransactionTypes.export && vatTotalCents !== 0) {
    redirectKifEntry(kifBook.id, "kif_export_pdv");
  }

  const createdEntry = await prisma.$transaction(async (tx) => {
    let revenueAccount: { id: string } | null = null;

    if (revenueAccountCode) {
      revenueAccount = await resolveCompanyAccount(tx, firma.id, revenueAccountCode);

      if (!revenueAccount) {
        return null;
      }
    }

    const lastEntry = await tx.kifEntry.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastEntry?.redni_broj ?? 0) + 1;
    const internalNumber = `KIF-${poslovnaGodina.godina}-${String(redniBroj).padStart(4, "0")}`;

    return tx.kifEntry.create({
      data: {
        kif_book_id: kifBook.id,
        agencija_id: user.agencija_id!,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        kupac_id: buyer.id,
        redni_broj: redniBroj,
        internal_kif_number: internalNumber,
        customer_invoice_number: customerInvoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        vat_transaction_type: vatTransactionType,
        is_export: vatTransactionType === "EXPORT",
        export_declaration_number:
          vatTransactionType === "EXPORT" ? nullableValue(formData, "export_declaration_number") : null,
        export_declaration_date:
          vatTransactionType === "EXPORT" ? parseDate(formData, "export_declaration_date") : null,
        total_base: centsToDecimal(baseTotalCents),
        total_output_vat: centsToDecimal(vatTotalCents),
        total_gross: centsToDecimal(invoiceTotalCents),
        revenue_account_id: revenueAccount?.id,
        note,
        created_by: user.id,
        updated_by: user.id,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        id: true,
        internal_kif_number: true,
        customer_invoice_number: true,
        total_gross: true
      }
    });
  });

  if (!createdEntry) {
    redirectKifEntry(kifBook.id, "kif_konto");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kif",
    akcija: "create",
    tipEntiteta: "KifEntry",
    entitetId: createdEntry.id,
    novaVrijednost: createdEntry
  });

  revalidatePath("/agencija/racuni/kif");
  revalidatePath("/agencija/racuni/pregled-kif");
  revalidatePath(`/agencija/racuni/kif/${kifBook.id}`);
  redirectKifEntry(kifBook.id, "kif_sacuvan");
}

export async function updateKifEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKif("kif_kontekst");
  }

  const kifBookId = value(formData, "kif_book_id");
  const kifEntryId = value(formData, "kif_entry_id");
  const buyerId = value(formData, "kupac_id");
  const customerInvoiceNumber = normalizeFiscalInvoiceNumber(value(formData, "customer_invoice_number"));
  const invoiceDate = parseDate(formData, "invoice_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const revenueAccountCode = value(formData, "revenue_account_code");
  const submittedVatTransactionType = value(formData, "vat_transaction_type");

  if (
    !buyerId ||
    !kifBookId ||
    !kifEntryId ||
    !customerInvoiceNumber ||
    !invoiceDate ||
    invoiceTotalCents === null ||
    invoiceTotalCents <= 0
  ) {
    redirectKifEntry(kifBookId, "kif_obavezno");
  }

  const [firma, poslovnaGodina, buyer, existingEntry] = await Promise.all([
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
        id: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        zakljucena: true
      }
    }),
    prisma.komitent.findFirst({
      where: {
        id: buyerId,
        aktivan: true,
        OR: [
          {
            scope: "GLOBAL"
          },
          {
            scope: "AGENCY",
            agencija_id: user.agencija_id
          },
          {
            scope: "COMPANY",
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        is_foreign: true
      }
    }),
    prisma.kifEntry.findFirst({
      where: {
        id: kifEntryId,
        kif_book_id: kifBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        posting_status: true,
        journal_id: true
      }
    })
  ]);

  if (
    !firma ||
    !poslovnaGodina ||
    poslovnaGodina.zakljucena ||
    !buyer ||
    !existingEntry ||
    existingEntry.posting_status !== "UNPOSTED" ||
    existingEntry.journal_id
  ) {
    redirectKifEntry(kifBookId, "kif_greska");
  }

  await requireInvoicePermission(
    user,
    firma.id,
    invoicePostingDocumentTypes.kif,
    "update",
    (message) => redirectKifEntry(kifBookId, message)
  );

  const kifBook = await prisma.kifBook.findFirst({
    where: {
      id: kifBookId,
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      status: "OPEN",
      is_deleted: false
    },
    select: {
      id: true,
      racun_vrsta_id: true,
      racun_vrsta: {
        select: {
          dokument_tip: true,
          kontiranjePravila: {
            where: {
              aktivno: true
            },
            select: {
              polje_sifra: true,
              konto_izvor: true,
              sifra_konta: true
            }
          }
        }
      }
    }
  });

  if (!kifBook) {
    redirectKif("kif_knjiga");
  }

  const duplicateCustomerEntry = await prisma.kifEntry.findFirst({
    where: {
      firma_id: firma.id,
      kupac_id: buyer.id,
      customer_invoice_number: customerInvoiceNumber,
      invoice_date: invoiceDate,
      is_deleted: false,
      NOT: {
        id: existingEntry.id
      }
    },
    select: {
      id: true
    }
  });

  if (duplicateCustomerEntry) {
    redirectKifEntry(kifBook.id, "kif_dupli_broj");
  }

  const vatTransactionType = normalizeVatTransactionType(
    submittedVatTransactionType,
    invoicePostingDocumentTypes.kif,
    buyer.is_foreign
  );

  const activeRates = await prisma.pdvStopa.findMany({
    where: {
      agencija_id: user.agencija_id,
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
      id: true,
      sifra: true,
      naziv: true,
      procenat: true
    }
  });

  const fields = invoicePostingFields(kifBook.racun_vrsta.dokument_tip, activeRates);
  const fieldRules = new Map(
    kifBook.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
  );
  const baseFields = fields.filter(
    (field) => field.code.startsWith("OSNOVICA_") || field.code.startsWith("OSLOBODJENO_")
  );
  const requiresRevenueAccount = baseFields.some((field) => {
    const rule = fieldRules.get(field.code);

    return (rule?.konto_izvor ?? field.accountSource) === invoicePostingAccountSources.inputExpense;
  });

  if (requiresRevenueAccount && !revenueAccountCode) {
    redirectKifEntry(kifBook.id, "kif_konto_obavezan");
  }

  const taxLineRateIds = formData.getAll("vat_rate_id").map((entry) => String(entry));
  const taxLineBases = formData.getAll("tax_base").map((entry) => String(entry));
  const taxLineVatAmounts = formData.getAll("output_vat_amount").map((entry) => String(entry));

  const ratesById = new Map(activeRates.map((rate) => [rate.id, rate]));
  const taxLines: Prisma.KifEntryTaxLineCreateManyKif_entryInput[] = [];
  let baseTotalCents = 0;
  let vatTotalCents = 0;

  for (let index = 0; index < taxLineRateIds.length; index += 1) {
    const rate = ratesById.get(taxLineRateIds[index]);
    const baseCents = parseMoneyToCents(taxLineBases[index] ?? "");
    const vatCents = parseMoneyToCents(taxLineVatAmounts[index] ?? "");

    if (!rate || baseCents === null || vatCents === null) {
      redirectKifEntry(kifBook.id, "kif_iznosi");
    }

    if (baseCents === 0 && vatCents === 0) {
      continue;
    }

    baseTotalCents += baseCents;
    vatTotalCents += vatCents;
    taxLines.push({
      vat_rate_id: rate.id,
      vat_rate_code: rate.sifra,
      vat_rate_name: rate.naziv,
      vat_rate_percent: rate.procenat,
      tax_base: centsToDecimal(baseCents),
      output_vat_amount: centsToDecimal(vatCents),
      total_with_vat: centsToDecimal(baseCents + vatCents),
      created_by: user.id
    });
  }

  if (taxLines.length === 0 || baseTotalCents + vatTotalCents <= 0) {
    redirectKifEntry(kifBook.id, "kif_iznosi");
  }

  if (Math.abs(baseTotalCents + vatTotalCents - invoiceTotalCents) > 1) {
    redirectKifEntry(kifBook.id, "kif_ukupno");
  }

  if (vatTransactionType === vatTransactionTypes.export && vatTotalCents !== 0) {
    redirectKifEntry(kifBook.id, "kif_export_pdv");
  }

  const updatedEntry = await prisma.$transaction(async (tx) => {
    let revenueAccount: { id: string } | null = null;

    if (revenueAccountCode) {
      revenueAccount = await resolveCompanyAccount(tx, firma.id, revenueAccountCode);

      if (!revenueAccount) {
        return null;
      }
    }

    await tx.kifEntryTaxLine.deleteMany({
      where: {
        kif_entry_id: existingEntry.id
      }
    });

    return tx.kifEntry.update({
      where: {
        id: existingEntry.id
      },
      data: {
        kupac_id: buyer.id,
        customer_invoice_number: customerInvoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        vat_transaction_type: vatTransactionType,
        is_export: vatTransactionType === "EXPORT",
        export_declaration_number:
          vatTransactionType === "EXPORT" ? nullableValue(formData, "export_declaration_number") : null,
        export_declaration_date:
          vatTransactionType === "EXPORT" ? parseDate(formData, "export_declaration_date") : null,
        total_base: centsToDecimal(baseTotalCents),
        total_output_vat: centsToDecimal(vatTotalCents),
        total_gross: centsToDecimal(invoiceTotalCents),
        revenue_account_id: revenueAccount?.id,
        note,
        updated_by: user.id,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        id: true,
        internal_kif_number: true,
        customer_invoice_number: true,
        total_gross: true
      }
    });
  });

  if (!updatedEntry) {
    redirectKifEntry(kifBook.id, "kif_konto");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.racuni.kif",
    akcija: "update",
    tipEntiteta: "KifEntry",
    entitetId: updatedEntry.id,
    novaVrijednost: updatedEntry
  });

  revalidatePath("/agencija/racuni/kif");
  revalidatePath("/agencija/racuni/pregled-kif");
  revalidatePath(`/agencija/racuni/kif/${kifBook.id}`);
  redirectKifEntry(kifBook.id, "kif_izmijenjen");
}

export async function deleteKifEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKif("kif_kontekst");
  }

  const kifBookId = value(formData, "kif_book_id");
  const kifEntryId = value(formData, "kif_entry_id");

  if (!kifBookId || !kifEntryId) {
    redirectKifEntry(kifBookId, "kif_greska");
  }

  const [poslovnaGodina, kifBook, entry] = await Promise.all([
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        zakljucena: true
      }
    }),
    prisma.kifBook.findFirst({
      where: {
        id: kifBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        status: true
      }
    }),
    prisma.kifEntry.findFirst({
      where: {
        id: kifEntryId,
        kif_book_id: kifBookId,
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      select: {
        id: true,
        posting_status: true,
        journal_id: true,
        internal_kif_number: true
      }
    })
  ]);

  if (
    !poslovnaGodina ||
    poslovnaGodina.zakljucena ||
    !kifBook ||
    kifBook.status !== "OPEN" ||
    !entry ||
    entry.posting_status !== "UNPOSTED" ||
    entry.journal_id
  ) {
    redirectKifEntry(kifBookId, "kif_greska");
  }

  await requireInvoicePermission(
    user,
    workContext.firmaId,
    invoicePostingDocumentTypes.kif,
    "delete",
    (message) => redirectKifEntry(kifBookId, message)
  );

  const deletedEntry = await prisma.kifEntry.update({
    where: {
      id: entry.id
    },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: user.id,
      delete_reason: "Korisnik je obrisao račun iz KIF knjige.",
      updated_by: user.id
    },
    select: {
      id: true,
      internal_kif_number: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: workContext.firmaId,
    modul: "agencija.racuni.kif",
    akcija: "delete",
    tipEntiteta: "KifEntry",
    entitetId: deletedEntry.id,
    novaVrijednost: deletedEntry
  });

  revalidatePath("/agencija/racuni/kif");
  revalidatePath("/agencija/racuni/pregled-kif");
  revalidatePath(`/agencija/racuni/kif/${kifBook.id}`);
  redirectKifEntry(kifBook.id, "kif_obrisan");
}
