import Link from "next/link";
import { postInvoiceBook } from "../actions";
import {
  invoicePostingAccountSources,
  invoicePostingDocumentTypes,
  invoicePostingFields
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type NeproknjizenoPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    nalog?: string;
    detalj?: string;
  }>;
};

const poruke: Record<string, string> = {
  knjizenje_kreiran: "Nalog je kreiran.",
  knjizenje_dodato: "Novi računi su dodati na postojeći nalog.",
  knjizenje_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  knjizenje_pdv: "Definišite aktivne PDV stope prije knjiženja.",
  knjizenje_vrsta_naloga: "Za ovu vrstu KIF/KUF knjige prvo izaberite vrstu naloga u podešavanjima.",
  knjizenje_sema: "Šema kontiranja nije kompletna za ovu vrstu knjige.",
  knjizenje_konto: "Neko konto iz šeme nije aktivno analitičko konto.",
  knjizenje_nalog_zakljucan: "Postojeći nalog je već proknjižen i ne može se dopuniti.",
  knjizenje_nema: "Nema neproknjiženih računa za izabranu knjigu.",
  knjizenje_razlika_racuna: "KUF nije proknjižen jer jedan račun ima nedozvoljenu razliku.",
  knjizenje_nije_balansiran: "Šema knjiženja ne daje izbalansiran nalog.",
  prava: "Nemate pravo za knjiženje ove knjige.",
  knjizenje_greska: "Knjiženje nije izvršeno. Provjerite podatke."
};

const mjeseci = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function decimalText(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  return numeric.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

type BookRow = {
  id: string;
  documentType: string;
  number: string;
  month: number;
  date: Date;
  typeName: string;
  totalEntries: number;
  unpostedEntries: number;
  postedEntries: number;
  totalGross: number;
  journalId: string | null;
  journalCode: string | null;
  journalStatus: string | null;
  statusLabel: string;
  controlIssues: string[];
  canPost: boolean;
};

type PostingField = ReturnType<typeof invoicePostingFields>[number];

function amountCents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}

function differenceText(differenceCents: number) {
  return (Math.abs(differenceCents) / 100).toFixed(2).replace(".", ",");
}

function rowStatus(total: number, posted: number, unposted: number) {
  if (total === 0) {
    return "Prazno";
  }

  if (posted > 0 && unposted > 0) {
    return "Djelimično knjižena";
  }

  if (posted > 0 && unposted === 0) {
    return "Knjiženo";
  }

  return "Otvorena";
}

function classNameForStatus(status: string) {
  if (status === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (status === "Djelimično knjižena") {
    return "status-pill status-pill--warning";
  }

  if (status === "Prazno") {
    return "status-pill status-pill--muted";
  }

  return "status-pill";
}

function amountForEntryField(
  documentType: string,
  field: PostingField,
  entry: {
    total_gross: { toString(): string };
    tax_lines: Array<{
      vat_rate_code: string;
      tax_base: { toString(): string };
      deductible_vat_amount?: { toString(): string };
      non_deductible_vat_amount?: { toString(): string };
      output_vat_amount?: { toString(): string };
    }>;
  }
) {
  if (field.code === "UKUPAN_IZNOS") {
    return amountCents(entry.total_gross);
  }

  const taxLine = entry.tax_lines.find((line) => line.vat_rate_code === field.vatRateCode);
  if (!taxLine) {
    return 0;
  }

  if (field.code.startsWith("PDV_")) {
    return documentType === invoicePostingDocumentTypes.kuf
      ? amountCents(taxLine.deductible_vat_amount ?? { toString: () => "0" })
      : amountCents(taxLine.output_vat_amount ?? { toString: () => "0" });
  }

  return documentType === invoicePostingDocumentTypes.kuf
    ? amountCents(taxLine.tax_base) +
        amountCents(taxLine.non_deductible_vat_amount ?? { toString: () => "0" })
    : amountCents(taxLine.tax_base);
}

function validateBookForPosting({
  documentType,
  fields,
  rules,
  entries,
  journalTypeId,
  journalStatus
}: {
  documentType: string;
  fields: PostingField[];
  rules: Array<{
    polje_sifra: string;
    smjer: string;
    konto_izvor: string;
    sifra_konta: string | null;
  }>;
  entries: Array<{
    posting_status: string;
    posting_mode?: string;
    entry_kind?: string;
    journal_id: string | null;
    is_import?: boolean;
    internal_kuf_number?: string;
    supplier_invoice_number?: string;
    dobavljac?: { naziv: string };
    total_gross: { toString(): string };
    expense_account?: { sifra: string } | null;
    revenue_account?: { sifra: string } | null;
    tax_lines: Array<{
      vat_rate_code: string;
      tax_base: { toString(): string };
      deductible_vat_amount?: { toString(): string };
      non_deductible_vat_amount?: { toString(): string };
      output_vat_amount?: { toString(): string };
    }>;
  }>;
  journalTypeId: string | null;
  journalStatus: string | null;
}) {
  const issues: string[] = [];
  const unpostedEntries = entries.filter(
    (entry) =>
      entry.posting_status === "UNPOSTED" &&
      !entry.journal_id &&
      (documentType !== invoicePostingDocumentTypes.kuf ||
        entry.posting_mode === "KUF_RULES")
  );

  if (!journalTypeId) {
    issues.push("Nije izabrana vrsta naloga.");
  }

  if (journalStatus === journalStatuses.posted && unpostedEntries.length > 0) {
    issues.push("Postojeći nalog je proknjižen, ne može se dopuniti.");
  }

  const ruleByField = new Map(rules.map((rule) => [rule.polje_sifra, rule]));
  let debit = 0;
  let credit = 0;

  for (const entry of unpostedEntries) {
    if (documentType === invoicePostingDocumentTypes.kuf && entry.is_import) {
      continue;
    }

    if (
      documentType === invoicePostingDocumentTypes.kif &&
      entry.entry_kind === "PAZAR"
    ) {
      continue;
    }

    let entryDebit = 0;
    let entryCredit = 0;
    let hasExpenseLine = false;

    for (const field of fields) {
      const amount = amountForEntryField(documentType, field, entry);
      if (amount === 0) {
        continue;
      }

      const rule = ruleByField.get(field.code);
      const accountSource = rule?.konto_izvor ?? field.accountSource;
      const accountCode =
        accountSource === invoicePostingAccountSources.inputExpense
          ? documentType === invoicePostingDocumentTypes.kuf
            ? entry.expense_account?.sifra
            : entry.revenue_account?.sifra
          : rule?.sifra_konta;

      if (!accountCode) {
        issues.push(`Nedostaje konto za ${field.label}.`);
      }

      const side = rule?.smjer ?? field.direction;

      if (side === "D") {
        debit += amount;
        entryDebit += amount;
      } else {
        credit += amount;
        entryCredit += amount;
      }

      if (accountSource === invoicePostingAccountSources.inputExpense) {
        hasExpenseLine = true;
      }
    }

    if (documentType === invoicePostingDocumentTypes.kuf) {
      const differenceCents = entryDebit - entryCredit;

      if (Math.abs(differenceCents) === 1 && hasExpenseLine) {
        if (differenceCents > 0) {
          credit += differenceCents;
        } else {
          debit -= differenceCents;
        }
      } else if (differenceCents !== 0) {
        const invoiceDescription = [
          entry.internal_kuf_number,
          entry.dobavljac?.naziv,
          entry.supplier_invoice_number
            ? `račun ${entry.supplier_invoice_number}`
            : null
        ]
          .filter(Boolean)
          .join(" · ");
        issues.push(
          `${invoiceDescription || "KUF račun"} ima razliku ` +
            `${differenceText(differenceCents)} EUR.`
        );
      }
    }
  }

  if (unpostedEntries.length > 0 && debit !== credit && issues.length === 0) {
    issues.push("Šema ne balansira dugovno i potražno.");
  }

  return Array.from(new Set(issues));
}

export default async function NeproknjizenoPage({ searchParams }: NeproknjizenoPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const baseMessage = params?.poruka ? poruke[params.poruka] : null;
  const messageWithJournal =
    baseMessage && params?.nalog ? `${baseMessage} Broj naloga: ${params.nalog}.` : baseMessage;
  const message =
    messageWithJournal && params?.detalj
      ? `${messageWithJournal} ${params.detalj}`
      : messageWithJournal;
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <p className="admin-message">Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
      </div>
    );
  }

  const [activeCompany, activeYear] = await Promise.all([
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
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true
      }
    })
  ]);

  if (!activeCompany || !activeYear) {
    return (
      <div className="admin-stack">
        <p className="admin-message">Neproknjiženi računi nisu dostupni za aktivni kontekst.</p>
      </div>
    );
  }

  const [kufBooks, kifBooks, vatRates] = await Promise.all([
    prisma.kufBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false,
        entries: {
          some: {
            is_deleted: false,
            posting_status: "UNPOSTED"
          }
        }
      },
      orderBy: [
        {
          kuf_date: "desc"
        },
        {
          redni_broj: "desc"
        }
      ],
      select: {
        id: true,
        internal_kuf_number: true,
        mjesec: true,
        kuf_date: true,
        racun_vrsta: {
          select: {
            naziv: true,
            dokument_tip: true,
            vrsta_naloga_id: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              select: {
                polje_sifra: true,
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
          select: {
            posting_status: true,
            posting_mode: true,
            journal_id: true,
            is_import: true,
            internal_kuf_number: true,
            supplier_invoice_number: true,
            dobavljac: {
              select: {
                naziv: true
              }
            },
            total_gross: true,
            expense_account: {
              select: {
                sifra: true
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
    }),
    prisma.kifBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false,
        entries: {
          some: {
            is_deleted: false,
            posting_status: "UNPOSTED"
          }
        }
      },
      orderBy: [
        {
          kif_date: "desc"
        },
        {
          redni_broj: "desc"
        }
      ],
      select: {
        id: true,
        internal_kif_number: true,
        mjesec: true,
        kif_date: true,
        racun_vrsta: {
          select: {
            naziv: true,
            dokument_tip: true,
            vrsta_naloga_id: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              select: {
                polje_sifra: true,
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
          select: {
            posting_status: true,
            journal_id: true,
            entry_kind: true,
            total_gross: true,
            revenue_account: {
              select: {
                sifra: true
              }
            },
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

  const journalIds = Array.from(
    new Set(
      [...kufBooks, ...kifBooks]
        .flatMap((book) => book.entries.map((entry) => entry.journal_id))
        .filter((id): id is string => Boolean(id))
    )
  );
  const journals = journalIds.length
    ? await prisma.nalog.findMany({
        where: {
          id: {
            in: journalIds
          },
          is_deleted: false
        },
        select: {
          id: true,
          sifra: true,
          status: true
        }
      })
    : [];
  const journalById = new Map(journals.map((journal) => [journal.id, journal]));
  const kufFields = invoicePostingFields(invoicePostingDocumentTypes.kuf, vatRates);
  const kifFields = invoicePostingFields(invoicePostingDocumentTypes.kif, vatRates);

  const rows: BookRow[] = [
    ...kufBooks.map((book) => {
      const journalId =
        book.entries.find(
          (entry) => entry.posting_mode === "KUF_RULES" && entry.journal_id
        )?.journal_id ?? null;
      const journal = journalId ? journalById.get(journalId) : null;
      const postedEntries = book.entries.filter((entry) => entry.posting_status === "POSTED").length;
      const unpostedEntries = book.entries.filter((entry) => entry.posting_status === "UNPOSTED").length;
      const statusLabel = rowStatus(book.entries.length, postedEntries, unpostedEntries);
      const controlIssues = validateBookForPosting({
        documentType: invoicePostingDocumentTypes.kuf,
        fields: kufFields,
        rules: book.racun_vrsta.kontiranjePravila,
        entries: book.entries,
        journalTypeId: book.racun_vrsta.vrsta_naloga_id,
        journalStatus: journal?.status ?? null
      });

      return {
        id: book.id,
        documentType: invoicePostingDocumentTypes.kuf,
        number: book.internal_kuf_number,
        month: book.mjesec,
        date: book.kuf_date,
        typeName: book.racun_vrsta.naziv,
        totalEntries: book.entries.length,
        unpostedEntries,
        postedEntries,
        totalGross: book.entries.reduce(
          (sum, entry) => sum + Number(entry.total_gross.toString()),
          0
        ),
        journalId,
        journalCode: journal?.sifra ?? null,
        journalStatus: journal?.status ?? null,
        statusLabel,
        controlIssues,
        canPost: unpostedEntries > 0 && controlIssues.length === 0
      };
    }),
    ...kifBooks.map((book) => {
      const journalId = book.entries.find((entry) => entry.journal_id)?.journal_id ?? null;
      const journal = journalId ? journalById.get(journalId) : null;
      const postedEntries = book.entries.filter((entry) => entry.posting_status === "POSTED").length;
      const unpostedEntries = book.entries.filter((entry) => entry.posting_status === "UNPOSTED").length;
      const statusLabel = rowStatus(book.entries.length, postedEntries, unpostedEntries);
      const controlIssues = validateBookForPosting({
        documentType: invoicePostingDocumentTypes.kif,
        fields: kifFields,
        rules: book.racun_vrsta.kontiranjePravila,
        entries: book.entries,
        journalTypeId: book.racun_vrsta.vrsta_naloga_id,
        journalStatus: journal?.status ?? null
      });

      return {
        id: book.id,
        documentType: invoicePostingDocumentTypes.kif,
        number: book.internal_kif_number,
        month: book.mjesec,
        date: book.kif_date,
        typeName: book.racun_vrsta.naziv,
        totalEntries: book.entries.length,
        unpostedEntries,
        postedEntries,
        totalGross: book.entries.reduce(
          (sum, entry) => sum + Number(entry.total_gross.toString()),
          0
        ),
        journalId,
        journalCode: journal?.sifra ?? null,
        journalStatus: journal?.status ?? null,
        statusLabel,
        controlIssues,
        canPost: unpostedEntries > 0 && controlIssues.length === 0
      };
    })
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Neproknjiženo</h2>
          <p>KIF/KUF knjige koje imaju račune za prenos u nalog.</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="metric-grid">
        <div className="metric">
          <span>Firma</span>
          <strong>{activeCompany.naziv}</strong>
          <small>{activeYear.godina}</small>
        </div>
        <div className="metric">
          <span>Knjiga za knjiženje</span>
          <strong>{rows.length}</strong>
          <small>{rows.reduce((sum, row) => sum + row.unpostedEntries, 0)} računa</small>
        </div>
        <div className="metric">
          <span>Neproknjiženo ukupno</span>
          <strong>{decimalText(rows.reduce((sum, row) => sum + row.totalGross, 0))}</strong>
          <small>bruto iznos prikazanih knjiga</small>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Knjige za knjiženje</h3>
          <span>{rows.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tip</th>
                <th>Broj</th>
                <th>Vrsta</th>
                <th>Mjesec</th>
                <th>Datum</th>
                <th>Računa</th>
                <th>Neproknjiženo</th>
                <th>Ukupno</th>
                <th>Status</th>
                <th>Kontrola</th>
                <th>Nalog</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12}>Nema neproknjiženih KIF/KUF knjiga za aktivnu firmu.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.documentType}-${row.id}`}>
                    <td>{row.documentType}</td>
                    <td>
                      <strong>{row.number}</strong>
                    </td>
                    <td>{row.typeName}</td>
                    <td>{mjeseci[row.month - 1] ?? row.month}</td>
                    <td>{displayDate(row.date)}</td>
                    <td>{row.totalEntries}</td>
                    <td>{row.unpostedEntries}</td>
                    <td>{decimalText(row.totalGross)}</td>
                    <td>
                      <span className={classNameForStatus(row.statusLabel)}>
                        {row.statusLabel}
                      </span>
                    </td>
                    <td>
                      {row.controlIssues.length === 0 ? (
                        <span className="status-pill status-pill--success">Spremno</span>
                      ) : (
                        <div className="control-issues">
                          {row.controlIssues.slice(0, 3).map((issue) => (
                            <small key={issue}>{issue}</small>
                          ))}
                          {row.controlIssues.length > 3 ? (
                            <small>+ {row.controlIssues.length - 3} još</small>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>
                      {row.journalId ? (
                        <Link className="table-action" href={`/agencija/nalozi/${row.journalId}`}>
                          {row.journalCode ?? "Vidi nalog"}
                          {row.journalStatus ? <small>{row.journalStatus}</small> : null}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <form action={postInvoiceBook}>
                        <input type="hidden" name="dokument_tip" value={row.documentType} />
                        <input type="hidden" name="book_id" value={row.id} />
                        <input
                          type="hidden"
                          name="return_to"
                          value="/agencija/racuni/neproknjizeno"
                        />
                        <button className="primary-button" type="submit" disabled={!row.canPost}>
                          {row.journalId ? "Dodaj na nalog" : "Proknjiži"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
