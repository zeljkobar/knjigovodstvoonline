import Link from "next/link";
import {
  deleteBankStatement,
  postReadyBankStatements,
  postSelectedBankStatements,
  updateBankStatementLines
} from "./actions";
import { BankStatementImportForm } from "./BankStatementImportForm";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type IzvodiPageProps = {
  searchParams?: Promise<{
    izvod?: string;
    poruka?: string;
    tab?: string;
  }>;
};

const messages: Record<string, string> = {
  godina_zakljucena: "Poslovna godina je zaključena.",
  izvod_obavezno: "Popunite bankovni račun, konto banke, broj, datum i stanja izvoda.",
  izvod_prazan: "Dodajte fajl ili tekst izvoda.",
  izvod_nema_broj: "Parser nije pronašao broj izvoda.",
  izvod_nema_datum: "Parser nije pronašao datum izvoda.",
  izvod_nema_stanja: "Parser nije pronašao početno i krajnje stanje izvoda.",
  izvod_nema_stavki: "Parser nije pronašao stavke izvoda.",
  izvod_duplikat: "Izvod sa tim brojem već postoji za izabrani bankovni račun.",
  izvod_uvezen: "Izvod je uvezen. Provjerite stavke i predlog naloga.",
  izvodi_uvezeni: "Izvodi su uvezeni. Provjerite stavke i predloge naloga.",
  izvodi_uvezeni_djelimicno: "Dio izvoda je uvezen; duplikati ili neispravni fajlovi su preskočeni.",
  izvod_obrisan: "Izvod je obrisan. Možete ga ponovo uvesti.",
  stavke_sacuvane: "Stavke izvoda su sačuvane.",
  izvod_greska: "Izvod nije pronađen ili nije moguće mijenjati ga.",
  izvod_nije_izabran: "Izaberite bar jedan izvod za knjiženje.",
  izvod_broj_naloga_greska: "Broj izvoda nije validan broj naloga.",
  izvod_broj_naloga_zauzet: "Broj naloga za izabranu vrstu naloga je već zauzet.",
  nema_spremnih_izvoda: "Nema izabranih izvoda koji su spremni za knjiženje.",
  partner_obavezan: "Za analitički konto mora biti izabran partner.",
  knjizenje_greska: "Knjiženje izvoda nije uspjelo.",
  izvodi_proknjizeni: "Izabrani izvodi su proknjiženi."
};

const statusLabels: Record<string, string> = {
  IMPORTED: "Uvezen",
  NEEDS_REVIEW: "Za provjeru",
  READY: "Spreman",
  POSTED: "Proknjižen"
};

const lineStatusLabels: Record<string, string> = {
  UNMATCHED: "Neprepoznato",
  MATCHED_PARTNER: "Partner",
  READY: "Spremno",
  NEEDS_REVIEW: "Provjera",
  IGNORED: "Ignorisano"
};

function statementHasValidJournal(statement: {
  journal: { is_deleted?: boolean | null } | null;
}) {
  return Boolean(statement.journal && !statement.journal.is_deleted);
}

function effectiveStatementStatus(statement: {
  status: string;
  journal: { is_deleted?: boolean | null } | null;
}) {
  if (statement.status === "POSTED" && !statementHasValidJournal(statement)) {
    return "NEEDS_REVIEW";
  }

  return statement.status;
}

function effectiveStatementStatusLabel(statement: {
  status: string;
  journal: { is_deleted?: boolean | null } | null;
}) {
  if (statement.status === "POSTED" && !statementHasValidJournal(statement)) {
    return "Nalog obrisan";
  }

  return statusLabels[statement.status] ?? statement.status;
}

function money(value: number) {
  return new Intl.NumberFormat("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function displayDate(value: Date | string) {
  return new Intl.DateTimeFormat("sr-Latn-ME").format(new Date(value));
}

function statementBalanceOk(statement: {
  opening_balance: unknown;
  total_inflow: unknown;
  total_outflow: unknown;
  closing_balance: unknown;
}) {
  const opening = Math.round(Number(statement.opening_balance) * 100);
  const inflow = Math.round(Number(statement.total_inflow) * 100);
  const outflow = Math.round(Number(statement.total_outflow) * 100);
  const closing = Math.round(Number(statement.closing_balance) * 100);

  return opening + inflow - outflow === closing;
}

export default async function IzvodiPage({ searchParams }: IzvodiPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const workContext = await readWorkContext();
  const activeTab = params?.tab === "nalog" ? "nalog" : "stavke";

  if (!user.agencija_id) {
    return null;
  }

  const activeCompany = workContext.firmaId
    ? await prisma.firma.findFirst({
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
      })
    : null;

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true,
            zakljucena: true
          }
        })
      : null;

  const [bankAccounts, bankSettings, baseAccounts, companyOverrides, statements, businessUnits] =
    activeCompany && activeYear
      ? await Promise.all([
          prisma.firmaBankovniRacun.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              is_deleted: false,
              aktivan: true
            },
            orderBy: [
              {
                glavni: "desc"
              },
              {
                naziv_banke: "asc"
              }
            ],
            select: {
              id: true,
              naziv_banke: true,
              broj_racuna: true,
              valuta: true,
              glavni: true
            }
          }),
          prisma.bankStatementAccountSetting.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id
            },
            orderBy: [
              {
                last_used_at: "desc"
              },
              {
                updated_at: "desc"
              }
            ],
            include: {
              bank_account_konto: {
                select: {
                  sifra: true
                }
              }
            }
          }),
          prisma.konto.findMany({
            where: {
              aktivan: true,
              tip_konta: "analiticko"
            },
            orderBy: {
              sifra: "asc"
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
              firma_id: activeCompany.id
            },
            orderBy: {
              sifra: "asc"
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
          prisma.bankStatement.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              poslovna_godina_id: activeYear.id,
              is_deleted: false
            },
            orderBy: [
              {
                statement_date: "desc"
              },
              {
                statement_number: "desc"
              }
            ],
            select: {
              id: true,
              statement_number: true,
              company_bank_account_id: true,
              statement_date: true,
              opening_balance: true,
              total_inflow: true,
              total_outflow: true,
              closing_balance: true,
              status: true,
              parse_notes: true,
              company_bank_account: {
                select: {
                  naziv_banke: true,
                  broj_racuna: true
                }
              },
              journal: {
                select: {
                  id: true,
                  sifra: true,
                  is_deleted: true
                }
              },
              _count: {
                select: {
                  lines: true
                }
              }
            }
          }),
          prisma.poslovnaJedinica.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              aktivna: true,
              is_deleted: false
            },
            orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
            select: { id: true, sifra: true, naziv: true }
          })
        ])
      : [[], [], [], [], [], []];

  const accountOptions = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const settingByBankAccount = new Map(
    bankSettings.map((setting) => [setting.company_bank_account_id, setting])
  );
  const defaultBankAccountId =
    bankSettings.find((setting) => setting.last_used_at)?.company_bank_account_id ??
    statements[0]?.company_bank_account_id ??
    bankAccounts.find((account) => account.glavni)?.id ??
    bankAccounts[0]?.id ??
    "";
  const selectedStatementId = params?.izvod ?? null;
  const selectedStatement =
    activeCompany && activeYear && selectedStatementId
      ? await prisma.bankStatement.findFirst({
          where: {
            id: selectedStatementId,
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            poslovna_godina_id: activeYear.id,
            is_deleted: false
          },
          include: {
            company_bank_account: true,
            bank_account_konto: true,
            journal: {
              select: {
                id: true,
                sifra: true,
                is_deleted: true,
                status: true
              }
            },
            lines: {
              orderBy: {
                line_number: "asc"
              },
              include: {
                partner: {
                  select: {
                    id: true,
                    naziv: true,
                    pib: true,
                    scope: true
                  }
                },
                debit_account: {
                  select: {
                    id: true,
                    sifra: true,
                    naziv: true
                  }
                },
                credit_account: {
                  select: {
                    id: true,
                    sifra: true,
                    naziv: true
                  }
                },
                allocations: {
                  select: {
                    id: true,
                    document_type: true,
                    amount: true,
                    kif_entry_id: true,
                    kuf_entry_id: true,
                    kif_entry: {
                      select: {
                        internal_kif_number: true,
                        customer_invoice_number: true,
                        invoice_date: true,
                        total_gross: true
                      }
                    },
                    kuf_entry: {
                      select: {
                        internal_kuf_number: true,
                        supplier_invoice_number: true,
                        invoice_date: true,
                        total_gross: true
                      }
                    }
                  }
                }
              }
            }
          }
        })
      : null;

  const selectedBalanceOk = selectedStatement ? statementBalanceOk(selectedStatement) : false;
  const selectedReady =
    selectedStatement?.lines.every((line) =>
      ["READY", "IGNORED"].includes(line.posting_status)
    ) ?? false;
  const selectedStatementCanBeDeleted = selectedStatement
    ? effectiveStatementStatus(selectedStatement) !== "POSTED" && !statementHasValidJournal(selectedStatement)
    : false;
  const activePreviewLines =
    selectedStatement?.lines.filter((line) => line.posting_status !== "IGNORED") ?? [];
  const totalInflowPreview = activePreviewLines.reduce(
    (sum, line) => sum + Number(line.inflow_amount),
    0
  );
  const totalOutflowPreview = activePreviewLines.reduce(
    (sum, line) => sum + Number(line.outflow_amount),
    0
  );
  const totalDebitPreview =
    totalInflowPreview + totalOutflowPreview;
  const totalCreditPreview = totalDebitPreview;
  const selectedLinePartners = Array.from(
    new Set(
      selectedStatement?.lines
        .map((line) => line.partner_id)
        .filter((partnerId): partnerId is string => Boolean(partnerId)) ?? []
    )
  );
  const selectedKifAllocationIds = Array.from(
    new Set(
      selectedStatement?.lines
        .flatMap((line) => line.allocations.map((allocation) => allocation.kif_entry_id))
        .filter((entryId): entryId is string => Boolean(entryId)) ?? []
    )
  );
  const selectedKufAllocationIds = Array.from(
    new Set(
      selectedStatement?.lines
        .flatMap((line) => line.allocations.map((allocation) => allocation.kuf_entry_id))
        .filter((entryId): entryId is string => Boolean(entryId)) ?? []
    )
  );
  const [kifPaymentCandidates, kufPaymentCandidates] =
    activeCompany && activeYear && selectedStatement && selectedLinePartners.length > 0
      ? await Promise.all([
          prisma.kifEntry.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              poslovna_godina_id: activeYear.id,
              is_deleted: false,
              kupac_id: {
                in: selectedLinePartners
              },
              OR: [
                {
                  payment_status: {
                    in: ["UNPAID", "PARTIALLY_PAID"]
                  }
                },
                {
                  id: {
                    in: selectedKifAllocationIds
                  }
                }
              ]
            },
            orderBy: [
              {
                invoice_date: "asc"
              },
              {
                redni_broj: "asc"
              }
            ],
            include: {
              bankStatementAllocations: {
                select: {
                  amount: true
                }
              }
            }
          }),
          prisma.kufEntry.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              poslovna_godina_id: activeYear.id,
              is_deleted: false,
              dobavljac_id: {
                in: selectedLinePartners
              },
              OR: [
                {
                  payment_status: {
                    in: ["UNPAID", "PARTIALLY_PAID"]
                  }
                },
                {
                  id: {
                    in: selectedKufAllocationIds
                  }
                }
              ]
            },
            orderBy: [
              {
                invoice_date: "asc"
              },
              {
                redni_broj: "asc"
              }
            ],
            include: {
              bankStatementAllocations: {
                select: {
                  amount: true
                }
              }
            }
          })
        ])
      : [[], []];
  const kifCandidatesByPartner = new Map<string, typeof kifPaymentCandidates>();
  const kufCandidatesByPartner = new Map<string, typeof kufPaymentCandidates>();

  for (const entry of kifPaymentCandidates) {
    const entries = kifCandidatesByPartner.get(entry.kupac_id) ?? [];

    entries.push(entry);
    kifCandidatesByPartner.set(entry.kupac_id, entries);
  }

  for (const entry of kufPaymentCandidates) {
    const entries = kufCandidatesByPartner.get(entry.dobavljac_id) ?? [];

    entries.push(entry);
    kufCandidatesByPartner.set(entry.dobavljac_id, entries);
  }

  const allocatedCents = (allocations: { amount: unknown }[]) =>
    allocations.reduce((sum, allocation) => sum + Math.round(Number(allocation.amount) * 100), 0);
  const entryRemainingCents = (entry: {
    total_gross: unknown;
    bankStatementAllocations: { amount: unknown }[];
  }) => Math.round(Number(entry.total_gross) * 100) - allocatedCents(entry.bankStatementAllocations);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Izvodi</h2>
          <p>Uvoz, kontrola i knjiženje bankovnih izvoda.</p>
        </div>
      </header>

      {params?.poruka ? <p className="admin-message">{messages[params.poruka] ?? params.poruka}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i poslovnu godinu</h3>
          <p className="empty-state">Izvodi se vode za aktivnu firmu i godinu iz gornje trake.</p>
        </section>
      ) : (
        <>
          {!selectedStatement ? (
            <>
              <section className="admin-panel">
                <h3>Uvoz izvoda</h3>
                <BankStatementImportForm
                  accountOptions={accountOptions.map((account) => ({
                    id: account.id,
                    label: `${account.sifra} - ${account.naziv}`,
                    sifra: account.sifra
                  }))}
                  bankAccounts={bankAccounts.map((account) => {
                    const setting = settingByBankAccount.get(account.id);

                    return {
                      id: account.id,
                      label: `${account.naziv_banke} · ${account.broj_racuna}${account.glavni ? " · glavni" : ""}`,
                      bankAccountKontoCode: setting?.bank_account_konto?.sifra ?? ""
                    };
                  })}
                  defaultBankAccountId={defaultBankAccountId}
                  businessUnits={businessUnits}
                />
              </section>

              <section className="admin-panel">
                {statements.length === 0 ? (
                  <>
                    <div className="section-title-row">
                      <div>
                        <h3>Pregled izvoda</h3>
                        <p>{statements.length} izvoda za {activeCompany.naziv} / {activeYear.godina}</p>
                      </div>
                      <p className="muted-note">Knjižiti se mogu samo izvodi sa statusom Spreman.</p>
                    </div>
                    <p className="empty-state">Nema uvezenih izvoda za aktivnu firmu i godinu.</p>
                  </>
                ) : (
                  <form action={postSelectedBankStatements}>
                    <div className="section-title-row">
                      <div>
                        <h3>Pregled izvoda</h3>
                        <p>{statements.length} izvoda za {activeCompany.naziv} / {activeYear.godina}</p>
                        <p className="muted-note">Knjižiti se mogu samo izvodi sa statusom Spreman.</p>
                      </div>
                      <div className="table-action-row statement-top-actions">
                        <button className="primary-button compact-action" type="submit">
                          Proknjiži izabrane
                        </button>
                        <button
                          className="secondary-button compact-action"
                          formAction={postReadyBankStatements}
                          type="submit"
                        >
                          Proknjiži spremne
                        </button>
                      </div>
                    </div>
                    <div className="responsive-table">
                      <table>
                        <thead>
                          <tr>
                            <th />
                            <th>Banka</th>
                            <th>Broj</th>
                            <th>Datum</th>
                            <th>Status</th>
                            <th>Prethodno</th>
                            <th>Odliv</th>
                            <th>Priliv</th>
                            <th>Tekuće</th>
                            <th>Stavke</th>
                            <th>Nalog</th>
                            <th>Akcija</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statements.map((statement) => {
                            const effectiveStatus = effectiveStatementStatus(statement);

                            return (
                              <tr key={statement.id} className={statement.id === selectedStatementId ? "selected-row" : ""}>
                                <td>
                                  <input
                                    disabled={effectiveStatus !== "READY"}
                                    name="statement_id"
                                    type="checkbox"
                                    value={statement.id}
                                  />
                                </td>
                                <td>
                                  <strong>{statement.company_bank_account.naziv_banke}</strong>
                                  <small>{statement.company_bank_account.broj_racuna}</small>
                                </td>
                                <td>{statement.statement_number}</td>
                                <td>{displayDate(statement.statement_date)}</td>
                                <td>
                                  <span className={`status-pill status-${effectiveStatus.toLowerCase()}`}>
                                    {effectiveStatementStatusLabel(statement)}
                                  </span>
                                  {statement.parse_notes ? <small>{statement.parse_notes}</small> : null}
                                </td>
                                <td>{money(Number(statement.opening_balance))}</td>
                                <td>{money(Number(statement.total_outflow))}</td>
                                <td>{money(Number(statement.total_inflow))}</td>
                                <td>{money(Number(statement.closing_balance))}</td>
                                <td>{statement._count.lines}</td>
                                <td>
                                  {statement.journal && !statement.journal.is_deleted ? (
                                    <Link className="table-link" href={`/agencija/nalozi/${statement.journal.id}`}>
                                      {statement.journal.sifra}
                                    </Link>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td>
                                  <Link className="table-link" href={`/agencija/izvodi?izvod=${statement.id}&tab=${activeTab}`}>
                                    Otvori
                                  </Link>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </form>
                )}
              </section>
            </>
          ) : null}

          {selectedStatement ? (
            <section className="admin-panel">
              <div className="section-title-row">
                <div>
                  <h3>
                    Izvod {selectedStatement.statement_number} · {selectedStatement.company_bank_account.naziv_banke}
                  </h3>
                  <p>
                    Kontrola stanja: {selectedBalanceOk ? "ispravna" : "nije ispravna"} · Stavke:{" "}
                    {selectedReady ? "spremne" : "za provjeru"}
                  </p>
                </div>
                <div className="table-action-row statement-top-actions">
                  <Link className="secondary-button compact-action" href="/agencija/izvodi">
                    Povrat na spisak izvoda
                  </Link>
                  {selectedStatement.journal ? (
                    <Link className="table-link" href={`/agencija/nalozi/${selectedStatement.journal.id}`}>
                      Otvori nalog {selectedStatement.journal.sifra}
                    </Link>
                  ) : null}
                  {selectedStatementCanBeDeleted ? (
                    <form action={deleteBankStatement}>
                      <input name="statement_id" type="hidden" value={selectedStatement.id} />
                      <button className="table-button table-button-danger compact-action" type="submit">
                        Obriši izvod
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>

              <div className="tabs-row">
                <Link
                  className={activeTab === "stavke" ? "tab-link active" : "tab-link"}
                  href={`/agencija/izvodi?izvod=${selectedStatement.id}&tab=stavke`}
                >
                  Stavke izvoda
                </Link>
                <Link
                  className={activeTab === "nalog" ? "tab-link active" : "tab-link"}
                  href={`/agencija/izvodi?izvod=${selectedStatement.id}&tab=nalog`}
                >
                  Predlog naloga
                </Link>
              </div>

              {activeTab === "stavke" ? (
                <div className="responsive-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Datum</th>
                        <th>Opis</th>
                        <th>Šifra</th>
                        <th>Žiro račun</th>
                        <th>Partner</th>
                        <th>Zatvara račun</th>
                        <th>Odliv</th>
                        <th>Priliv</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStatement.lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.line_number}</td>
                          <td>{displayDate(line.posting_date)}</td>
                          <td>
                            <strong>{line.description}</strong>
                            {line.raw_text ? <small>{line.raw_text}</small> : null}
                          </td>
                          <td>{line.payment_code ?? "-"}</td>
                          <td>{line.counterparty_account_number ?? "-"}</td>
                          <td>
                            {line.partner ? (
                              <>
                                <strong>{line.partner.naziv}</strong>
                                <small>{line.partner.pib}</small>
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>
                            {line.allocations.length > 0 ? (
                              line.allocations.map((allocation) => (
                                <small key={allocation.id}>
                                  {allocation.document_type}{" "}
                                  {allocation.kif_entry?.customer_invoice_number ??
                                    allocation.kuf_entry?.supplier_invoice_number ??
                                    "-"}{" "}
                                  · {money(Number(allocation.amount))}
                                </small>
                              ))
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{money(Number(line.outflow_amount))}</td>
                          <td>{money(Number(line.inflow_amount))}</td>
                          <td>{lineStatusLabels[line.posting_status] ?? line.posting_status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <form action={updateBankStatementLines}>
                  <input name="statement_id" type="hidden" value={selectedStatement.id} />
                  <div className="responsive-table statement-preview-table">
                    <table>
                      <thead>
                        <tr>
                          <th className="statement-col-number">#</th>
                          <th className="statement-col-description">Opis</th>
                          <th className="statement-col-partner">Partner</th>
                          <th className="statement-col-account">Zatvara račun</th>
                          <th className="statement-col-account">Konto stavke</th>
                          <th className="statement-col-amount">Duguje</th>
                          <th className="statement-col-amount">Potražuje</th>
                          <th className="statement-col-ignore">Ignoriši</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedStatement.bank_account_konto && totalInflowPreview > 0 ? (
                          <tr className="statement-bank-row">
                            <td className="statement-col-number">1</td>
                            <td className="statement-col-description">
                              <strong>Ukupan priliv po izvodu {selectedStatement.statement_number}</strong>
                              <small>Banka se knjiži zbirno automatski</small>
                            </td>
                            <td className="statement-col-partner">-</td>
                            <td className="statement-col-account">-</td>
                            <td className="statement-col-account">
                              {selectedStatement.bank_account_konto.sifra} - {selectedStatement.bank_account_konto.naziv}
                            </td>
                            <td className="statement-col-amount">{money(totalInflowPreview)}</td>
                            <td className="statement-col-amount">0,00</td>
                            <td className="statement-col-ignore">-</td>
                          </tr>
                        ) : null}
                        {selectedStatement.bank_account_konto && totalOutflowPreview > 0 ? (
                          <tr className="statement-bank-row">
                            <td className="statement-col-number">{totalInflowPreview > 0 ? 2 : 1}</td>
                            <td className="statement-col-description">
                              <strong>Ukupan odliv po izvodu {selectedStatement.statement_number}</strong>
                              <small>Banka se knjiži zbirno automatski</small>
                            </td>
                            <td className="statement-col-partner">-</td>
                            <td className="statement-col-account">-</td>
                            <td className="statement-col-account">
                              {selectedStatement.bank_account_konto.sifra} - {selectedStatement.bank_account_konto.naziv}
                            </td>
                            <td className="statement-col-amount">0,00</td>
                            <td className="statement-col-amount">{money(totalOutflowPreview)}</td>
                            <td className="statement-col-ignore">-</td>
                          </tr>
                        ) : null}
                        {selectedStatement.lines.map((line) => {
                          const amount = Number(line.inflow_amount) || Number(line.outflow_amount);
                          const isInflow = line.direction === "INFLOW";
                          const selectedAccountCode = isInflow
                            ? line.credit_account?.sifra
                            : line.debit_account?.sifra;
                          const selectedAllocation = line.allocations[0] ?? null;
                          const allocationValue = selectedAllocation
                            ? `${selectedAllocation.document_type}:${
                                selectedAllocation.kif_entry_id ?? selectedAllocation.kuf_entry_id ?? ""
                              }`
                            : "";
                          const paymentCandidates = line.partner_id
                            ? isInflow
                              ? kifCandidatesByPartner.get(line.partner_id) ?? []
                              : kufCandidatesByPartner.get(line.partner_id) ?? []
                            : [];

                          return (
                            <tr key={line.id}>
                              <td className="statement-col-number">{line.line_number}</td>
                              <td className="statement-col-description">
                                <strong>{line.description}</strong>
                                <small>
                                  {line.direction === "INFLOW" ? "Priliv" : "Odliv"} ·{" "}
                                  {line.counterparty_account_number ?? "bez računa"}
                                </small>
                                <input name="line_id" type="hidden" value={line.id} />
                                <input name="line_direction" type="hidden" value={line.direction} />
                              </td>
                              <td className="statement-col-partner">
                                <PartnerSearchInput
                                  initialPartner={
                                    line.partner
                                      ? {
                                          id: line.partner.id,
                                          label: `${line.partner.naziv}${line.partner.pib ? ` (${line.partner.pib})` : ""}`,
                                          naziv: line.partner.naziv,
                                          pib: line.partner.pib,
                                          scope: line.partner.scope
                                        }
                                      : null
                                  }
                                  label=""
                                  name="partner_id"
                                />
                              </td>
                              <td className="statement-col-account">
                                <select defaultValue={allocationValue} name="allocation_target">
                                  <option value="">
                                    {line.partner_id ? "Ne zatvara račun" : "Prvo izaberite partnera"}
                                  </option>
                                  {paymentCandidates.map((entry) => {
                                    const remaining = entryRemainingCents(entry);
                                    const current =
                                      selectedAllocation?.kif_entry_id === entry.id ||
                                      selectedAllocation?.kuf_entry_id === entry.id;
                                    const documentType = isInflow ? "KIF" : "KUF";
                                    const invoiceNumber = isInflow
                                      ? "customer_invoice_number" in entry
                                        ? entry.customer_invoice_number
                                        : ""
                                      : "supplier_invoice_number" in entry
                                        ? entry.supplier_invoice_number
                                        : "";
                                    const internalNumber = isInflow
                                      ? "internal_kif_number" in entry
                                        ? entry.internal_kif_number
                                        : ""
                                      : "internal_kuf_number" in entry
                                        ? entry.internal_kuf_number
                                        : "";
                                    const openAmount = Math.max(0, current ? remaining + Math.round(Number(selectedAllocation?.amount ?? 0) * 100) : remaining);

                                    return (
                                      <option key={`${documentType}:${entry.id}`} value={`${documentType}:${entry.id}`}>
                                        {internalNumber} · {invoiceNumber} · otvoreno {money(openAmount / 100)}
                                      </option>
                                    );
                                  })}
                                </select>
                                {selectedAllocation ? (
                                  <small>Vezano: {money(Number(selectedAllocation.amount))}</small>
                                ) : null}
                              </td>
                              <td className="statement-col-account">
                                <select
                                  defaultValue={selectedAccountCode ?? ""}
                                  name={isInflow ? "credit_account_code" : "debit_account_code"}
                                >
                                  <option value="">-</option>
                                  {accountOptions.map((account) => (
                                    <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
                                      {account.sifra} - {account.naziv}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  name={isInflow ? "debit_account_code" : "credit_account_code"}
                                  type="hidden"
                                  value=""
                                />
                              </td>
                              <td className="statement-col-amount">
                                {line.direction === "OUTFLOW" ? money(amount) : "0,00"}
                              </td>
                              <td className="statement-col-amount">
                                {line.direction === "INFLOW" ? money(amount) : "0,00"}
                              </td>
                              <td className="statement-col-ignore">
                                <input
                                  defaultChecked={line.posting_status === "IGNORED"}
                                  name="ignored_line_id"
                                  type="checkbox"
                                  value={line.id}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={5}>Ukupno preview naloga</td>
                          <td className="statement-col-amount">{money(totalDebitPreview)}</td>
                          <td className="statement-col-amount">{money(totalCreditPreview)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <button
                    className="primary-button"
                    disabled={effectiveStatementStatus(selectedStatement) === "POSTED"}
                    type="submit"
                  >
                    Sačuvaj predlog naloga
                  </button>
                </form>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
