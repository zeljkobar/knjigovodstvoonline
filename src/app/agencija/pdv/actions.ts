"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import {
  calculatePdvReturn,
  findOrCreatePdvPeriod,
  normalizePdvMonth,
  requirePdvContext
} from "@/lib/pdv-service";
import {
  calculatePdvPostingAmounts,
  parseMoneyInput,
  pdvMonths,
  pdvReturnStatuses,
  periodLabel
} from "@/lib/pdv";
import { prisma } from "@/lib/prisma";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableId(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function redirectPdv(path: string, message: string, month?: number): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (month) {
    params.set("mjesec", String(month));
  }

  redirect(`${path}?${params.toString()}`);
}

async function resolveCompanyAccountId(firmaId: string, selectedValue: string) {
  const [source, id] = selectedValue.split(":");

  if (!source || !id) {
    return null;
  }

  if (source === "company") {
    const account = await prisma.firmaKonto.findFirst({
      where: {
        id,
        firma_id: firmaId,
        aktivan: true
      },
      select: {
        id: true
      }
    });

    return account?.id ?? null;
  }

  if (source !== "base") {
    return null;
  }

  const baseAccount = await prisma.konto.findFirst({
    where: {
      id,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true
    }
  });

  if (!baseAccount) {
    return null;
  }

  const existingCompanyAccount = await prisma.firmaKonto.findFirst({
    where: {
      firma_id: firmaId,
      OR: [
        {
          konto_id: baseAccount.id
        },
        {
          sifra: baseAccount.sifra
        }
      ]
    },
    select: {
      id: true,
      aktivan: true,
      override_type: true
    }
  });

  if (existingCompanyAccount) {
    if (!existingCompanyAccount.aktivan || existingCompanyAccount.override_type === accountOverrideTypes.deactivated) {
      return null;
    }

    return existingCompanyAccount.id;
  }

  const companyAccount = await prisma.firmaKonto.create({
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
      override_type: accountOverrideTypes.baseLink
    },
    select: {
      id: true
    }
  });

  return companyAccount.id;
}

async function nextJournalNumber(firmaId: string, poslovnaGodinaId: string, journalTypeId: string) {
  const lastJournal = await prisma.nalog.findFirst({
    where: {
      firma_id: firmaId,
      poslovna_godina_id: poslovnaGodinaId,
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

export async function ensurePdvPeriods() {
  const context = await requirePdvContext("manage");

  for (let month = 1; month <= 12; month += 1) {
    await findOrCreatePdvPeriod({
      agencijaId: context.agencijaId,
      firmaId: context.firma.id,
      poslovnaGodinaId: context.poslovnaGodina.id,
      godina: context.poslovnaGodina.godina,
      mjesec: month,
      userId: context.user.id
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "periodi_generisani",
    tipEntiteta: "PdvPeriod",
    napomena: `Kreirani/osvježeni PDV periodi za ${context.poslovnaGodina.godina}.`
  });

  revalidatePath("/agencija/pdv");
  redirectPdv("/agencija/pdv", "periodi_generisani");
}

export async function refreshPdvReturn(formData: FormData) {
  const context = await requirePdvContext("update");
  const month = normalizePdvMonth(value(formData, "mjesec"));
  const period = await findOrCreatePdvPeriod({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month,
    userId: context.user.id
  });

  if (period.status === "LOCKED") {
    redirectPdv("/agencija/pdv/prijava", "period_zakljucan", month);
  }

  const calculation = await calculatePdvReturn({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month
  });

  const prijava = await prisma.pdvPrijava.upsert({
    where: {
      pdv_period_id: period.id
    },
    update: {
      total_output_vat: calculation.totals.totalOutput,
      total_input_vat: calculation.totals.totalInput,
      deductible_vat: calculation.totals.deductible,
      non_deductible_vat: calculation.totals.nonDeductible,
      payable_vat: calculation.totals.payable,
      credit_vat: calculation.totals.credit,
      updated_by: context.user.id
    },
    create: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id,
      pdv_period_id: period.id,
      total_output_vat: calculation.totals.totalOutput,
      total_input_vat: calculation.totals.totalInput,
      deductible_vat: calculation.totals.deductible,
      non_deductible_vat: calculation.totals.nonDeductible,
      payable_vat: calculation.totals.payable,
      credit_vat: calculation.totals.credit,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  for (const row of calculation.rows) {
    await prisma.pdvPrijavaStavka.upsert({
      where: {
        pdv_prijava_id_sifra_kolona: {
          pdv_prijava_id: prijava.id,
          sifra: row.sifra,
          kolona: row.kolona
        }
      },
      update: {
        opis: row.opis,
        redosljed: row.redosljed,
        sistemska_vrijednost: row.value
      },
      create: {
        pdv_prijava_id: prijava.id,
        sifra: row.sifra,
        opis: row.opis,
        kolona: row.kolona,
        redosljed: row.redosljed,
        sistemska_vrijednost: row.value
      }
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "prijava_osvjezena",
    tipEntiteta: "PdvPrijava",
    entitetId: prijava.id,
    novaVrijednost: {
      mjesec: month,
      totalOutput: calculation.totals.totalOutput,
      deductible: calculation.totals.deductible
    }
  });

  revalidatePath("/agencija/pdv/prijava");
  redirectPdv("/agencija/pdv/prijava", "prijava_osvjezena", month);
}

export async function savePdvReturn(formData: FormData) {
  const context = await requirePdvContext("update");
  const month = normalizePdvMonth(value(formData, "mjesec"));
  const prijavaId = value(formData, "prijava_id");

  const prijava = await prisma.pdvPrijava.findFirst({
    where: {
      id: prijavaId,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id
    },
    select: {
      id: true,
      status: true,
      stavke: {
        select: {
          id: true,
          sifra: true,
          kolona: true
        }
      },
      journal: {
        select: {
          is_deleted: true
        }
      }
    }
  });

  const hasActiveJournal = Boolean(prijava?.journal && !prijava.journal.is_deleted);

  if (
    !prijava ||
    prijava.status === pdvReturnStatuses.locked ||
    (prijava.status === pdvReturnStatuses.posted && hasActiveJournal)
  ) {
    redirectPdv("/agencija/pdv/prijava", "prijava_zakljucana", month);
  }

  const savedValues = new Map<string, number>();

  for (const row of prijava.stavke) {
    const key = `${row.sifra}_${row.kolona}`;
    const manualValue = parseMoneyInput(value(formData, `vrijednost_${key}`));

    if (manualValue === null) {
      redirectPdv("/agencija/pdv/prijava", "prijava_iznos", month);
    }

    savedValues.set(key, manualValue);

    await prisma.pdvPrijavaStavka.update({
      where: {
        id: row.id
      },
      data: {
        rucna_vrijednost: manualValue,
        razlog_korekcije: null
      }
    });
  }

  const outputTotal = savedValues.get("24_OUTPUT") ?? 0;
  const inputTotal = savedValues.get("25_INPUT") ?? 0;
  const nonDeductible = savedValues.get("26_INPUT") ?? 0;
  const deductible = savedValues.get("27_INPUT") ?? 0;
  const payable = savedValues.get("28_OUTPUT") ?? 0;
  const credit = savedValues.get("29_INPUT") ?? 0;

  await prisma.pdvPrijava.update({
    where: {
      id: prijava.id
    },
    data: {
      ...(hasActiveJournal
        ? {}
        : {
            status: pdvReturnStatuses.draft,
            journal_id: null,
            posted_at: null,
            posted_by: null
          }),
      total_output_vat: outputTotal,
      total_input_vat: inputTotal,
      deductible_vat: deductible,
      non_deductible_vat: nonDeductible,
      payable_vat: payable,
      credit_vat: credit,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "prijava_sacuvana",
    tipEntiteta: "PdvPrijava",
    entitetId: prijava.id
  });

  revalidatePath("/agencija/pdv/prijava");
  redirectPdv("/agencija/pdv/prijava", "prijava_sacuvana", month);
}

export async function savePdvSettings(formData: FormData) {
  const context = await requirePdvContext("manage");
  const fieldCodes = formData.getAll("polje_sifra").map((item) => String(item));
  const fieldNames = formData.getAll("polje_naziv").map((item) => String(item));
  const vatRateCodes = formData.getAll("pdv_stopa_sifra").map((item) => String(item));
  const orders = formData.getAll("redosljed").map((item) => Number(item));
  const directions = formData.getAll("smjer").map((item) => String(item).toUpperCase());
  const accountIds = formData.getAll("konto_id").map((item) => String(item));

  const settings = await prisma.pdvPodesavanja.upsert({
    where: {
      firma_id_poslovna_godina_id: {
        firma_id: context.firma.id,
        poslovna_godina_id: context.poslovnaGodina.id
      }
    },
    update: {
      vrsta_naloga_id: nullableId(formData, "vrsta_naloga_id"),
      opis_naloga: value(formData, "opis_naloga") || "PDV prijava za period {period}",
      updated_by: context.user.id
    },
    create: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id,
      vrsta_naloga_id: nullableId(formData, "vrsta_naloga_id"),
      opis_naloga: value(formData, "opis_naloga") || "PDV prijava za period {period}",
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  for (let index = 0; index < fieldCodes.length; index += 1) {
    const code = fieldCodes[index];

    if (!code) {
      continue;
    }

    const accountId = await resolveCompanyAccountId(context.firma.id, accountIds[index] ?? "");

    await prisma.pdvPodesavanjePravilo.upsert({
      where: {
        pdv_podesavanja_id_polje_sifra: {
          pdv_podesavanja_id: settings.id,
          polje_sifra: code
        }
      },
      update: {
        polje_naziv: fieldNames[index] ?? code,
        pdv_stopa_sifra: vatRateCodes[index] || null,
        smjer: directions[index] === "P" ? "P" : "D",
        konto_id: accountId,
        redosljed: Number.isFinite(orders[index]) ? orders[index] : index
      },
      create: {
        pdv_podesavanja_id: settings.id,
        polje_sifra: code,
        polje_naziv: fieldNames[index] ?? code,
        pdv_stopa_sifra: vatRateCodes[index] || null,
        smjer: directions[index] === "P" ? "P" : "D",
        konto_id: accountId,
        redosljed: Number.isFinite(orders[index]) ? orders[index] : index
      }
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "podesavanja_sacuvana",
    tipEntiteta: "PdvPodesavanja"
  });

  revalidatePath("/agencija/pdv/podesavanja");
  redirectPdv("/agencija/pdv/podesavanja", "podesavanja_sacuvana");
}

function rowValue(rows: Array<{ sifra: string; kolona: string; sistemska_vrijednost: unknown; rucna_vrijednost: unknown }>, sifra: string, kolona: string) {
  const row = rows.find((item) => item.sifra === sifra && item.kolona === kolona);
  const value = row?.rucna_vrijednost ?? row?.sistemska_vrijednost ?? 0;

  return Number(value.toString());
}

function postingLine({
  accountId,
  amount,
  description,
  direction
}: {
  accountId: string;
  amount: number;
  description: string;
  direction: string;
}) {
  return {
    konto_id: accountId,
    duguje: direction === "D" ? amount : 0,
    potrazuje: direction === "P" ? amount : 0,
    opis: description
  };
}

export async function postPdvReturn(formData: FormData) {
  const context = await requirePdvContext("post");
  const month = normalizePdvMonth(value(formData, "mjesec"));
  const prijavaId = value(formData, "prijava_id");

  const [settings, prijava] = await Promise.all([
    prisma.pdvPodesavanja.findUnique({
      where: {
        firma_id_poslovna_godina_id: {
          firma_id: context.firma.id,
          poslovna_godina_id: context.poslovnaGodina.id
        }
      },
      include: {
        vrsta_naloga: true,
        pravila: {
          where: {
            aktivno: true,
            konto_id: {
              not: null
            }
          },
          include: {
            konto: true
          },
          orderBy: {
            redosljed: "asc"
          }
        }
      }
    }),
    prisma.pdvPrijava.findFirst({
      where: {
        id: prijavaId,
        agencija_id: context.agencijaId,
        firma_id: context.firma.id,
        poslovna_godina_id: context.poslovnaGodina.id
      },
      include: {
        stavke: true,
        journal: {
          select: {
            is_deleted: true
          }
        }
      }
    })
  ]);

  if (!settings?.vrsta_naloga || settings.pravila.length === 0) {
    redirectPdv("/agencija/pdv/prijava", "knjizenje_podesavanja", month);
  }

  const hasActiveJournal = Boolean(prijava?.journal_id && prijava.journal && !prijava.journal.is_deleted);

  if (!prijava || hasActiveJournal) {
    redirectPdv("/agencija/pdv/prijava", "knjizenje_prijava", month);
  }

  const output = rowValue(prijava.stavke, "24", "OUTPUT");
  const deductible = rowValue(prijava.stavke, "27", "INPUT");
  const payable = rowValue(prijava.stavke, "28", "OUTPUT");
  const credit = rowValue(prijava.stavke, "29", "INPUT");

  if (output === 0 && deductible === 0) {
    redirectPdv("/agencija/pdv/prijava", "knjizenje_nema_iznosa", month);
  }

  const number = await nextJournalNumber(context.firma.id, context.poslovnaGodina.id, settings.vrsta_naloga.id);
  const code = formatJournalCode(settings.vrsta_naloga.prefiks, context.poslovnaGodina.godina, number);
  const description = settings.opis_naloga.replace("{period}", periodLabel(month, context.poslovnaGodina.godina));
  const journalDate = new Date(Date.UTC(context.poslovnaGodina.godina, month, 0));
  const calculation = await calculatePdvReturn({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month
  });
  const amountMap = calculatePdvPostingAmounts(calculation.kifBooks, calculation.kufBooks);
  amountMap.set("VAT_PAYABLE", payable);
  amountMap.set("VAT_CREDIT", credit);
  const lines = settings.pravila
    .map((rule) => {
      const amount = amountMap.get(rule.polje_sifra) ?? 0;

      if (!rule.konto || amount <= 0) {
        return null;
      }

      return postingLine({
        accountId: rule.konto.id,
        amount,
        description: rule.polje_naziv,
        direction: rule.smjer
      });
    })
    .filter((line): line is ReturnType<typeof postingLine> => line !== null);
  const debitTotal = lines.reduce((sum, line) => sum + line.duguje, 0);
  const creditTotal = lines.reduce((sum, line) => sum + line.potrazuje, 0);

  if (Math.round(debitTotal * 100) !== Math.round(creditTotal * 100)) {
    redirectPdv("/agencija/pdv/prijava", "knjizenje_nebalansirano", month);
  }

  const journal = await prisma.$transaction(async (tx) => {
    const nalog = await tx.nalog.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: context.firma.id,
        poslovna_godina_id: context.poslovnaGodina.id,
        vrsta_naloga_id: settings.vrsta_naloga!.id,
        broj: number,
        sifra: code,
        datum: journalDate,
        datum_knjizenja: journalDate,
        opis: description,
        status: journalStatuses.posted,
        source_type: "PDV_RETURN",
        source_module: "PDV",
        izvorni_dokument_id: prijava.id,
        kreirao_korisnik_id: context.user.id,
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;

      await tx.stavkaNaloga.create({
        data: {
          nalog_id: nalog.id,
          konto_id: line.konto_id,
          duguje: line.duguje,
          potrazuje: line.potrazuje,
          opis: line.opis,
          broj_dokumenta: `PDV ${pdvMonths[month - 1]} ${context.poslovnaGodina.godina}`,
          datum_dokumenta: journalDate,
          redni_broj: index + 1
        }
      });
    }

    await tx.pdvPrijava.update({
      where: {
        id: prijava.id
      },
      data: {
        status: pdvReturnStatuses.posted,
        journal_id: nalog.id,
        posted_at: new Date(),
        posted_by: context.user.id,
        updated_by: context.user.id
      }
    });

    return nalog;
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "prijava_proknjizena",
    tipEntiteta: "PdvPrijava",
    entitetId: prijava.id,
    novaVrijednost: {
      journalId: journal.id,
      journalCode: journal.sifra
    }
  });

  revalidatePath("/agencija/pdv/prijava");
  redirectPdv("/agencija/pdv/prijava", "prijava_proknjizena", month);
}
