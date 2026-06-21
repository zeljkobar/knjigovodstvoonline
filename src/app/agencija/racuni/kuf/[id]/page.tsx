import Link from "next/link";
import { createKufEntry, updateKufEntry } from "../../actions";
import { KufTaxLinesForm } from "@/components/KufTaxLinesForm";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KufBookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    edit?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kuf_knjiga_sacuvana: "KUF knjiga je otvorena.",
  kuf_sacuvan: "Račun je dodat u KUF.",
  kuf_izmijenjen: "Račun je izmijenjen.",
  kuf_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kuf_obavezno: "Dobavljač, konto troška, ukupan iznos, broj računa, datum računa i datum prijema su obavezni.",
  kuf_iznosi: "Provjerite osnovice i PDV iznose.",
  kuf_ukupno: "Ukupno računa se ne slaže sa zbirom osnovica i PDV-a.",
  kuf_konto: "Konto troška mora biti aktivno analitičko konto klase 5.",
  kuf_knjiga: "KUF knjiga nije otvorena za unos.",
  kuf_greska: "Račun nije sačuvan. Provjerite podatke."
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

function decimalText(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  return numeric.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function decimalInput(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  if (!Number.isFinite(numeric) || numeric === 0) {
    return "";
  }

  return numeric.toFixed(2);
}

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

export default async function KufBookPage({ params, searchParams }: KufBookPageProps) {
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
        <p className="admin-message">KUF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const [kufBook, partners, vatRates, baseAccounts, companyOverrides] = await Promise.all([
    prisma.kufBook.findFirst({
      where: {
        id,
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false
      },
      select: {
        id: true,
        internal_kuf_number: true,
        racun_vrsta: {
          select: {
            naziv: true
          }
        },
        mjesec: true,
        kuf_date: true,
        status: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "desc"
          },
          select: {
            id: true,
            internal_kuf_number: true,
            supplier_invoice_number: true,
            dobavljac_id: true,
            invoice_date: true,
            receipt_date: true,
            due_date: true,
            total_base: true,
            total_input_vat: true,
            deductible_vat: true,
            non_deductible_vat: true,
            total_gross: true,
            status: true,
            posting_status: true,
            note: true,
            expense_account: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            dobavljac: {
              select: {
                naziv: true,
                pib: true
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
                input_vat_amount: true,
                non_deductible_vat_amount: true
              }
            }
          }
        }
      }
    }),
    prisma.komitent.findMany({
      where: {
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
            firma_id: activeCompany.id
          }
        ]
      },
      orderBy: {
        naziv: "asc"
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
        aktivna: true
      },
      orderBy: [
        {
          redosljed: "asc"
        },
        {
          procenat: "desc"
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
        aktivan: true,
        tip_konta: "analiticko",
        klasa: "5"
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
        firma_id: activeCompany.id,
        sifra: {
          startsWith: "5"
        }
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
    })
  ]);

  if (!kufBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KUF knjiga nije pronađena.</p>
        <Link className="secondary-button" href="/agencija/racuni/kuf">
          Nazad na KUF
        </Link>
      </div>
    );
  }

  const expenseAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) =>
      account.aktivan &&
      account.tip_konta === "analiticko" &&
      account.sifra.startsWith("5")
  );

  const totals = kufBook.entries.reduce(
    (sum, entry) => ({
      base: sum.base + Number(entry.total_base.toString()),
      vat: sum.vat + Number(entry.total_input_vat.toString()),
      gross: sum.gross + Number(entry.total_gross.toString())
    }),
    {
      base: 0,
      vat: 0,
      gross: 0
    }
  );
  const isLocked = activeYear.zakljucena || kufBook.status !== "OPEN";
  const editingEntry = query?.edit
    ? kufBook.entries.find((entry) => entry.id === query.edit)
    : null;
  const formAction = editingEntry ? updateKufEntry : createKufEntry;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kufBook.internal_kuf_number}</h2>
          <p>
            {mjeseci[kufBook.mjesec - 1] ?? kufBook.mjesec} {activeYear.godina} · datum KUF-a{" "}
            {displayDate(kufBook.kuf_date)} · {kufBook.racun_vrsta.naziv}
          </p>
        </div>
        <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
          Pregled KUF
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kufBook.entries.length}</strong>
          <small>{kufBook.status}</small>
        </div>
        <div className="metric">
          <span>Osnovica</span>
          <strong>{decimalText(totals.base)}</strong>
          <small>zbir poreskih osnovica</small>
        </div>
        <div className="metric">
          <span>PDV / Ukupno</span>
          <strong>{decimalText(totals.vat)} / {decimalText(totals.gross)}</strong>
          <small>ulazni PDV i bruto iznos</small>
        </div>
      </section>

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>{editingEntry ? "Izmjena ulaznog računa" : "Unos ulaznog računa"}</h3>
          <span>
            {editingEntry ? editingEntry.internal_kuf_number : activeCompany.pdv_obveznik ? "Firma je PDV obveznik" : "Firma nije PDV obveznik"}
          </span>
        </div>

        {isLocked ? (
          <p className="admin-message">KUF knjiga ili poslovna godina su zaključani za unos.</p>
        ) : null}

        {vatRates.length === 0 ? (
          <p className="admin-message">
            Nema aktivnih PDV stopa. Prvo ih podesite u podešavanjima.
          </p>
        ) : null}

        <form id="kuf-entry-form" className="admin-form kuf-entry-form" action={formAction}>
          <input name="kuf_book_id" type="hidden" value={kufBook.id} />
          {editingEntry ? <input name="kuf_entry_id" type="hidden" value={editingEntry.id} /> : null}
          <label>
            <span>Dobavljač</span>
            <select
              name="dobavljac_id"
              required
              disabled={isLocked}
              autoFocus
              defaultValue={editingEntry?.dobavljac_id ?? ""}
            >
              <option value="">Izaberite dobavljača</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.naziv}
                  {partner.pib ? ` (${partner.pib})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Broj računa dobavljača</span>
            <input
              name="supplier_invoice_number"
              defaultValue={editingEntry?.supplier_invoice_number ?? ""}
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
            <span>Datum prijema</span>
            <input
              name="receipt_date"
              type="date"
              defaultValue={editingEntry ? inputDate(editingEntry.receipt_date) : inputDate()}
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
            <span>Konto troška</span>
            <select
              name="expense_account_code"
              defaultValue={editingEntry?.expense_account?.sifra ?? ""}
              required
              disabled={isLocked}
            >
              <option value="">Izaberite konto</option>
              {expenseAccounts.map((account) => (
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

          <KufTaxLinesForm
            disabled={isLocked}
            initialInvoiceTotal={editingEntry ? decimalInput(editingEntry.total_gross) : ""}
            initialLines={
              editingEntry
                ? editingEntry.tax_lines
                    .filter((line) => line.vat_rate_id)
                    .map((line) => ({
                      vatRateId: line.vat_rate_id!,
                      taxBase: decimalInput(line.tax_base),
                      nonDeductibleVat: decimalInput(line.non_deductible_vat_amount)
                    }))
                : []
            }
            rates={vatRates.map((rate) => ({
              id: rate.id,
              naziv: rate.naziv,
              procenat: rate.procenat.toString()
            }))}
          />

          <button type="submit" disabled={isLocked || vatRates.length === 0}>
            {editingEntry ? "Sačuvaj izmjenu" : "Unesi u KUF"}
          </button>
          {editingEntry ? (
            <Link className="secondary-button" href={`/agencija/racuni/kuf/${kufBook.id}`}>
              Odustani
            </Link>
          ) : null}
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Računi u KUF knjizi</h3>
          <span>{kufBook.entries.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>KUF broj</th>
                <th>Dobavljač</th>
                <th>Račun</th>
                <th>Konto troška</th>
                <th>Datumi</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {kufBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={11}>Nema unesenih računa u ovoj KUF knjizi.</td>
                </tr>
              ) : (
                kufBook.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kuf_number}</strong>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </td>
                    <td>
                      {entry.dobavljac.naziv}
                      <small>{entry.dobavljac.pib ?? ""}</small>
                    </td>
                    <td>{entry.supplier_invoice_number}</td>
                    <td>
                      {entry.expense_account
                        ? `${entry.expense_account.sifra} - ${entry.expense_account.naziv}`
                        : "-"}
                    </td>
                    <td>
                      {displayDate(entry.invoice_date)}
                      <small>prijem {displayDate(entry.receipt_date)}</small>
                    </td>
                    <td>{decimalText(entry.total_base)}</td>
                    <td>
                      {decimalText(entry.total_input_vat)}
                      {Number(entry.non_deductible_vat.toString()) > 0 ? (
                        <small>neodbitni {decimalText(entry.non_deductible_vat)}</small>
                      ) : null}
                    </td>
                    <td>{decimalText(entry.total_gross)}</td>
                    <td>
                      {entry.tax_lines.map((line) => (
                        <small key={line.id}>
                          {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                          {decimalText(line.input_vat_amount)}
                        </small>
                      ))}
                    </td>
                    <td>
                      {entry.status}
                      <small>{entry.posting_status}</small>
                    </td>
                    <td>
                      {entry.posting_status === "UNPOSTED" && !isLocked ? (
                        <Link className="table-action" href={`/agencija/racuni/kuf/${kufBook.id}?edit=${entry.id}#kuf-entry-form`}>
                          Izmijeni
                        </Link>
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
