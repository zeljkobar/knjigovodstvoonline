import Link from "next/link";
import { createKifEntry, deleteKifEntry, postInvoiceBook, updateKifEntry } from "../../actions";
import { KifTaxLinesForm } from "@/components/KifTaxLinesForm";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { VatTransactionFields } from "@/components/VatTransactionFields";
import { VatTransactionTypeSelect } from "@/components/VatTransactionTypeSelect";
import {
  invoicePostingAccountSources,
  invoicePostingFields,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { prisma } from "@/lib/prisma";
import { vatTransactionLabels } from "@/lib/vat-transaction";
import { readWorkContext } from "@/lib/work-context";

type KifBookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    edit?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kif_knjiga_sacuvana: "KIF knjiga je otvorena.",
  kif_sacuvan: "Račun je dodat u KIF.",
  kif_izmijenjen: "Račun je izmijenjen.",
  kif_obrisan: "Račun je obrisan iz KIF-a.",
  kif_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kif_obavezno: "Kupac, broj računa, datum računa i ukupan iznos su obavezni.",
  kif_konto_obavezan: "Konto prihoda je obavezno jer šema koristi konto iz unosa računa.",
  kif_iznosi: "Provjerite osnovice i PDV iznose.",
  kif_ukupno: "Ukupno računa se ne slaže sa zbirom osnovica i PDV-a.",
  kif_konto: "Konto prihoda mora biti aktivno analitičko konto.",
  kif_knjiga: "KIF knjiga nije otvorena za unos.",
  kif_dupli_broj: "Račun sa istim kupcem, brojem i datumom već postoji u KIF-u.",
  kif_export_pdv: "Izvoz ne smije imati obračunat izlazni PDV.",
  prava: "Nemate pravo za ovu akciju nad izlaznim računima.",
  knjizenje_kreiran: "Nalog je kreiran.",
  knjizenje_dodato: "Novi računi su dodati na postojeći nalog.",
  knjizenje_vrsta_naloga: "Za ovu vrstu KIF knjige prvo izaberite vrstu naloga u podešavanjima.",
  knjizenje_sema: "Šema kontiranja nije kompletna za ovu vrstu knjige.",
  knjizenje_konto: "Neko konto iz šeme nije aktivno analitičko konto.",
  knjizenje_nalog_zakljucan: "Postojeći nalog je već proknjižen i ne može se dopuniti.",
  knjizenje_nema: "Nema neproknjiženih računa za ovu knjigu.",
  kif_greska: "Račun nije dodat u KIF. Provjerite podatke."
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

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

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

function decimalInput(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  if (!Number.isFinite(numeric) || numeric === 0) {
    return "";
  }

  return numeric.toFixed(2);
}

function postingStatusLabel(total: number, posted: number, unposted: number) {
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

function postingStatusClass(label: string) {
  if (label === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (label === "Djelimično knjižena") {
    return "status-pill status-pill--warning";
  }

  if (label === "Prazno") {
    return "status-pill status-pill--muted";
  }

  return "status-pill";
}

export default async function KifBookPage({ params, searchParams }: KifBookPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const query = await searchParams;
  const message = query?.poruka ? poruke[query.poruka] : null;
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <p className="admin-message">Izaberite firmu i godinu u gornjoj traci.</p>
      </div>
    );
  }

  const activeCompany = await prisma.firma.findFirst({
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
  });

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

  if (!activeCompany || !activeYear) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KIF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const [kifBook, vatRates, baseAccounts, companyOverrides] = await Promise.all([
    prisma.kifBook.findFirst({
      where: {
        id,
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false
      },
      select: {
        id: true,
        internal_kif_number: true,
        mjesec: true,
        kif_date: true,
        status: true,
        racun_vrsta: {
          select: {
            naziv: true,
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
        },
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "desc"
          },
          select: {
            id: true,
            internal_kif_number: true,
            customer_invoice_number: true,
            invoice_date: true,
            due_date: true,
            vat_transaction_type: true,
            is_export: true,
            export_declaration_number: true,
            export_declaration_date: true,
            total_base: true,
            total_output_vat: true,
            total_gross: true,
            status: true,
            posting_status: true,
            journal_id: true,
            note: true,
            revenue_account: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            kupac: {
              select: {
                id: true,
                naziv: true,
                pib: true,
                is_foreign: true
              }
            },
            tax_lines: {
              orderBy: {
                vat_rate_percent: "desc"
              },
              select: {
                id: true,
                vat_rate_id: true,
                vat_rate_percent: true,
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
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    }),
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
        firma_id: activeCompany.id
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
    })
  ]);

  if (!kifBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KIF knjiga nije pronađena.</p>
      </div>
    );
  }

  const isLocked = activeYear.zakljucena || kifBook.status !== "OPEN";
  const revenueAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides)
    .filter(
      (account) =>
        account.aktivan && account.tip_konta === "analiticko" && account.sifra.startsWith("6")
    )
    .sort((a, b) => a.sifra.localeCompare(b.sifra));
  const fields = invoicePostingFields(kifBook.racun_vrsta.dokument_tip, vatRates);
  const ruleByField = new Map(
    kifBook.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
  );
  const baseFields = fields.filter(
    (field) => field.code.startsWith("OSNOVICA_") || field.code.startsWith("OSLOBODJENO_")
  );
  const revenueAccountRequired = baseFields.some((field) => {
    const rule = ruleByField.get(field.code);

    return (rule?.konto_izvor ?? field.accountSource) === invoicePostingAccountSources.inputExpense;
  });
  const fixedRevenueAccounts = Array.from(
    new Set(
      baseFields
        .map((field) => ruleByField.get(field.code))
        .filter((rule) => rule?.konto_izvor === invoicePostingAccountSources.fixed)
        .map((rule) => rule?.sifra_konta)
        .filter((code): code is string => Boolean(code))
    )
  );
  const defaultRevenueAccount = revenueAccountRequired ? "" : fixedRevenueAccounts[0] ?? "";
  const editingEntry = query?.edit
    ? kifBook.entries.find((entry) => entry.id === query.edit)
    : null;
  const formAction = editingEntry ? updateKifEntry : createKifEntry;
  const editingBuyer = editingEntry
    ? {
        id: editingEntry.kupac.id,
        naziv: editingEntry.kupac.naziv,
        pib: editingEntry.kupac.pib,
        scope: "RECORDED",
        isForeign: editingEntry.kupac.is_foreign,
        label: `${editingEntry.kupac.naziv}${editingEntry.kupac.pib ? ` (${editingEntry.kupac.pib})` : ""}`
      }
    : null;
  const formRevenueAccount =
    editingEntry?.revenue_account?.sifra ?? defaultRevenueAccount;
  const formHint = editingEntry
    ? editingEntry.internal_kif_number
    : revenueAccountRequired
      ? "Konto prihoda je obavezno po šemi"
      : "Konto prihoda je preuzet iz šeme ako je podešen";
  const journalId = kifBook.entries.find((entry) => entry.journal_id)?.journal_id ?? null;
  const unpostedCount = kifBook.entries.filter(
    (entry) => entry.posting_status === "UNPOSTED" && !entry.journal_id
  ).length;
  const postedCount = kifBook.entries.filter((entry) => entry.posting_status === "POSTED").length;
  const postingLabel = postingStatusLabel(kifBook.entries.length, postedCount, unpostedCount);
  const totals = kifBook.entries.reduce(
    (sum, entry) => ({
      base: sum.base + Number(entry.total_base.toString()),
      vat: sum.vat + Number(entry.total_output_vat.toString()),
      gross: sum.gross + Number(entry.total_gross.toString())
    }),
    {
      base: 0,
      vat: 0,
      gross: 0
    }
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kifBook.internal_kif_number}</h2>
          <p>
            {mjeseci[kifBook.mjesec - 1] ?? kifBook.mjesec} {activeYear.godina} · datum KIF-a{" "}
            {displayDate(kifBook.kif_date)} · {kifBook.racun_vrsta.naziv}
          </p>
        </div>
        <Link className="secondary-button" href="/agencija/racuni/kif">
          Novi KIF
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Knjiženje KIF-a</h3>
            <span>
              {journalId
                ? `${unpostedCount} računa čeka dodavanje na postojeći nalog`
                : `${unpostedCount} računa čeka knjiženje`}
            </span>
          </div>
          <div className="button-row">
            <span className={postingStatusClass(postingLabel)}>{postingLabel}</span>
            {journalId ? (
              <Link className="secondary-button" href={`/agencija/nalozi/${journalId}`}>
                Vidi nalog
              </Link>
            ) : null}
            {unpostedCount > 0 ? (
              <form action={postInvoiceBook}>
                <input type="hidden" name="dokument_tip" value="KIF" />
                <input type="hidden" name="book_id" value={kifBook.id} />
                <input type="hidden" name="return_to" value={`/agencija/racuni/kif/${kifBook.id}`} />
                <button className="primary-button" type="submit">
                  {journalId ? "Dodaj na nalog" : "Proknjiži KIF"}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kifBook.entries.length}</strong>
          <small>{postingLabel}</small>
        </div>
        <div className="metric">
          <span>Osnovica</span>
          <strong>{decimalText(totals.base)}</strong>
          <small>zbir poreskih osnovica</small>
        </div>
        <div className="metric">
          <span>PDV / Ukupno</span>
          <strong>{decimalText(totals.vat)} / {decimalText(totals.gross)}</strong>
          <small>izlazni PDV i bruto iznos</small>
        </div>
      </section>

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>{editingEntry ? "Izmjena izlaznog računa" : "Unos izlaznog računa"}</h3>
          <span>{formHint}</span>
        </div>

        {vatRates.length === 0 ? (
          <p className="admin-message">
            Nema aktivnih PDV stopa. Prvo ih podesite u podešavanjima.
          </p>
        ) : null}

        <form
          key={editingEntry?.id ?? "new-kif-entry"}
          id="kif-entry-form"
          className="admin-form kuf-entry-form"
          action={formAction}
        >
          <input name="kif_book_id" type="hidden" value={kifBook.id} />
          {editingEntry ? <input name="kif_entry_id" type="hidden" value={editingEntry.id} /> : null}
          <PartnerSearchInput
            disabled={isLocked}
            initialPartner={editingBuyer}
            label="Kupac"
            name="kupac_id"
            required
          />
          <VatTransactionTypeSelect
            disabled={isLocked}
            documentType="KIF"
            initialValue={editingEntry?.vat_transaction_type}
          />
          <VatTransactionFields
            documentType="KIF"
            showFor="EXPORT"
            initialValue={editingEntry?.vat_transaction_type}
          >
            <label>
              <span>Broj izvozne deklaracije</span>
              <input
                name="export_declaration_number"
                defaultValue={editingEntry?.export_declaration_number ?? ""}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Datum izvozne deklaracije</span>
              <input
                name="export_declaration_date"
                type="date"
                defaultValue={
                  editingEntry?.export_declaration_date
                    ? inputDate(editingEntry.export_declaration_date)
                    : ""
                }
                disabled={isLocked}
              />
            </label>
          </VatTransactionFields>
          <label>
            <span>Broj izlaznog računa</span>
            <input
              name="customer_invoice_number"
              defaultValue={normalizeFiscalInvoiceNumber(editingEntry?.customer_invoice_number)}
              required
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Datum računa</span>
            <input
              name="invoice_date"
              type="date"
              defaultValue={editingEntry ? inputDate(editingEntry.invoice_date) : inputDate()}
              required
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Datum dospijeća</span>
            <input
              name="due_date"
              type="date"
              defaultValue={editingEntry?.due_date ? inputDate(editingEntry.due_date) : ""}
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Konto prihoda/osnovice</span>
            <select
              name="revenue_account_code"
              defaultValue={formRevenueAccount}
              required={revenueAccountRequired}
              disabled={isLocked}
            >
              <option value="">-</option>
              {revenueAccounts.map((account) => (
                <option key={`${account.source}-${account.id}`} value={account.sifra}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
          <label className="form-wide">
            <span>Napomena</span>
            <input
              name="note"
              defaultValue={editingEntry?.note ?? ""}
              placeholder="Opis ili interna napomena"
              disabled={isLocked}
            />
          </label>

          <KifTaxLinesForm
            disabled={isLocked}
            initialInvoiceTotal={editingEntry ? decimalInput(editingEntry.total_gross) : ""}
            initialLines={
              editingEntry
                ? editingEntry.tax_lines
                    .filter((line) => line.vat_rate_id)
                    .map((line) => ({
                      vatRateId: line.vat_rate_id!,
                      taxBase: decimalInput(line.tax_base)
                    }))
                : []
            }
            rates={vatRates.map((rate) => ({
              id: rate.id,
              naziv: rate.naziv,
              procenat: rate.procenat.toString()
            }))}
          />

          <div className="kuf-form-actions">
            <button type="submit" disabled={isLocked || vatRates.length === 0}>
              {editingEntry ? "Sačuvaj izmjenu" : "Unesi u KIF"}
            </button>
            {editingEntry ? (
              <Link className="secondary-button" href={`/agencija/racuni/kif/${kifBook.id}`}>
                Odustani
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Računi u KIF knjizi</h3>
          <span>{kifBook.entries.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>KIF broj</th>
                <th>Kupac</th>
                <th>Račun</th>
                <th>Tip prometa</th>
                <th>Konto prihoda</th>
                <th>Datum</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {kifBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={12}>Nema unesenih računa u ovoj KIF knjizi.</td>
                </tr>
              ) : (
                kifBook.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kif_number}</strong>
                    </td>
                    <td>
                      {entry.kupac.naziv}
                      <small>{entry.kupac.pib ?? "-"}</small>
                    </td>
                    <td>{normalizeFiscalInvoiceNumber(entry.customer_invoice_number)}</td>
                    <td>
                      {vatTransactionLabels[
                        entry.vat_transaction_type as keyof typeof vatTransactionLabels
                      ] ?? entry.vat_transaction_type}
                    </td>
                    <td>
                      {entry.revenue_account
                        ? `${entry.revenue_account.sifra} - ${entry.revenue_account.naziv}`
                        : "Iz šeme"}
                    </td>
                    <td>{displayDate(entry.invoice_date)}</td>
                    <td>{decimalText(entry.total_base)}</td>
                    <td>{decimalText(entry.total_output_vat)}</td>
                    <td>{decimalText(entry.total_gross)}</td>
                    <td>
                      {entry.tax_lines.map((line) => (
                        <small key={line.id}>
                          {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                          {decimalText(line.output_vat_amount)}
                        </small>
                      ))}
                    </td>
                    <td>
                      <span
                        className={
                          entry.posting_status === "POSTED"
                            ? "status-pill status-pill--success"
                            : "status-pill"
                        }
                      >
                        {entry.posting_status === "POSTED" ? "Knjiženo" : "Otvorena"}
                      </span>
                    </td>
                    <td>
                      {entry.posting_status === "UNPOSTED" && !isLocked ? (
                        <div className="table-actions">
                          <Link className="table-button" href={`/agencija/racuni/kif/${kifBook.id}?edit=${entry.id}#kif-entry-form`}>
                            Izmijeni
                          </Link>
                          <form action={deleteKifEntry}>
                            <input type="hidden" name="kif_book_id" value={kifBook.id} />
                            <input type="hidden" name="kif_entry_id" value={entry.id} />
                            <button className="table-button table-button-danger" type="submit">
                              Obriši
                            </button>
                          </form>
                        </div>
                      ) : (
                        "-"
                      )}
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
