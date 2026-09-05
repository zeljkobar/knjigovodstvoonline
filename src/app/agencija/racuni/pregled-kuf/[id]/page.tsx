import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PregledKufDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
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

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function bookPostingLabel(entries: Array<{ posting_status: string }>) {
  if (entries.length === 0) {
    return "Otvorena";
  }

  const posted = entries.filter((entry) => entry.posting_status === "POSTED").length;

  if (posted === entries.length) {
    return "Knjiženo";
  }

  if (posted > 0) {
    return "Djelimično knjižena";
  }

  return "Otvorena";
}

function statusClass(label: string) {
  if (label === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (label === "Djelimično knjižena") {
    return "status-pill status-pill--warning";
  }

  return "status-pill";
}

function entryPostingLabel(status: string) {
  return status === "POSTED" ? "Knjiženo" : "Otvorena";
}

export default async function PregledKufDetailPage({ params }: PregledKufDetailPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const workContext = await readWorkContext();

  if (workContext.firmaId) {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "ulazni_racuni",
      akcija: "view"
    });
  }

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
      id: true
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
            godina: true
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

  const kufBook = await prisma.kufBook.findFirst({
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
          invoice_date: true,
          receipt_date: true,
          total_base: true,
          total_input_vat: true,
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
              vat_rate_percent: true,
              tax_base: true,
              input_vat_amount: true
            }
          }
        }
      }
    }
  });

  if (!kufBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KUF knjiga nije pronađena.</p>
        <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
          Nazad na pregled
        </Link>
      </div>
    );
  }

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
  const bookStatusLabel = bookPostingLabel(kufBook.entries);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kufBook.internal_kuf_number}</h2>
          <p>
            Pregled KUF knjige · {mjeseci[kufBook.mjesec - 1] ?? kufBook.mjesec}{" "}
            {activeYear.godina} · {kufBook.racun_vrsta.naziv} · datum KUF-a{" "}
            {displayDate(kufBook.kuf_date)}
          </p>
        </div>
        <div className="table-actions">
          <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
            Nazad
          </Link>
          <Link className="secondary-button" href={`/agencija/racuni/kuf/${kufBook.id}`}>
            Dodaj račun/e
          </Link>
        </div>
      </header>

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kufBook.entries.length}</strong>
          <small>{bookStatusLabel}</small>
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
              </tr>
            </thead>
            <tbody>
              {kufBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={10}>Nema unesenih računa u ovoj KUF knjizi.</td>
                </tr>
              ) : (
                kufBook.entries.map((entry) => {
                  const entryStatus = entryPostingLabel(entry.posting_status);

                  return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kuf_number}</strong>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </td>
                    <td>
                      {entry.dobavljac.naziv}
                      <small>{entry.dobavljac.pib ?? ""}</small>
                    </td>
                    <td>{normalizeFiscalInvoiceNumber(entry.supplier_invoice_number)}</td>
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
                      <span className={statusClass(entryStatus)}>{entryStatus}</span>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
