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
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

function percentToNumber(value: { toString(): string }) {
  const parsed = Number(value.toString());

  return Number.isFinite(parsed) ? parsed : 0;
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

  if (!typeId) {
    redirectInvoiceSettings("sema_vrsta");
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

  const [baseAccounts, companyOverrides, activeVatRates] = await Promise.all([
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
    })
  ]);

  if (activeVatRates.length === 0) {
    redirectInvoiceSettings("sema_pdv");
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

  const savedRules = await prisma.$transaction(
    rules.map((rule) =>
      prisma.racunKontiranjePravilo.upsert({
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
  const supplierInvoiceNumber = value(formData, "supplier_invoice_number");
  const invoiceDate = parseDate(formData, "invoice_date");
  const receiptDate = parseDate(formData, "receipt_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const expenseAccountCode = value(formData, "expense_account_code");

  if (
    !supplierId ||
    !kufBookId ||
    !supplierInvoiceNumber ||
    !invoiceDate ||
    !receiptDate ||
    !expenseAccountCode ||
    invoiceTotalCents === null ||
    invoiceTotalCents <= 0
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
        pib: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !supplier) {
    if (kufBookId) {
      redirectKufEntry(kufBookId, "kuf_greska");
    }

    redirectKuf("kuf_greska");
  }

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

  const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
  const baseValues = formData.getAll("tax_base").map((item) => String(item));
  const vatValues = formData.getAll("input_vat_amount").map((item) => String(item));
  const nonDeductibleValues = formData
    .getAll("non_deductible_vat_amount")
    .map((item) => String(item));

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
  const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
  let totalBaseCents = 0;
  let totalInputVatCents = 0;
  let deductibleVatCents = 0;
  let nonDeductibleVatCents = 0;

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
      total_with_vat: centsToDecimal(baseCents + inputVatCents),
      created_by: user.id
    });
  }

  if (taxLines.length === 0 || totalBaseCents + totalInputVatCents <= 0) {
    redirectKufEntry(kufBook.id, "kuf_iznosi");
  }

  const calculatedGrossCents = totalBaseCents + totalInputVatCents;

  if (Math.abs(invoiceTotalCents - calculatedGrossCents) > 1) {
    redirectKufEntry(kufBook.id, "kuf_ukupno");
  }

  const kufEntry = await prisma.$transaction(async (tx) => {
    const expenseAccount = await resolveCompanyAccount(tx, firma.id, expenseAccountCode);

    if (!expenseAccount || !expenseAccount.sifra.startsWith("5")) {
      return null;
    }

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
        invoice_date: invoiceDate,
        receipt_date: receiptDate,
        due_date: dueDate,
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalInputVatCents),
        deductible_vat: centsToDecimal(deductibleVatCents),
        non_deductible_vat: centsToDecimal(nonDeductibleVatCents),
        total_gross: centsToDecimal(invoiceTotalCents),
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
  const supplierInvoiceNumber = value(formData, "supplier_invoice_number");
  const invoiceDate = parseDate(formData, "invoice_date");
  const receiptDate = parseDate(formData, "receipt_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const expenseAccountCode = value(formData, "expense_account_code");

  if (
    !supplierId ||
    !kufBookId ||
    !kufEntryId ||
    !supplierInvoiceNumber ||
    !invoiceDate ||
    !receiptDate ||
    !expenseAccountCode ||
    invoiceTotalCents === null ||
    invoiceTotalCents <= 0
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
        pib: true
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

  const vatRateIds = formData.getAll("vat_rate_id").map((item) => String(item));
  const baseValues = formData.getAll("tax_base").map((item) => String(item));
  const vatValues = formData.getAll("input_vat_amount").map((item) => String(item));
  const nonDeductibleValues = formData
    .getAll("non_deductible_vat_amount")
    .map((item) => String(item));

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
  const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
  let totalBaseCents = 0;
  let totalInputVatCents = 0;
  let deductibleVatCents = 0;
  let nonDeductibleVatCents = 0;

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
      total_with_vat: centsToDecimal(baseCents + inputVatCents),
      created_by: user.id
    });
  }

  if (taxLines.length === 0 || totalBaseCents + totalInputVatCents <= 0) {
    redirectKufEntry(kufBook.id, "kuf_iznosi");
  }

  const calculatedGrossCents = totalBaseCents + totalInputVatCents;

  if (Math.abs(invoiceTotalCents - calculatedGrossCents) > 1) {
    redirectKufEntry(kufBook.id, "kuf_ukupno");
  }

  const updatedEntry = await prisma.$transaction(async (tx) => {
    const expenseAccount = await resolveCompanyAccount(tx, firma.id, expenseAccountCode);

    if (!expenseAccount || !expenseAccount.sifra.startsWith("5")) {
      return null;
    }

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
        invoice_date: invoiceDate,
        receipt_date: receiptDate,
        due_date: dueDate,
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalInputVatCents),
        deductible_vat: centsToDecimal(deductibleVatCents),
        non_deductible_vat: centsToDecimal(nonDeductibleVatCents),
        total_gross: centsToDecimal(invoiceTotalCents),
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

export async function createKifEntry(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirectKif("kif_kontekst");
  }

  const kifBookId = value(formData, "kif_book_id");
  const buyerId = value(formData, "kupac_id");
  const customerInvoiceNumber = value(formData, "customer_invoice_number");
  const invoiceDate = parseDate(formData, "invoice_date");
  const dueDate = parseDate(formData, "due_date");
  const note = nullableValue(formData, "note");
  const invoiceTotalCents = parseMoneyToCents(value(formData, "invoice_total"));
  const revenueAccountCode = value(formData, "revenue_account_code");

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
        pib: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina || poslovnaGodina.zakljucena || !buyer) {
    redirectKifEntry(kifBookId, "kif_greska");
  }

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
