import { effectiveBankSetting } from "@/lib/posting-template";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import Link from "next/link";
import {
  deleteBankStatement,
  postReadyBankStatements,
  postSelectedBankStatements,
  reapplyBankStatementRules,
  reopenPostedBankStatement,
  updateBankStatementLines
} from "./actions";
import { BankStatementImportForm } from "./BankStatementImportForm";
import { BankStatementPartnerInput } from "@/components/BankStatementPartnerInput";
import { cbcgAccountParts } from "@/lib/cbcg-browser-bridge";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { bankStatementAmountBlockers, bankStatementAmountsReady, bankStatementLineBlockers } from "@/lib/bank-statement-rules";
import { postedBankAllocationWhere } from "@/lib/bank-statement-lifecycle";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { decimalToScaled } from "@/lib/inventory-calculation";
import { manualBankMessages, manualLedgerBalanced } from "@/lib/bank-manual-journal-input";
import { postManualBankJournalAction } from "./[id]/nalog/actions";

type IzvodiPageProps = {
  searchParams?: Promise<{
    izvod?: string;
    poruka?: string;
    tab?: string;
  }>;
};

const messages: Record<string, string> = {
  ...manualBankMessages,
  izvod_promet_greska: "Zbir ili smjer stavki ne odgovara zaglavlju izvoda. Provjerite prikazane razlike i originalni fajl; izvod nije knjižen.",
  izvodi_za_provjeru: "Preostali izvodi imaju neusaglašene stavke i zahtijevaju provjeru. Nijesu knjiženi.",
  izvodi_proknjizeni_dio_za_provjeru: "Ispravni izvodi su proknjiženi. Izvodi sa neusaglašenim stavkama nijesu knjiženi i u pregledu su označeni Za provjeru.",
  izvod_nacrt: "Izvod i nalog su vraćeni u nacrt. Ispravite predlog naloga, sačuvajte ga i ponovo proknjižite izvod.",
  pdv_period_zakljucan: "PDV period je zaključan. Izvod nije moguće rasknjižiti ili mijenjati.",
  prava: "Nemate pravo za ovu akciju.",
  izvod_promijenjen: "Izvod je u međuvremenu promijenjen. Osvježite stranicu i ponovite izmjenu.",
  izvod_nalog_veze: "Veza izvoda i naloga nije ispravna ili nalog ima druge zavisnosti. Izmjena je blokirana.",
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
  pravila_primijenjena: "Pravila su ponovo primijenjena na neriješene stavke.",
  pravila_bez_promjene: "Nijedna neriješena stavka nije mogla biti dopunjena postojećim pravilima.",
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

type StatementStatusInput = Parameters<typeof bankStatementAmountBlockers>[0] & {
  status: string;
  journal_mode?: string;
  journal: { status?: string; is_deleted?: boolean | null } | null;
};

function isLegacyDraft(statement: Pick<StatementStatusInput, "status" | "journal">) {
  return statement.status === "POSTED" && statementHasValidJournal(statement) && statement.journal?.status === "DRAFT";
}

function effectiveStatementStatus(statement: StatementStatusInput) {
  if (isLegacyDraft(statement)) return "NEEDS_REVIEW";
  if (statement.journal_mode !== "MANUAL" && statement.status === "READY" && bankStatementAmountBlockers(statement).length) return "NEEDS_REVIEW";
  if (statement.status === "POSTED" && !statementHasValidJournal(statement)) {
    return "NEEDS_REVIEW";
  }

  return statement.status;
}

function effectiveStatementStatusLabel(statement: StatementStatusInput) {
  if (isLegacyDraft(statement)) return "Nalog u nacrtu";
  if (statement.status === "POSTED" && !statementHasValidJournal(statement)) {
    return "Nalog obrisan";
  }

  return statusLabels[effectiveStatementStatus(statement)] ?? statement.status;
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

  if (activeCompany) {
    await requirePermissionForUser(user, {
      firmaId: activeCompany.id,
      modul: "izvodi",
      akcija: "view"
    });
  }

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
              journal_mode: true,
              parse_notes: true,
              lines: { select: { line_number: true, direction: true, posting_status: true, inflow_amount: true, outflow_amount: true } },
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
                  status: true,
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
  for (const bank of bankAccounts) {
    const effective = await effectiveBankSetting(prisma, activeCompany!.id, bank.id);
    if (effective) {
      const existingIndex = bankSettings.findIndex(row => row.company_bank_account_id === bank.id);
      if (existingIndex >= 0) bankSettings[existingIndex] = effective;
      else bankSettings.push(effective);
    }
  }


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
                status: true,
                is_deleted: true,
                updated_at: true,
                stavke: { orderBy: { redni_broj: "asc" }, include: { firma_konto: true, komitent: true } }
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
                    naziv: true,
                    analitika_obavezna: true
                  }
                },
                credit_account: {
                  select: {
                    id: true,
                    sifra: true,
                    naziv: true,
                    analitika_obavezna: true
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

  const canPost = Boolean(activeCompany && activeYear && !activeYear.zakljucena && await hasPermission(user, { firmaId: activeCompany.id, modul: "izvodi", akcija: "post" }));
  const canUpdate = Boolean(activeCompany && activeYear && !activeYear.zakljucena && await hasPermission(user, { firmaId: activeCompany.id, modul: "izvodi", akcija: "update" }));
  const canEditJournal = Boolean(selectedStatement && canUpdate && effectiveStatementStatus(selectedStatement) !== "POSTED"
    && await hasPermission(user, { firmaId: activeCompany!.id, modul: "nalozi", akcija: "view" })
    && await hasPermission(user, { firmaId: activeCompany!.id, modul: "nalozi", akcija: "update" }));
  const manualJournal = selectedStatement?.journal_mode === "MANUAL";
  const canEditSelected = Boolean(selectedStatement && canUpdate
    && !manualJournal && effectiveStatementStatus(selectedStatement) !== "POSTED" && (!isLegacyDraft(selectedStatement) || canPost));
  const selectedBalanceOk = selectedStatement ? statementBalanceOk(selectedStatement) : false;
  const selectedReady = selectedStatement ? manualJournal ? manualLedgerBalanced(selectedStatement.journal?.stavke ?? []) : bankStatementAmountsReady(selectedStatement) : false;
  const selectedStatementCanBeDeleted = selectedStatement
    ? effectiveStatementStatus(selectedStatement) !== "POSTED" && !statementHasValidJournal(selectedStatement)
    : false;
  const selectedLineBlockers = new Map(
    selectedStatement?.lines.map((line) => {
      const account = line.direction === "INFLOW" ? line.credit_account : line.debit_account;

      return [
        line.id,
        bankStatementLineBlockers({
          lineNumber: line.line_number,
          ignored: line.posting_status === "IGNORED",
          postingStatus: line.posting_status,
          accountCode: account?.sifra ?? null,
          accountRequiresPartner: Boolean(account?.analitika_obavezna),
          partnerId: line.partner_id
        })
      ] as const;
    }) ?? []
  );
  const selectedStatementBlockers = [
    ...(selectedStatement ? bankStatementAmountBlockers(selectedStatement) : []),
    ...Array.from(selectedLineBlockers.values()).flat()
  ];
  const activePreviewLines =
    selectedStatement?.lines.filter((line) => line.posting_status !== "IGNORED") ?? [];
  // Bank rows follow the statement header, just like posting. Do not fabricate
  // a balancing bank inflow from a misparsed commission in a draft's rows.
  const totalInflowPreview = Number(selectedStatement?.total_inflow ?? 0);
  const totalOutflowPreview = Number(selectedStatement?.total_outflow ?? 0);
  const previewAmountCents = (line: (typeof activePreviewLines)[number]) => decimalToScaled(line.inflow_amount, 2) || decimalToScaled(line.outflow_amount, 2);
  const totalDebitPreview = Number(decimalToScaled(selectedStatement?.total_inflow ?? "0", 2)
    + activePreviewLines.filter(line => line.direction === "OUTFLOW").reduce((sum, line) => sum + previewAmountCents(line), BigInt(0))) / 100;
  const totalCreditPreview = Number(decimalToScaled(selectedStatement?.total_outflow ?? "0", 2)
    + activePreviewLines.filter(line => line.direction === "INFLOW").reduce((sum, line) => sum + previewAmountCents(line), BigInt(0))) / 100;
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
                where: postedBankAllocationWhere,
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
                where: postedBankAllocationWhere,
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
                            const amountBlockers = effectiveStatus === "POSTED" ? [] : bankStatementAmountBlockers(statement);
                            const parseNotes = amountBlockers.length
                              ? statement.parse_notes?.replace("Sve stavke su mapirane pravilima; izvod je spreman za knjiženje.", "").replace(/\s*\|\s*$/, "").trim()
                              : statement.parse_notes;

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
                                  {parseNotes ? <small>{parseNotes}</small> : null}
                                  {statement.journal_mode === "MANUAL" ? <small>Ručno uređen nalog</small> : null}
                                  {amountBlockers.map(issue => <small className="control-issue" key={issue}>{issue}</small>)}
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
                  {canEditJournal ? <Link className="primary-button compact-action" href={`/agencija/izvodi/${selectedStatement.id}/nalog`}>Edituj nalog</Link> : null}
                  {canEditSelected && (!selectedStatement.journal || selectedStatement.journal.status === "DRAFT") ? (
                    <form action={reapplyBankStatementRules}>
                      <input name="statement_id" type="hidden" value={selectedStatement.id} />
                      <button className="secondary-button compact-action" type="submit">
                        Ponovo primijeni pravila
                      </button>
                    </form>
                  ) : null}
                  {canPost && canUpdate && selectedStatement.status === "POSTED" && (selectedStatement.journal?.status === "POSTED" || isLegacyDraft(selectedStatement)) ? (
                    <form action={reopenPostedBankStatement}>
                      <input name="statement_id" type="hidden" value={selectedStatement.id} />
                      <button className="secondary-button compact-action" type="submit">{isLegacyDraft(selectedStatement) ? "Uskladi sa nacrtom" : "Vrati u nacrt"}</button>
                    </form>
                  ) : null}
                  {canPost && !manualJournal && selectedStatement.status === "READY" && selectedBalanceOk && selectedReady ? (
                    <form action={postSelectedBankStatements}>
                      <input name="statement_id" type="hidden" value={selectedStatement.id} />
                      <input name="statement_version" type="hidden" value={selectedStatement.updated_at.toISOString()} />
                      <input name="journal_id" type="hidden" value={selectedStatement.journal_id ?? ""} />
                      <input name="journal_version" type="hidden" value={selectedStatement.journal?.updated_at.toISOString() ?? ""} />
                      <button className="primary-button compact-action" type="submit">Proknjiži izvod</button>
                    </form>
                  ) : null}
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

              {selectedStatement.journal?.status === "DRAFT" ? (
                <p className="status-banner">Nalog je u nacrtu i ne ulazi u glavnu knjigu. Veze sa fakturama ostaju sačuvane kao predlog; uplate se ponovo aktiviraju nakon knjiženja izvoda.</p>
              ) : null}
              {isLegacyDraft(selectedStatement) ? <p className="status-banner">
                Izvod ima staru oznaku knjiženja, a povezani nalog je u nacrtu. Uskladi sa nacrtom ili Sačuvaj predlog naloga uskladiće statuse uz provjeru prava i zaključavanja. Iznosi se time ne mijenjaju.
              </p> : null}
              {selectedStatementBlockers.length > 0 ? (
                <div className={`status-banner ${manualJournal ? "" : "error"} statement-blockers`}>
                  <strong>{manualJournal ? "Napomene izvornog parsiranja — ručno uređen nalog se provjerava zasebno:" : "Knjiženje je blokirano:"}</strong>
                  <ul>
                    {selectedStatementBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
                      {selectedStatement.lines.map((line) => {
                        const lineBlockers = selectedLineBlockers.get(line.id) ?? [];

                        return (
                          <tr
                            className={lineBlockers.length > 0 ? "statement-row-blocked" : undefined}
                            key={line.id}
                          >
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
                                canEditSelected && selectedStatement.bank_account_konto_id && cbcgAccountParts(line.counterparty_account_number ?? "") ? (
                                  <form action={updateBankStatementLines}>
                                    <input name="statement_id" type="hidden" value={selectedStatement.id} />
                                    <input name="statement_version" type="hidden" value={selectedStatement.updated_at.toISOString()} />
                                    <input name="line_id" type="hidden" value={line.id} />
                                    <input name="line_direction" type="hidden" value={line.direction} />
                                    <input name="debit_account_code" type="hidden" value={line.debit_account?.sifra ?? ""} />
                                    <input name="credit_account_code" type="hidden" value={line.credit_account?.sifra ?? ""} />
                                    <input name="allocation_target" type="hidden" value={line.allocations[0] ? `${line.allocations[0].document_type}:${line.allocations[0].kif_entry_id ?? line.allocations[0].kuf_entry_id ?? ""}` : ""} />
                                    {line.posting_status === "IGNORED" ? <input name="ignored_line_id" type="hidden" value={line.id} /> : null}
                                    <BankStatementPartnerInput key={`${line.id}:${selectedStatement.updated_at.toISOString()}`} account={line.counterparty_account_number} compact disabled={false} initialPartner={null} />
                                  </form>
                                ) : "-"
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
                            <td>
                              {lineStatusLabels[line.posting_status] ?? line.posting_status}
                              {lineBlockers.map((blocker) => (
                                <small className="control-issue" key={blocker}>
                                  {blocker}
                                </small>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : manualJournal && selectedStatement.journal ? (
                <div className="admin-stack">
                  <p className="status-banner">Ručno uređen nalog. Parser ne mijenja ove stavke. Iznosi izvornog izvoda ostaju kao referenca.</p>
                  <div className="responsive-table"><table><thead><tr><th>#</th><th>Konto</th><th>Partner</th><th>Opis</th><th>Dokument</th><th>Duguje</th><th>Potražuje</th></tr></thead><tbody>
                    {selectedStatement.journal.stavke.map(line => <tr key={line.id}><td>{line.redni_broj}</td><td>{line.firma_konto.sifra} · {line.firma_konto.naziv}</td><td>{line.komitent?.naziv ?? "—"}</td><td>{line.opis}</td><td>{line.broj_dokumenta}</td><td>{money(Number(line.duguje))}</td><td>{money(Number(line.potrazuje))}</td></tr>)}
                  </tbody><tfoot><tr><td colSpan={5}>Ukupno naloga</td><td>{money(Number(selectedStatement.journal.stavke.reduce((sum, row) => sum + decimalToScaled(row.duguje, 2), BigInt(0))) / 100)}</td><td>{money(Number(selectedStatement.journal.stavke.reduce((sum, row) => sum + decimalToScaled(row.potrazuje, 2), BigInt(0))) / 100)}</td></tr></tfoot></table></div>
                  {canPost && selectedStatement.journal.status === "DRAFT" && await hasPermission(user, { firmaId: selectedStatement.firma_id, modul: "nalozi", akcija: "post" }) ? <form action={postManualBankJournalAction}>
                    <input type="hidden" name="statement_id" value={selectedStatement.id} />
                    <input type="hidden" name="statement_version" value={selectedStatement.updated_at.toISOString()} />
                    <input type="hidden" name="journal_id" value={selectedStatement.journal.id} />
                    <input type="hidden" name="journal_version" value={selectedStatement.journal.updated_at.toISOString()} />
                    <button type="submit" className="primary-button">Proknjiži nalog</button>
                  </form> : null}
                </div>
              ) : (
                <form action={updateBankStatementLines}>
                  <input name="statement_version" type="hidden" value={selectedStatement.updated_at.toISOString()} />
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
                          const lineBlockers = selectedLineBlockers.get(line.id) ?? [];

                          return (
                            <tr className={lineBlockers.length > 0 ? "statement-row-blocked" : undefined} key={line.id}>
                              <td className="statement-col-number">{line.line_number}</td>
                              <td className="statement-col-description">
                                <strong>{line.description}</strong>
                                <small>
                                  {line.direction === "INFLOW" ? "Priliv" : "Odliv"} ·{" "}
                                  {line.counterparty_account_number ?? "bez računa"}
                                </small>
                                {lineBlockers.length > 0 ? (
                                  <div className="control-issues">
                                    {lineBlockers.map((blocker) => (
                                      <small className="control-issue" key={blocker}>{blocker}</small>
                                    ))}
                                  </div>
                                ) : null}
                                <input name="line_id" type="hidden" value={line.id} />
                                <input name="line_direction" type="hidden" value={line.direction} />
                              </td>
                              <td className="statement-col-partner">
                                <BankStatementPartnerInput
                                  key={`${line.id}:${selectedStatement.updated_at.toISOString()}`}
                                  account={line.counterparty_account_number}
                                  disabled={!canEditSelected}
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
                                <AccountSearchSelect
                                  defaultValue={selectedAccountCode ?? ""}
                                  name={isInflow ? "credit_account_code" : "debit_account_code"}
                                >
                                  <option value="">-</option>
                                  {accountOptions.map((account) => (
                                    <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
                                      {account.sifra} - {account.naziv}
                                    </option>
                                  ))}
                                </AccountSearchSelect>
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
                    disabled={!canEditSelected}
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
