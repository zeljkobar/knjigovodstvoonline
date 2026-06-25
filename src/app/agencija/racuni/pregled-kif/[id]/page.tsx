import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PregledKifDetailPageProps = {
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

export default async function PregledKifDetailPage({ params }: PregledKifDetailPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
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
        <p className="admin-message">KIF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const kifBook = await prisma.kifBook.findFirst({
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
      racun_vrsta: {
        select: {
          naziv: true
        }
      },
      mjesec: true,
      kif_date: true,
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
          internal_kif_number: true,
          customer_invoice_number: true,
          invoice_date: true,
          total_base: true,
          total_output_vat: true,
          total_gross: true,
          status: true,
          posting_status: true,
          note: true,
          revenue_account: {
            select: {
              sifra: true,
              naziv: true
            }
          },
          kupac: {
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
              output_vat_amount: true
            }
          }
        }
      }
    }
  });

  if (!kifBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KIF knjiga nije pronađena.</p>
        <Link className="secondary-button" href="/agencija/racuni/pregled-kif">
          Nazad na pregled
        </Link>
      </div>
    );
  }

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
  const bookStatusLabel = bookPostingLabel(kifBook.entries);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kifBook.internal_kif_number}</h2>
          <p>
            Pregled KIF knjige · {mjeseci[kifBook.mjesec - 1] ?? kifBook.mjesec}{" "}
            {activeYear.godina} · {kifBook.racun_vrsta.naziv} · datum KIF-a{" "}
            {displayDate(kifBook.kif_date)}
          </p>
        </div>
        <div className="table-actions">
          <Link className="secondary-button" href="/agencija/racuni/pregled-kif">
            Nazad
          </Link>
          <Link className="secondary-button" href={`/agencija/racuni/kif/${kifBook.id}`}>
            Dodaj račun/e
          </Link>
        </div>
      </header>

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kifBook.entries.length}</strong>
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
          <small>izlazni PDV i bruto iznos</small>
        </div>
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
                <th>Konto prihoda</th>
                <th>Datum</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {kifBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={10}>Nema unesenih računa u ovoj KIF knjizi.</td>
                </tr>
              ) : (
                kifBook.entries.map((entry) => {
                  const entryStatus = entryPostingLabel(entry.posting_status);

                  return (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kif_number}</strong>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </td>
                    <td>
                      {entry.kupac.naziv}
                      <small>{entry.kupac.pib ?? ""}</small>
                    </td>
                    <td>{normalizeFiscalInvoiceNumber(entry.customer_invoice_number)}</td>
                    <td>
                      {entry.revenue_account
                        ? `${entry.revenue_account.sifra} - ${entry.revenue_account.naziv}`
                        : "-"}
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
