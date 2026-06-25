"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function redirectJournals(message: string, nalogId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (nalogId) {
    params.set("nalog", nalogId);
  }

  redirect(`/agencija/nalozi?${params.toString()}`);
}

function redirectNewJournal(message: string, detail?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (detail) {
    params.set("detalj", detail);
  }

  redirect(`/agencija/nalozi/novi?${params.toString()}`);
}

function redirectJournalDetail(
  nalogId: string,
  message: string,
  detail?: string
): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (detail) {
    params.set("detalj", detail);
  }

  redirect(`/agencija/nalozi/${nalogId}?${params.toString()}`);
}

function journalError(error: Error) {
  const [message, detail] = error.message.split(":");

  return {
    message: message || "nalog_greska",
    detail
  };
}

function parseDate(formData: FormData, key: string) {
  const data = value(formData, key);

  if (!data) {
    return null;
  }

  return new Date(`${data}T00:00:00.000Z`);
}

function parseLineDate(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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

function parseJournalLines(formData: FormData) {
  const accountCodes = formData.getAll("konto_sifra").map((item) => String(item).trim());
  const descriptions = formData.getAll("stavka_opis").map((item) => String(item).trim());
  const documentNumbers = formData.getAll("broj_dokumenta").map((item) => String(item).trim());
  const documentDates = formData.getAll("datum_dokumenta").map((item) => String(item).trim());
  const dueDates = formData.getAll("datum_valute").map((item) => String(item).trim());
  const debitValues = formData.getAll("duguje").map((item) => String(item));
  const creditValues = formData.getAll("potrazuje").map((item) => String(item));
  const partnerIds = formData.getAll("komitent_id").map((item) => String(item).trim());
  const lines = [];

  for (let index = 0; index < accountCodes.length; index += 1) {
    const accountCode = accountCodes[index] ?? "";
    const description = descriptions[index] ?? "";
    const documentNumber = documentNumbers[index] || null;
    const documentDate = parseLineDate(documentDates[index] ?? "");
    const dueDate = parseLineDate(dueDates[index] ?? "");
    const debit = parseMoneyToCents(debitValues[index] ?? "");
    const credit = parseMoneyToCents(creditValues[index] ?? "");
    const partnerId = partnerIds[index] || null;

    if (
      !accountCode &&
      !partnerId &&
      !description &&
      !documentNumber &&
      !documentDates[index] &&
      !dueDates[index] &&
      !debitValues[index] &&
      !creditValues[index]
    ) {
      continue;
    }

    if (
      !accountCode ||
      debit === null ||
      credit === null ||
      documentDate === undefined ||
      dueDate === undefined
    ) {
      return {
        error: "stavke_nevalidne" as const,
        lines: []
      };
    }

    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      return {
        error: "stavka_iznos" as const,
        lines: []
      };
    }

    lines.push({
      accountCode,
      description,
      documentDate,
      documentNumber,
      dueDate,
      debit,
      credit,
      partnerId,
      lineNumber: lines.length + 1
    });
  }

  if (lines.length === 0) {
    return {
      error: "stavke_obavezne" as const,
      lines: []
    };
  }

  return {
    error: null,
    lines
  };
}

async function getUserCompanyAccess(firmaId: string, poslovnaGodinaId?: string) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id) {
    return {
      user,
      firma: null,
      poslovnaGodina: null
    };
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: firmaId,
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
      naziv: true,
      agencija_id: true
    }
  });

  const poslovnaGodina =
    firma && poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: poslovnaGodinaId,
            firma_id: firma.id
          },
          select: {
            id: true,
            godina: true,
            zakljucena: true
          }
        })
      : null;

  return {
    user,
    firma,
    poslovnaGodina
  };
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
      konto_id: true,
      sifra: true,
      naziv: true,
      analitika_obavezna: true,
      override_type: true,
      aktivan: true
    }
  });

  if (companyAccount) {
    if (
      !companyAccount.aktivan ||
      companyAccount.override_type === accountOverrideTypes.deactivated
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

  if (!baseAccount?.aktivan) {
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
      konto_id: true,
      sifra: true,
      naziv: true,
      analitika_obavezna: true,
      override_type: true,
      aktivan: true
    }
  });
}

export async function createJournal(formData: FormData) {
  const firmaId = value(formData, "firma_id");
  const poslovnaGodinaId = value(formData, "poslovna_godina_id");
  const vrstaNalogaId = value(formData, "vrsta_naloga_id");
  const datum = parseDate(formData, "datum");
  const opis = nullableValue(formData, "opis");
  const { user, firma, poslovnaGodina } = await getUserCompanyAccess(
    firmaId,
    poslovnaGodinaId
  );

  if (!firma || !poslovnaGodina || !vrstaNalogaId || !datum) {
    redirectNewJournal("nalog_obavezno");
  }

  if (poslovnaGodina.zakljucena) {
    redirectNewJournal("godina_zakljucena");
  }

  const parsedLines = parseJournalLines(formData);

  if (parsedLines.error) {
    redirectNewJournal(parsedLines.error);
  }

  const journal = await prisma.$transaction(async (tx) => {
    const journalType = await tx.vrstaNaloga.findFirst({
      where: {
        id: vrstaNalogaId,
        aktivan: true,
        OR: [
          {
            sistemska: true
          },
          {
            agencija_id: firma.agencija_id
          },
          {
            firma_id: firma.id
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        prefiks: true
      }
    });

    if (!journalType) {
      throw new Error("vrsta_nevalidna");
    }

    const lastJournal = await tx.nalog.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        vrsta_naloga_id: journalType.id
      },
      orderBy: {
        broj: "desc"
      },
      select: {
        broj: true
      }
    });
    const broj = (lastJournal?.broj ?? 0) + 1;
    const sifra = formatJournalCode(journalType.prefiks, poslovnaGodina.godina, broj);

    const nalog = await tx.nalog.create({
      data: {
        agencija_id: firma.agencija_id,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        vrsta_naloga_id: journalType.id,
        broj,
        sifra,
        datum,
        opis,
        status: journalStatuses.draft,
        source_type: "MANUAL",
        source_module: "MANUAL",
        kreirao_korisnik_id: user.id,
        created_by: user.id,
        updated_by: user.id
      },
      select: {
        id: true,
        sifra: true,
        broj: true,
        status: true
      }
    });

    for (const line of parsedLines.lines) {
      const account = await resolveCompanyAccount(
        tx,
        firma.id,
        line.accountCode
      );

      if (!account) {
        throw new Error("konto_nevalidno");
      }

      if (account.analitika_obavezna && !line.partnerId) {
        throw new Error(`partner_obavezan:${account.sifra}`);
      }

      await tx.stavkaNaloga.create({
        data: {
          nalog_id: nalog.id,
          konto_id: account.id,
          komitent_id: line.partnerId,
          duguje: centsToDecimal(line.debit),
          potrazuje: centsToDecimal(line.credit),
          opis: line.description || opis,
          broj_dokumenta: line.documentNumber,
          datum_dokumenta: line.documentDate,
          datum_valute: line.dueDate,
          redni_broj: line.lineNumber,
          created_by: user.id,
          updated_by: user.id
        }
      });
    }

    return nalog;
  }).catch((error) => {
    if (error instanceof Error) {
      const parsedError = journalError(error);

      redirectNewJournal(parsedError.message, parsedError.detail);
    }

    redirectNewJournal("nalog_greska");
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: firma.agencija_id,
    firmaId: firma.id,
    modul: "agencija.nalozi",
    akcija: "create",
    tipEntiteta: "Nalog",
    entitetId: journal.id,
    novaVrijednost: journal
  });

  revalidatePath("/agencija/nalozi");
  redirectJournalDetail(journal.id, "nalog_kreiran");
}

export async function updateDraftJournalLines(formData: FormData) {
  const nalogId = value(formData, "nalog_id");
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id || !nalogId) {
    redirectJournals("nalog_greska");
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id: nalogId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      status: true,
      poslovna_godina: {
        select: {
          zakljucena: true
        }
      }
    }
  });

  if (!nalog || nalog.status !== journalStatuses.draft) {
    redirectJournals("nalog_greska");
  }

  if (nalog.poslovna_godina.zakljucena) {
    redirectJournalDetail(nalog.id, "godina_zakljucena");
  }

  const parsedLines = parseJournalLines(formData);

  if (parsedLines.error) {
    redirectJournalDetail(nalog.id, parsedLines.error);
  }

  await prisma.$transaction(async (tx) => {
    await tx.stavkaNaloga.deleteMany({
      where: {
        nalog_id: nalog.id
      }
    });

    for (const line of parsedLines.lines) {
      const account = await resolveCompanyAccount(
        tx,
        nalog.firma_id,
        line.accountCode
      );

      if (!account) {
        throw new Error("konto_nevalidno");
      }

      if (account.analitika_obavezna && !line.partnerId) {
        throw new Error(`partner_obavezan:${account.sifra}`);
      }

      await tx.stavkaNaloga.create({
        data: {
          nalog_id: nalog.id,
          konto_id: account.id,
          komitent_id: line.partnerId,
          duguje: centsToDecimal(line.debit),
          potrazuje: centsToDecimal(line.credit),
          opis: line.description,
          broj_dokumenta: line.documentNumber,
          datum_dokumenta: line.documentDate,
          datum_valute: line.dueDate,
          redni_broj: line.lineNumber,
          created_by: user.id,
          updated_by: user.id
        }
      });
    }

    await tx.nalog.update({
      where: {
        id: nalog.id
      },
      data: {
        updated_by: user.id
      }
    });
  }).catch((error) => {
    if (error instanceof Error) {
      const parsedError = journalError(error);

      redirectJournalDetail(nalog.id, parsedError.message, parsedError.detail);
    }

    redirectJournalDetail(nalog.id, "nalog_greska");
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: nalog.firma_id,
    modul: "agencija.nalozi",
    akcija: "update_lines",
    tipEntiteta: "Nalog",
    entitetId: nalog.id
  });

  revalidatePath("/agencija/nalozi");
  revalidatePath(`/agencija/nalozi/${nalog.id}`);
  redirectJournalDetail(nalog.id, "stavke_sacuvane");
}

export async function postJournal(formData: FormData) {
  const nalogId = value(formData, "nalog_id");
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id || !nalogId) {
    redirectJournals("nalog_greska");
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id: nalogId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      status: true,
      poslovna_godina: {
        select: {
          zakljucena: true
        }
      },
      stavke: {
        select: {
          duguje: true,
          potrazuje: true
        }
      }
    }
  });

  if (!nalog || nalog.status !== journalStatuses.draft) {
    redirectJournals("nalog_greska");
  }

  if (nalog.poslovna_godina.zakljucena) {
    redirectJournalDetail(nalog.id, "godina_zakljucena");
  }

  const totalDebit = nalog.stavke.reduce(
    (sum, line) => sum + Math.round(Number(line.duguje) * 100),
    0
  );
  const totalCredit = nalog.stavke.reduce(
    (sum, line) => sum + Math.round(Number(line.potrazuje) * 100),
    0
  );

  if (totalDebit !== totalCredit || totalDebit === 0) {
    redirectJournalDetail(nalog.id, "nalog_nije_balansiran");
  }

  const postedJournal = await prisma.nalog.update({
    where: {
      id: nalog.id
    },
    data: {
      status: journalStatuses.posted,
      datum_knjizenja: new Date(),
      proknjizen_at: new Date(),
      proknjizen_by: user.id,
      updated_by: user.id
    },
    select: {
      id: true,
      firma_id: true,
      status: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: postedJournal.firma_id,
    modul: "agencija.nalozi",
    akcija: "post",
    tipEntiteta: "Nalog",
    entitetId: postedJournal.id,
    novaVrijednost: postedJournal
  });

  revalidatePath("/agencija/nalozi");
  redirectJournalDetail(nalog.id, "nalog_proknjizen");
}

export async function reopenJournal(formData: FormData) {
  const nalogId = value(formData, "nalog_id");
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id || !nalogId) {
    redirectJournals("nalog_greska");
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id: nalogId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      status: true,
      poslovna_godina: {
        select: {
          zakljucena: true
        }
      }
    }
  });

  if (!nalog || nalog.status !== journalStatuses.posted) {
    redirectJournals("nalog_greska");
  }

  if (nalog.poslovna_godina.zakljucena) {
    redirectJournalDetail(nalog.id, "godina_zakljucena");
  }

  const draftJournal = await prisma.nalog.update({
    where: {
      id: nalog.id
    },
    data: {
      status: journalStatuses.draft,
      vracen_u_nacrt_at: new Date(),
      vracen_u_nacrt_by: user.id,
      updated_by: user.id
    },
    select: {
      id: true,
      firma_id: true,
      status: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: draftJournal.firma_id,
    modul: "agencija.nalozi",
    akcija: "reopen",
    tipEntiteta: "Nalog",
    entitetId: draftJournal.id,
    novaVrijednost: draftJournal
  });

  revalidatePath("/agencija/nalozi");
  redirectJournalDetail(nalog.id, "nalog_nacrt");
}

export async function deleteJournal(formData: FormData) {
  const nalogId = value(formData, "nalog_id");
  const reason = nullableValue(formData, "delete_reason") ?? "Obrisano iz pregleda naloga";
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id || !nalogId) {
    redirectJournals("nalog_greska");
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id: nalogId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      status: true,
      poslovna_godina: {
        select: {
          zakljucena: true
        }
      }
    }
  });

  if (!nalog || nalog.poslovna_godina.zakljucena) {
    redirectJournals("nalog_greska");
  }

  const deletedJournal = await prisma.nalog.update({
    where: {
      id: nalog.id
    },
    data: {
      status: journalStatuses.deleted,
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: user.id,
      delete_reason: reason,
      updated_by: user.id
    },
    select: {
      id: true,
      firma_id: true,
      status: true,
      is_deleted: true
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: deletedJournal.firma_id,
    modul: "agencija.nalozi",
    akcija: "delete",
    tipEntiteta: "Nalog",
    entitetId: deletedJournal.id,
    novaVrijednost: deletedJournal
  });

  revalidatePath("/agencija/nalozi");
  redirectJournals("nalog_obrisan");
}

export async function createJournalType(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije"]);
  const sifra = value(formData, "sifra").toUpperCase().replace(/\s+/g, "_");
  const naziv = value(formData, "naziv");
  const prefiks = value(formData, "prefiks").toUpperCase();
  const firmaId = nullableValue(formData, "firma_id");

  if (!user.agencija_id || !sifra || !naziv || !prefiks) {
    redirect("/agencija/nalozi/vrste?poruka=vrsta_obavezno");
  }

  if (firmaId) {
    const firma = await prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false
      },
      select: {
        id: true
      }
    });

    if (!firma) {
      redirect("/agencija/nalozi/vrste?poruka=vrsta_greska");
    }
  }

  const vrsta = await prisma.vrstaNaloga.create({
    data: {
      agencija_id: firmaId ? null : user.agencija_id,
      firma_id: firmaId,
      sifra,
      naziv,
      opis: nullableValue(formData, "opis"),
      sistemska: false,
      prefiks,
      aktivan: true,
      created_by: user.id,
      updated_by: user.id
    },
    select: {
      id: true,
      sifra: true,
      naziv: true
    }
  }).catch(() => null);

  if (!vrsta) {
    redirect("/agencija/nalozi/vrste?poruka=vrsta_postoji");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId,
    modul: "agencija.vrste_naloga",
    akcija: "create",
    tipEntiteta: "VrstaNaloga",
    entitetId: vrsta.id,
    novaVrijednost: vrsta
  });

  revalidatePath("/agencija/nalozi/vrste");
  redirect("/agencija/nalozi/vrste?poruka=vrsta_kreirana");
}

export async function createPartner(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const firmaId = value(formData, "firma_id");
  const naziv = value(formData, "naziv");
  const pib = nullableValue(formData, "pib");
  const scope = value(formData, "scope") === "COMPANY" ? "COMPANY" : "AGENCY";
  const tipKomitenta = value(formData, "tip_komitenta") || "ostalo";

  if (!user.agencija_id || !firmaId || !naziv) {
    redirect("/agencija/nalozi/partneri?poruka=partner_obavezno");
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: firmaId,
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
  });

  if (!firma) {
    redirect("/agencija/nalozi/partneri?poruka=partner_greska");
  }

  const partner = await prisma.$transaction(async (tx) => {
    const existingPartner = pib
      ? await tx.komitent.findFirst({
          where: {
            pib,
            OR: [
              { scope: "GLOBAL" },
              { scope: "AGENCY", agencija_id: user.agencija_id },
              { scope: "COMPANY", firma_id: firma.id }
            ]
          },
          select: {
            id: true
          }
        })
      : null;
    const komitent = existingPartner
      ? await tx.komitent.findUniqueOrThrow({
          where: {
            id: existingPartner.id
          },
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        })
      : await tx.komitent.create({
          data: {
            naziv,
            scope,
            agencija_id: user.agencija_id,
            firma_id: scope === "COMPANY" ? firma.id : null,
            pib,
            maticni_broj: nullableValue(formData, "maticni_broj"),
            pdv_broj: nullableValue(formData, "pdv_broj"),
            adresa: nullableValue(formData, "adresa"),
            grad: nullableValue(formData, "grad"),
            drzava: nullableValue(formData, "drzava") ?? "Crna Gora",
            telefon: nullableValue(formData, "telefon"),
            email: nullableValue(formData, "email"),
            web_sajt: nullableValue(formData, "web_sajt"),
            aktivan: true
          },
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        });

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firma.id,
          komitent_id: komitent.id
        }
      },
      create: {
        firma_id: firma.id,
        komitent_id: komitent.id,
        tip_komitenta: tipKomitenta as "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo",
        sifra_u_firmi: nullableValue(formData, "sifra_u_firmi"),
        rok_placanja_dana: value(formData, "rok_placanja_dana")
          ? Number(value(formData, "rok_placanja_dana"))
          : null,
        napomena: nullableValue(formData, "napomena"),
        aktivan: true
      },
      update: {
        tip_komitenta: tipKomitenta as "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo",
        sifra_u_firmi: nullableValue(formData, "sifra_u_firmi"),
        rok_placanja_dana: value(formData, "rok_placanja_dana")
          ? Number(value(formData, "rok_placanja_dana"))
          : null,
        napomena: nullableValue(formData, "napomena"),
        aktivan: true
      }
    });

    return komitent;
  }).catch(() => null);

  if (!partner) {
    redirect("/agencija/nalozi/partneri?poruka=partner_greska");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.partneri",
    akcija: "create",
    tipEntiteta: "Komitent",
    entitetId: partner.id,
    novaVrijednost: partner
  });

  revalidatePath("/agencija/nalozi/partneri");
  revalidatePath("/agencija/nalozi/novi");
  redirect("/agencija/nalozi/partneri?poruka=partner_sacuvan");
}

export async function updatePartner(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const firmaId = value(formData, "firma_id");
  const partnerId = value(formData, "partner_id");
  const naziv = value(formData, "naziv");
  const pib = nullableValue(formData, "pib");
  const scope = value(formData, "scope") === "COMPANY" ? "COMPANY" : "AGENCY";
  const tipKomitenta = value(formData, "tip_komitenta") || "ostalo";

  if (!user.agencija_id || !firmaId || !partnerId || !naziv) {
    redirect("/agencija/nalozi/partneri?poruka=partner_obavezno");
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: firmaId,
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
  });

  if (!firma) {
    redirect("/agencija/nalozi/partneri?poruka=partner_greska");
  }

  const existing = await prisma.komitent.findFirst({
    where: {
      id: partnerId,
      OR: [
        {
          scope: "AGENCY",
          agencija_id: user.agencija_id
        },
        {
          scope: "COMPANY",
          firma_id: firma.id
        }
      ]
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      scope: true
    }
  });

  if (!existing) {
    redirect("/agencija/nalozi/partneri?poruka=partner_greska");
  }

  if (pib) {
    const duplicate = await prisma.komitent.findFirst({
      where: {
        pib,
        NOT: {
          id: partnerId
        },
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
            firma_id: firma.id
          }
        ]
      },
      select: {
        id: true
      }
    });

    if (duplicate) {
      redirect(`/agencija/nalozi/partneri?poruka=partner_dupli&partner=${partnerId}`);
    }
  }

  const partner = await prisma.$transaction(async (tx) => {
    const updated = await tx.komitent.update({
      where: {
        id: partnerId
      },
      data: {
        naziv,
        scope,
        agencija_id: user.agencija_id,
        firma_id: scope === "COMPANY" ? firma.id : null,
        pib,
        maticni_broj: nullableValue(formData, "maticni_broj"),
        pdv_broj: nullableValue(formData, "pdv_broj"),
        adresa: nullableValue(formData, "adresa"),
        grad: nullableValue(formData, "grad"),
        drzava: nullableValue(formData, "drzava") ?? "Crna Gora",
        telefon: nullableValue(formData, "telefon"),
        email: nullableValue(formData, "email"),
        web_sajt: nullableValue(formData, "web_sajt"),
        aktivan: true
      },
      select: {
        id: true,
        naziv: true,
        pib: true,
        scope: true
      }
    });

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firma.id,
          komitent_id: updated.id
        }
      },
      create: {
        firma_id: firma.id,
        komitent_id: updated.id,
        tip_komitenta: tipKomitenta as "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo",
        sifra_u_firmi: nullableValue(formData, "sifra_u_firmi"),
        rok_placanja_dana: value(formData, "rok_placanja_dana")
          ? Number(value(formData, "rok_placanja_dana"))
          : null,
        napomena: nullableValue(formData, "napomena"),
        aktivan: true
      },
      update: {
        tip_komitenta: tipKomitenta as "kupac" | "dobavljac" | "kupac_dobavljac" | "radnik" | "ostalo",
        sifra_u_firmi: nullableValue(formData, "sifra_u_firmi"),
        rok_placanja_dana: value(formData, "rok_placanja_dana")
          ? Number(value(formData, "rok_placanja_dana"))
          : null,
        napomena: nullableValue(formData, "napomena"),
        aktivan: true
      }
    });

    return updated;
  }).catch(() => null);

  if (!partner) {
    redirect(`/agencija/nalozi/partneri?poruka=partner_greska&partner=${partnerId}`);
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.partneri",
    akcija: "update",
    tipEntiteta: "Komitent",
    entitetId: partner.id,
    staraVrijednost: existing,
    novaVrijednost: partner
  });

  revalidatePath("/agencija/nalozi/partneri");
  revalidatePath("/agencija/nalozi/novi");
  redirect("/agencija/nalozi/partneri?poruka=partner_izmijenjen");
}
