import Link from "next/link";
import {
  importAccountPurposes,
  invoicePostingDefaultScope,
  invoicePostingDocumentTypes
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { financialReportTypes } from "@/lib/financial-reports";
import { formatJournalCode, journalStatuses, standardJournalTypes } from "@/lib/journals";
import { hasPermission } from "@/lib/permissions";
import { payrollStatuses } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type ControlLevel = "error" | "warning" | "success" | "info";

type ControlItem = {
  id: string;
  group: "Glavna knjiga" | "Pomoćne evidencije" | "Završni račun" | "Matični podaci";
  level: ControlLevel;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

const finalAccountTypeCode = standardJournalTypes[8][0];
const openingBalanceTypeCode = standardJournalTypes[0][0];
const resultAccountCodes = ["5990", "6990"];
const reportTypeLabels: Record<string, string> = {
  [financialReportTypes.balanceSheet]: "Bilans stanja",
  [financialReportTypes.incomeStatement]: "Bilans uspjeha",
  [financialReportTypes.statisticalAnnex]: "Statistički aneks"
};
const groupOrder: ControlItem["group"][] = [
  "Glavna knjiga",
  "Pomoćne evidencije",
  "Završni račun",
  "Matični podaci"
];

function money(value: number) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function cents(value: number) {
  return Math.round(value * 100);
}

function balanceLabel(value: number) {
  if (value > 0.005) return `dugovni saldo ${money(value)}`;
  if (value < -0.005) return `potražni saldo ${money(Math.abs(value))}`;
  return "saldo 0,00";
}

function levelLabel(level: ControlLevel) {
  if (level === "error") return "Greška";
  if (level === "warning") return "Upozorenje";
  if (level === "success") return "U redu";
  return "Informacija";
}

function levelSymbol(level: ControlLevel) {
  if (level === "error") return "×";
  if (level === "warning") return "!";
  if (level === "success") return "✓";
  return "i";
}

export default async function ZavrsniRacunKontrolePage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Kontrole završnog računa</h2>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const agencijaId = user.agencija_id;
  const firmaId = workContext.firmaId;
  const poslovnaGodinaId = workContext.poslovnaGodinaId;
  const [allowed, firma, godina] = await Promise.all([
    hasPermission(user, {
      firmaId,
      modul: "zavrsni_racun",
      akcija: "view"
    }),
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        aktivan: true,
        is_deleted: false,
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
        pib: true,
        maticni_broj: true,
        sifra_djelatnosti: true,
        adresa: true,
        grad: true,
        pdv_obveznik: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: poslovnaGodinaId,
        firma_id: firmaId
      },
      select: {
        id: true,
        godina: true,
        datum_od: true,
        datum_do: true,
        zakljucena: true
      }
    })
  ]);

  if (!allowed) {
    return (
      <div className="admin-stack">
        <section className="admin-card">
          <p className="empty-state">Nemate pravo za pregled kontrola završnog računa.</p>
        </section>
      </div>
    );
  }

  if (!firma || !godina) {
    return null;
  }

  const postedJournalWhere = {
    firma_id: firmaId,
    poslovna_godina_id: poslovnaGodinaId,
    status: journalStatuses.posted,
    is_deleted: false
  } as const;
  const activeRecordScope = {
    agencija_id: agencijaId,
    firma_id: firmaId,
    poslovna_godina_id: poslovnaGodinaId
  } as const;

  const [
    postedJournals,
    postedJournalTotals,
    draftJournalCount,
    missingPartnerCount,
    unpostedKifCount,
    unpostedKufCount,
    pendingCalculationCount,
    pendingInvoiceCount,
    pendingStatementCount,
    pendingPayrollCount,
    pdvPeriods,
    finalJournals,
    postedAccountTotals,
    companyAccounts,
    invoiceBookTypes,
    pdvSettings,
    importVatDefaults,
    reportTemplates,
    manualCorrectionCount,
    archiveCount,
    globalResultAccounts,
    companyResultAccounts,
    previousYear
  ] = await Promise.all([
    prisma.nalog.findMany({
      where: postedJournalWhere,
      orderBy: [{ datum: "asc" }, { broj: "asc" }],
      select: {
        id: true,
        sifra: true,
        broj: true,
        datum: true,
        vrsta_naloga: {
          select: {
            sifra: true,
            prefiks: true
          }
        },
        _count: {
          select: {
            stavke: true
          }
        }
      }
    }),
    prisma.stavkaNaloga.groupBy({
      by: ["nalog_id"],
      where: {
        nalog: postedJournalWhere
      },
      _sum: {
        duguje: true,
        potrazuje: true
      }
    }),
    prisma.nalog.count({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        status: journalStatuses.draft,
        is_deleted: false
      }
    }),
    prisma.stavkaNaloga.count({
      where: {
        komitent_id: null,
        firma_konto: {
          analitika_obavezna: true
        },
        nalog: postedJournalWhere
      }
    }),
    prisma.kifEntry.count({
      where: {
        ...activeRecordScope,
        is_deleted: false,
        posting_status: {
          not: "POSTED"
        }
      }
    }),
    prisma.kufEntry.count({
      where: {
        ...activeRecordScope,
        is_deleted: false,
        posting_status: {
          not: "POSTED"
        }
      }
    }),
    prisma.kalkulacija.count({
      where: {
        ...activeRecordScope,
        status: "WAITING_KUF",
        kuf_entry_id: null,
        is_deleted: false
      }
    }),
    prisma.fiskalniIzlazniRacun.count({
      where: {
        ...activeRecordScope,
        status: "WAITING_KIF",
        kif_status: "WAITING_KIF",
        kif_entry_id: null,
        is_deleted: false
      }
    }),
    prisma.bankStatement.count({
      where: {
        ...activeRecordScope,
        is_deleted: false,
        status: {
          not: "POSTED"
        }
      }
    }),
    prisma.plateObracun.count({
      where: {
        ...activeRecordScope,
        is_deleted: false,
        status: {
          notIn: [payrollStatuses.posted, payrollStatuses.locked, payrollStatuses.deleted]
        }
      }
    }),
    prisma.pdvPeriod.findMany({
      where: activeRecordScope,
      orderBy: {
        mjesec: "asc"
      },
      select: {
        mjesec: true,
        status: true
      }
    }),
    prisma.nalog.findMany({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        is_deleted: false,
        vrsta_naloga: {
          sifra: finalAccountTypeCode
        }
      },
      select: {
        id: true,
        sifra: true,
        status: true
      }
    }),
    prisma.stavkaNaloga.groupBy({
      by: ["konto_id"],
      where: {
        nalog: postedJournalWhere
      },
      _sum: {
        duguje: true,
        potrazuje: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: firmaId
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    }),
    prisma.racunVrsta.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        aktivna: true,
        dokument_tip: {
          in: [invoicePostingDocumentTypes.kif, invoicePostingDocumentTypes.kuf]
        }
      },
      select: {
        dokument_tip: true,
        sifra: true,
        naziv: true,
        kontiranjePravila: {
          where: {
            aktivno: true,
            polje_sifra: {
              startsWith: "PDV_"
            },
            sifra_konta: {
              not: null
            }
          },
          select: {
            polje_naziv: true,
            sifra_konta: true
          }
        }
      }
    }),
    prisma.pdvPodesavanja.findUnique({
      where: {
        firma_id_poslovna_godina_id: {
          firma_id: firmaId,
          poslovna_godina_id: poslovnaGodinaId
        }
      },
      select: {
        izlazni_pdv_konto: {
          select: {
            sifra: true
          }
        },
        ulazni_pdv_konto: {
          select: {
            sifra: true
          }
        },
        pravila: {
          where: {
            aktivno: true,
            OR: [
              { polje_sifra: { startsWith: "OUTPUT_VAT_" } },
              { polje_sifra: { startsWith: "INPUT_VAT_" } },
              { polje_sifra: { in: ["IMPORT_VAT", "PAUSAL_VAT"] } }
            ]
          },
          select: {
            polje_naziv: true,
            konto: {
              select: {
                sifra: true
              }
            }
          }
        }
      }
    }),
    prisma.firmaPodrazumijevanoKonto.findMany({
      where: {
        firma_id: firmaId,
        dokument_tip: invoicePostingDocumentTypes.general,
        podvrsta: invoicePostingDefaultScope.subtype,
        pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
        namjena: importAccountPurposes.customsVat
      },
      select: {
        sifra_konta: true
      }
    }),
    prisma.finansijskiIzvjestajSablon.findMany({
      where: {
        tip_sifra: {
          in: Object.keys(reportTypeLabels)
        },
        OR: [
          {
            agencija_id: agencijaId,
            firma_id: firmaId
          },
          {
            sistemski: true,
            agencija_id: null,
            firma_id: null
          }
        ]
      },
      select: {
        tip_sifra: true,
        sistemski: true,
        firma_id: true,
        _count: {
          select: {
            pozicije: true
          }
        }
      }
    }),
    prisma.finansijskiIzvjestajKorekcija.count({
      where: activeRecordScope
    }),
    prisma.finansijskiIzvjestajArhiva.count({
      where: activeRecordScope
    }),
    prisma.konto.findMany({
      where: {
        sifra: {
          in: resultAccountCodes
        },
        aktivan: true
      },
      select: {
        sifra: true,
        aktivan: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: firmaId,
        sifra: {
          in: resultAccountCodes
        }
      },
      select: {
        sifra: true,
        aktivan: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        firma_id: firmaId,
        godina: {
          lt: godina.godina
        }
      },
      orderBy: {
        godina: "desc"
      },
      select: {
        godina: true
      }
    })
  ]);

  const totalsByJournal = new Map(
    postedJournalTotals.map((row) => [
      row.nalog_id,
      {
        debit: Number(row._sum.duguje ?? 0),
        credit: Number(row._sum.potrazuje ?? 0)
      }
    ])
  );
  const totalDebit = postedJournalTotals.reduce(
    (sum, row) => sum + Number(row._sum.duguje ?? 0),
    0
  );
  const totalCredit = postedJournalTotals.reduce(
    (sum, row) => sum + Number(row._sum.potrazuje ?? 0),
    0
  );
  const emptyPostedJournals = postedJournals.filter((journal) => journal._count.stavke === 0);
  const unbalancedJournals = postedJournals.filter((journal) => {
    const totals = totalsByJournal.get(journal.id) ?? { debit: 0, credit: 0 };
    return cents(totals.debit) !== cents(totals.credit);
  });
  const journalsOutsidePeriod = postedJournals.filter(
    (journal) => journal.datum < godina.datum_od || journal.datum > godina.datum_do
  );
  const openingBalanceCount = postedJournals.filter(
    (journal) => journal.vrsta_naloga.sifra === openingBalanceTypeCode
  ).length;
  const journalLabel = (journal: (typeof postedJournals)[number]) =>
    journal.sifra ||
    formatJournalCode(journal.vrsta_naloga.prefiks, godina.godina, journal.broj);
  const abbreviatedJournals = (journals: typeof postedJournals) =>
    journals
      .slice(0, 3)
      .map(journalLabel)
      .join(", ");

  const postedBalanceByAccountId = new Map(
    postedAccountTotals.map((row) => [
      row.konto_id,
      Number(row._sum.duguje ?? 0) - Number(row._sum.potrazuje ?? 0)
    ])
  );
  const companyAccountByCode = new Map(companyAccounts.map((account) => [account.sifra, account]));
  const accountBalances = companyAccounts.map((account) => ({
    ...account,
    balance: postedBalanceByAccountId.get(account.id) ?? 0
  }));
  const classAccounts = accountBalances.filter(
    (account) => account.sifra.startsWith("5") || account.sifra.startsWith("6")
  );
  const openClassAccounts = classAccounts.filter(
    (account) =>
      !resultAccountCodes.includes(account.sifra) && Math.abs(account.balance) >= 0.005
  );
  const wrongNatureAccounts = classAccounts.filter(
    (account) =>
      (account.sifra.startsWith("5") && account.balance < -0.005) ||
      (account.sifra.startsWith("6") && account.balance > 0.005)
  );

  const vatAccountSources = new Map<string, Set<string>>();
  const registerVatAccount = (code: string | null | undefined, source: string) => {
    const normalizedCode = code?.trim();
    if (!normalizedCode) return;

    const sources = vatAccountSources.get(normalizedCode) ?? new Set<string>();
    sources.add(source);
    vatAccountSources.set(normalizedCode, sources);
  };

  for (const bookType of invoiceBookTypes) {
    for (const rule of bookType.kontiranjePravila) {
      registerVatAccount(
        rule.sifra_konta,
        `${bookType.dokument_tip} ${bookType.sifra} · ${rule.polje_naziv}`
      );
    }
  }
  registerVatAccount(pdvSettings?.izlazni_pdv_konto?.sifra, "PDV prijava · izlazni PDV");
  registerVatAccount(pdvSettings?.ulazni_pdv_konto?.sifra, "PDV prijava · ulazni PDV");
  for (const rule of pdvSettings?.pravila ?? []) {
    registerVatAccount(rule.konto?.sifra, `PDV prijava · ${rule.polje_naziv}`);
  }
  for (const account of importVatDefaults) {
    registerVatAccount(account.sifra_konta, "KUF uvoz · carinski PDV");
  }

  const configuredVatAccounts = [...vatAccountSources.entries()].map(([code, sources]) => {
    const account = companyAccountByCode.get(code);
    return {
      code,
      sources: [...sources],
      account,
      balance: account ? (postedBalanceByAccountId.get(account.id) ?? 0) : 0
    };
  });
  const unclosedVatAccounts = configuredVatAccounts.filter(
    (account) => Math.abs(account.balance) >= 0.005
  );
  const postedFinalJournals = finalJournals.filter(
    (journal) => journal.status === journalStatuses.posted
  );
  const draftFinalJournals = finalJournals.filter(
    (journal) => journal.status === journalStatuses.draft
  );
  const incompletePdvPeriods = pdvPeriods.filter(
    (period) => !["LOCKED", "POSTED", "SUBMITTED"].includes(period.status)
  );
  const missingReportTemplates = Object.entries(reportTypeLabels).filter(([type]) => {
    const companyTemplate = reportTemplates.find(
      (template) => template.tip_sifra === type && template.firma_id === firmaId
    );
    const systemTemplate = reportTemplates.find(
      (template) => template.tip_sifra === type && template.sistemski
    );
    const effectiveTemplate = companyTemplate ?? systemTemplate;
    return !effectiveTemplate || effectiveTemplate._count.pozicije === 0;
  });
  const missingResultAccounts = resultAccountCodes.filter((code) => {
    const companyAccount = companyResultAccounts.find((account) => account.sifra === code);
    if (companyAccount) return !companyAccount.aktivan;
    return !globalResultAccounts.some((account) => account.sifra === code && account.aktivan);
  });
  const missingCompanyFields = [
    ["PIB", firma.pib],
    ["matični broj", firma.maticni_broj],
    ["šifra djelatnosti", firma.sifra_djelatnosti],
    ["adresa", firma.adresa],
    ["grad", firma.grad]
  ]
    .filter(([, value]) => !value?.trim())
    .map(([label]) => label);

  const controls: ControlItem[] = [];
  const addControl = (control: ControlItem) => controls.push(control);

  if (postedJournals.length === 0) {
    addControl({
      id: "posted-journals",
      group: "Glavna knjiga",
      level: "warning",
      title: "Nema proknjiženih naloga",
      description: "Bruto bilans i obrasci nemaju proknjižene podatke za izabranu godinu.",
      actionHref: "/agencija/nalozi",
      actionLabel: "Pregled naloga"
    });
  } else if (unbalancedJournals.length > 0) {
    addControl({
      id: "journal-balance",
      group: "Glavna knjiga",
      level: "error",
      title: `${unbalancedJournals.length} proknjiženih naloga nije izbalansirano`,
      description: `${abbreviatedJournals(unbalancedJournals)}${
        unbalancedJournals.length > 3 ? " i drugi" : ""
      }. Ukupna razlika glavne knjige je ${money(Math.abs(totalDebit - totalCredit))}.`,
      actionHref: "/agencija/nalozi?status=POSTED",
      actionLabel: "Otvori naloge"
    });
  } else {
    addControl({
      id: "journal-balance",
      group: "Glavna knjiga",
      level: "success",
      title: "Svi proknjiženi nalozi su izbalansirani",
      description: `${postedJournals.length} naloga · duguje ${money(totalDebit)} · potražuje ${money(
        totalCredit
      )}.`,
      actionHref: "/agencija/zavrsni-racun/bruto-bilans",
      actionLabel: "Bruto bilans"
    });
  }

  addControl(
    emptyPostedJournals.length > 0
      ? {
          id: "empty-journals",
          group: "Glavna knjiga",
          level: "error",
          title: `${emptyPostedJournals.length} proknjiženih naloga nema stavke`,
          description: `${abbreviatedJournals(emptyPostedJournals)}${
            emptyPostedJournals.length > 3 ? " i drugi" : ""
          }. Proknjižen nalog mora imati stavke.`,
          actionHref: "/agencija/nalozi?status=POSTED",
          actionLabel: "Provjeri naloge"
        }
      : {
          id: "empty-journals",
          group: "Glavna knjiga",
          level: "success",
          title: "Nema praznih proknjiženih naloga",
          description: "Svaki proknjiženi nalog ima najmanje jednu stavku."
        }
  );

  addControl(
    missingPartnerCount > 0
      ? {
          id: "analytic-partners",
          group: "Glavna knjiga",
          level: "error",
          title: `${missingPartnerCount} analitičkih stavki nema partnera`,
          description: "Stavke na kontima sa obaveznom analitikom moraju imati izabranog partnera.",
          actionHref: "/agencija/nalozi?status=POSTED",
          actionLabel: "Provjeri naloge"
        }
      : {
          id: "analytic-partners",
          group: "Glavna knjiga",
          level: "success",
          title: "Analitika partnera je potpuna",
          description: "Nema proknjiženih analitičkih stavki bez partnera."
        }
  );

  addControl(
    journalsOutsidePeriod.length > 0
      ? {
          id: "journal-dates",
          group: "Glavna knjiga",
          level: "error",
          title: `${journalsOutsidePeriod.length} naloga ima datum van poslovne godine`,
          description: `${abbreviatedJournals(journalsOutsidePeriod)}${
            journalsOutsidePeriod.length > 3 ? " i drugi" : ""
          }.`,
          actionHref: "/agencija/nalozi?status=POSTED",
          actionLabel: "Provjeri datume"
        }
      : {
          id: "journal-dates",
          group: "Glavna knjiga",
          level: "success",
          title: "Datumi naloga su u granicama godine",
          description: "Svi proknjiženi nalozi pripadaju izabranom periodu poslovne godine."
        }
  );

  addControl(
    draftJournalCount > 0
      ? {
          id: "draft-journals",
          group: "Glavna knjiga",
          level: "warning",
          title: `${draftJournalCount} naloga je ostalo u nacrtu`,
          description: "Nacrte treba proknjižiti, ispraviti ili obrisati prije završetka godine.",
          actionHref: "/agencija/nalozi?status=DRAFT",
          actionLabel: "Otvori nacrte"
        }
      : {
          id: "draft-journals",
          group: "Glavna knjiga",
          level: "success",
          title: "Nema naloga u nacrtu",
          description: "Svi aktivni nalozi su razriješeni."
        }
  );

  if (configuredVatAccounts.length === 0) {
    addControl({
      id: "vat-zero-balance-settings",
      group: "Glavna knjiga",
      level: firma.pdv_obveznik ? "warning" : "info",
      title: "Nijesu pronađena konta ulaznog i izlaznog PDV-a",
      description:
        "Kontrola salda koristi aktivne KIF/KUF šeme i izvorna konta iz šeme PDV prijave. Podesite konta da bi provjera bila potpuna.",
      actionHref: firma.pdv_obveznik
        ? "/agencija/pdv/podesavanja"
        : "/agencija/racuni/podesavanja",
      actionLabel: "Podesi konta"
    });
  } else if (unclosedVatAccounts.length === 0) {
    addControl({
      id: "vat-zero-balance",
      group: "Glavna knjiga",
      level: "success",
      title: "Konta ulaznog i izlaznog PDV-a su zatvorena",
      description: `${configuredVatAccounts.length} identifikovanih PDV konta ima saldo 0,00.`
    });
  } else {
    for (const vatAccount of unclosedVatAccounts) {
      addControl({
        id: `vat-zero-balance-${vatAccount.account?.id ?? vatAccount.code}`,
        group: "Glavna knjiga",
        level: "error",
        title: `${vatAccount.code} — PDV konto nije zatvoren`,
        description: `${vatAccount.account?.naziv ?? "Konto PDV-a"} ima ${balanceLabel(
          vatAccount.balance
        )}. Izvor podešavanja: ${vatAccount.sources.join(", ")}. Saldo mora biti 0,00.`,
        actionHref: vatAccount.account
          ? `/agencija/izvjestaji/kartice-konta?konto=${vatAccount.account.id}`
          : "/agencija/izvjestaji/kartice-konta",
        actionLabel: "Otvori karticu"
      });
    }
  }

  if (wrongNatureAccounts.length === 0) {
    addControl({
      id: "class-five-six-nature",
      group: "Glavna knjiga",
      level: "success",
      title: "Konta troškova i prihoda imaju pravilan saldo",
      description: "Klasa 5 nema potražni, a klasa 6 nema dugovni saldo."
    });
  } else {
    for (const account of wrongNatureAccounts) {
      const expected = account.sifra.startsWith("5") ? "dugovni" : "potražni";
      addControl({
        id: `class-five-six-nature-${account.id}`,
        group: "Glavna knjiga",
        level: "error",
        title: `${account.sifra} — pogrešna priroda salda`,
        description: `${account.naziv} ima ${balanceLabel(
          account.balance
        )}, a konto klase ${account.sifra[0]} mora imati ${expected} saldo ili saldo 0,00.`,
        actionHref: `/agencija/izvjestaji/kartice-konta?konto=${account.id}`,
        actionLabel: "Otvori karticu"
      });
    }
  }

  if (previousYear) {
    addControl(
      openingBalanceCount > 0
        ? {
            id: "opening-balance",
            group: "Glavna knjiga",
            level: "success",
            title: "Početno stanje postoji",
            description: `Pronađen je proknjižen nalog početnog stanja nakon ${previousYear.godina}. godine.`
          }
        : {
            id: "opening-balance",
            group: "Glavna knjiga",
            level: "warning",
            title: "Nije pronađeno proknjiženo početno stanje",
            description: `Firma ima prethodnu ${previousYear.godina}. godinu, ali aktivna godina nema POSTED nalog početnog stanja.`,
            actionHref: "/agencija/nalozi/pocetno-stanje",
            actionLabel: "Početno stanje"
          }
    );
  }

  addControl(
    unpostedKifCount + unpostedKufCount > 0
      ? {
          id: "invoice-books",
          group: "Pomoćne evidencije",
          level: "error",
          title: `${unpostedKifCount + unpostedKufCount} KIF/KUF računa nije proknjiženo`,
          description: `KIF: ${unpostedKifCount} · KUF: ${unpostedKufCount}. Evidencije moraju biti povezane sa glavnom knjigom.`,
          actionHref: "/agencija/racuni/neproknjizeno",
          actionLabel: "Neproknjiženo"
        }
      : {
          id: "invoice-books",
          group: "Pomoćne evidencije",
          level: "success",
          title: "KIF i KUF računi su proknjiženi",
          description: "Nema aktivnih neproknjiženih računa u izabranoj godini."
        }
  );

  addControl(
    pendingCalculationCount + pendingInvoiceCount > 0
      ? {
          id: "pending-source-documents",
          group: "Pomoćne evidencije",
          level: "warning",
          title: `${pendingCalculationCount + pendingInvoiceCount} dokumenata čeka KIF/KUF`,
          description: `Kalkulacije koje čekaju KUF: ${pendingCalculationCount} · izlazni računi koji čekaju KIF: ${pendingInvoiceCount}.`,
          actionHref: "/agencija",
          actionLabel: "Početni pregled"
        }
      : {
          id: "pending-source-documents",
          group: "Pomoćne evidencije",
          level: "success",
          title: "Svi završeni dokumenti su prenijeti u KIF/KUF",
          description: "Nema kalkulacija ni izlaznih računa koji čekaju preuzimanje."
        }
  );

  addControl(
    pendingStatementCount > 0
      ? {
          id: "bank-statements",
          group: "Pomoćne evidencije",
          level: "warning",
          title: `${pendingStatementCount} bankovnih izvoda nije proknjiženo`,
          description: "Provjerite stanja i neriješene stavke prije završetka godine.",
          actionHref: "/agencija/izvodi/kontrole",
          actionLabel: "Kontrole izvoda"
        }
      : {
          id: "bank-statements",
          group: "Pomoćne evidencije",
          level: "success",
          title: "Bankovni izvodi su razriješeni",
          description: "Nema aktivnih neproknjiženih izvoda za izabranu godinu."
        }
  );

  addControl(
    pendingPayrollCount > 0
      ? {
          id: "payroll",
          group: "Pomoćne evidencije",
          level: "warning",
          title: `${pendingPayrollCount} obračuna plata nije proknjiženo`,
          description: "Obračuni u nacrtu, obradi ili pregledu još nemaju završeno knjiženje.",
          actionHref: "/agencija/plate/obracun",
          actionLabel: "Obračuni plata"
        }
      : {
          id: "payroll",
          group: "Pomoćne evidencije",
          level: "success",
          title: "Obračuni plata su razriješeni",
          description: "Nema aktivnih obračuna bez završenog knjiženja."
        }
  );

  if (!firma.pdv_obveznik) {
    addControl({
      id: "pdv-periods",
      group: "Pomoćne evidencije",
      level: "info",
      title: "Firma nije PDV obveznik",
      description: "Kontrola PDV perioda nije primjenjiva."
    });
  } else if (pdvPeriods.length === 0) {
    addControl({
      id: "pdv-periods",
      group: "Pomoćne evidencije",
      level: "warning",
      title: "Nijesu pripremljeni PDV periodi",
      description: "Firma je PDV obveznik, ali za izabranu godinu nema PDV perioda.",
      actionHref: "/agencija/pdv",
      actionLabel: "PDV pregled"
    });
  } else if (incompletePdvPeriods.length > 0) {
    addControl({
      id: "pdv-periods",
      group: "Pomoćne evidencije",
      level: "warning",
      title: `${incompletePdvPeriods.length} PDV perioda nije završeno`,
      description: `Mjeseci: ${incompletePdvPeriods.map((period) => period.mjesec).join(", ")}.`,
      actionHref: "/agencija/pdv",
      actionLabel: "PDV pregled"
    });
  } else {
    addControl({
      id: "pdv-periods",
      group: "Pomoćne evidencije",
      level: "success",
      title: "PDV periodi su završeni",
      description: `${pdvPeriods.length} perioda ima završni status.`,
      actionHref: "/agencija/pdv",
      actionLabel: "PDV pregled"
    });
  }

  addControl(
    missingReportTemplates.length > 0
      ? {
          id: "report-templates",
          group: "Završni račun",
          level: "error",
          title: "Nedostaje šema finansijskih izvještaja",
          description: missingReportTemplates.map(([, label]) => label).join(", "),
          actionHref: "/agencija/zavrsni-racun/podesavanja",
          actionLabel: "Podešavanja"
        }
      : {
          id: "report-templates",
          group: "Završni račun",
          level: "success",
          title: "Šeme finansijskih izvještaja su dostupne",
          description: "Bilans stanja, Bilans uspjeha i Statistički aneks imaju aktivne pozicije.",
          actionHref: "/agencija/zavrsni-racun/obrasci",
          actionLabel: "Otvori obrasce"
        }
  );

  addControl(
    missingResultAccounts.length > 0
      ? {
          id: "result-accounts",
          group: "Završni račun",
          level: "error",
          title: "Nedostaju konta za zaključna knjiženja",
          description: `Aktivna konta nijesu pronađena: ${missingResultAccounts.join(", ")}.`,
          actionHref: "/agencija/firme/kontni-plan",
          actionLabel: "Kontni plan"
        }
      : {
          id: "result-accounts",
          group: "Završni račun",
          level: "success",
          title: "Konta rezultata su dostupna",
          description: "Konta 5990 i 6990 postoje u efektivnom kontnom planu firme."
        }
  );

  if (postedFinalJournals.length > 0 && openClassAccounts.length > 0) {
    addControl({
      id: "closing-journals",
      group: "Završni račun",
      level: "error",
      title: "Klase 5 i 6 nijesu zatvorene",
      description: `Postoji proknjižen završni nalog, ali ${openClassAccounts.length} konta i dalje ima saldo.`,
      actionHref: "/agencija/zavrsni-racun/zakljucna-knjizenja",
      actionLabel: "Zaključna knjiženja"
    });
  } else if (postedFinalJournals.length === 0 && openClassAccounts.length > 0) {
    addControl({
      id: "closing-journals",
      group: "Završni račun",
      level: "warning",
      title: "Zaključna knjiženja nijesu završena",
      description: `${openClassAccounts.length} konta klasa 5 i 6 ima saldo za zatvaranje.`,
      actionHref: "/agencija/zavrsni-racun/zakljucna-knjizenja",
      actionLabel: "Pripremi nalog"
    });
  } else if (postedFinalJournals.length > 0) {
    addControl({
      id: "closing-journals",
      group: "Završni račun",
      level: "success",
      title: "Klase 5 i 6 su zatvorene",
      description: `${postedFinalJournals.length} završnih naloga je proknjiženo i nema preostalog salda.`,
      actionHref: "/agencija/zavrsni-racun/zakljucna-knjizenja",
      actionLabel: "Pregled naloga"
    });
  } else {
    addControl({
      id: "closing-journals",
      group: "Završni račun",
      level: "info",
      title: "Nema salda klasa 5 i 6 za zatvaranje",
      description: "Zaključni nalog trenutno nije potreban."
    });
  }

  if (draftFinalJournals.length > 0) {
    addControl({
      id: "draft-final-journals",
      group: "Završni račun",
      level: "warning",
      title: `${draftFinalJournals.length} završnih naloga je u nacrtu`,
      description: "Provjerite i proknjižite ili uklonite ranije pripremljene završne naloge.",
      actionHref: "/agencija/zavrsni-racun/zakljucna-knjizenja",
      actionLabel: "Otvori naloge"
    });
  }

  addControl(
    manualCorrectionCount > 0
      ? {
          id: "manual-corrections",
          group: "Završni račun",
          level: "warning",
          title: `${manualCorrectionCount} ručnih korekcija u obrascima`,
          description: "Pregledajte svaku ručnu vrijednost prije arhiviranja završnog računa.",
          actionHref: "/agencija/zavrsni-racun/obrasci?edit=1",
          actionLabel: "Pregled korekcija"
        }
      : {
          id: "manual-corrections",
          group: "Završni račun",
          level: "success",
          title: "Nema ručnih korekcija obrazaca",
          description: "Svi iznosi finansijskih izvještaja trenutno dolaze iz automatskog obračuna."
        }
  );

  addControl({
    id: "archive",
    group: "Završni račun",
    level: archiveCount > 0 ? "success" : "info",
    title: archiveCount > 0 ? "Završni račun je snimljen u arhivu" : "Završni račun još nije arhiviran",
    description:
      archiveCount > 0
        ? `${archiveCount} snimljenih verzija za izabranu godinu.`
        : "Kada završite kontrole i obrasce, snimite završni račun u arhivu.",
    actionHref: archiveCount > 0 ? "/agencija/zavrsni-racun/arhiva" : "/agencija/zavrsni-racun/obrasci",
    actionLabel: archiveCount > 0 ? "Otvori arhivu" : "Otvori obrasce"
  });

  addControl(
    missingCompanyFields.length > 0
      ? {
          id: "company-data",
          group: "Matični podaci",
          level: "warning",
          title: "Matični podaci firme nijesu potpuni",
          description: `Nedostaje: ${missingCompanyFields.join(", ")}.`,
          actionHref: "/agencija/firme",
          actionLabel: "Podaci firme"
        }
      : {
          id: "company-data",
          group: "Matični podaci",
          level: "success",
          title: "Osnovni podaci firme su popunjeni",
          description: "PIB, matični broj, djelatnost i adresa dostupni su za obrasce."
        }
  );

  addControl({
    id: "year-status",
    group: "Matični podaci",
    level: godina.zakljucena ? "success" : "info",
    title: godina.zakljucena ? "Poslovna godina je zaključana" : "Poslovna godina je otvorena",
    description: godina.zakljucena
      ? "Izmjene poslovnih dokumenata za ovu godinu su blokirane."
      : "Godinu zaključajte tek nakon razrješenja kontrola i arhiviranja obrazaca."
  });

  const errorCount = controls.filter((control) => control.level === "error").length;
  const warningCount = controls.filter((control) => control.level === "warning").length;
  const successCount = controls.filter((control) => control.level === "success").length;
  const overallStatus = errorCount > 0 ? "Blokirajuće greške" : warningCount > 0 ? "Potrebna provjera" : "Spremno";

  return (
    <div className="admin-stack final-controls-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Završni račun / Kontrole</p>
          <h2>Kontrole završnog računa</h2>
          <p>
            {firma.naziv} · {godina.godina} · provjera prije zaključnih knjiženja i arhiviranja
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/bruto-bilans">
            Bruto bilans
          </Link>
          <Link className="secondary-button" href="/agencija/zavrsni-racun/zakljucna-knjizenja">
            Zaključna knjiženja
          </Link>
          <Link className="secondary-button" href="/agencija/zavrsni-racun/obrasci">
            Obrasci
          </Link>
        </div>
      </header>

      <section className={`final-controls-overview final-controls-overview--${errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "success"}`}>
        <div>
          <span>Ukupni status</span>
          <strong>{overallStatus}</strong>
          <p>
            {errorCount > 0
              ? "Otklonite blokirajuće greške prije završnih koraka."
              : warningCount > 0
                ? "Nema blokirajućih grešaka, ali otvorene stavke zahtijevaju pregled."
                : "Sve aktivne kontrole su prošle bez otvorenih stavki."}
          </p>
        </div>
        <div className="final-controls-score" aria-label="Sažetak kontrola">
          <article>
            <span>Greške</span>
            <strong>{errorCount}</strong>
          </article>
          <article>
            <span>Upozorenja</span>
            <strong>{warningCount}</strong>
          </article>
          <article>
            <span>U redu</span>
            <strong>{successCount}</strong>
          </article>
        </div>
      </section>

      {groupOrder.map((group) => {
        const groupControls = controls.filter((control) => control.group === group);
        if (groupControls.length === 0) return null;

        return (
          <section className="admin-panel final-control-group" key={group}>
            <div className="panel-header">
              <div>
                <h3>{group}</h3>
                <span>{groupControls.length} kontrola</span>
              </div>
            </div>
            <div className="final-control-list">
              {groupControls.map((control) => (
                <article
                  className={`final-control-item final-control-item--${control.level}`}
                  key={control.id}
                >
                  <span className="final-control-symbol" aria-hidden="true">
                    {levelSymbol(control.level)}
                  </span>
                  <div className="final-control-copy">
                    <span className={`status-pill final-control-status final-control-status--${control.level}`}>
                      {levelLabel(control.level)}
                    </span>
                    <h4>{control.title}</h4>
                    <p>{control.description}</p>
                  </div>
                  {control.actionHref ? (
                    <Link className="secondary-button compact-button" href={control.actionHref}>
                      {control.actionLabel ?? "Otvori"}
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
