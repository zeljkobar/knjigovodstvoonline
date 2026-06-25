import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

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

function decimalText(value: number) {
  return value.toLocaleString("de-DE", {
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
    return "Djelimično knjiženo";
  }

  return "Otvorena";
}

function bookPostingClass(label: string) {
  if (label === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (label === "Djelimično knjiženo") {
    return "status-pill status-pill--warning";
  }

  return "status-pill";
}

type PregledKifPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
  }>;
};

function parseDateFilter(value?: string) {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function printHref(params?: { datum_do?: string; datum_od?: string }) {
  const query = new URLSearchParams();

  if (params?.datum_od) {
    query.set("datum_od", params.datum_od);
  }

  if (params?.datum_do) {
    query.set("datum_do", params.datum_do);
  }

  return `/stampa/kif${query.toString() ? `?${query.toString()}` : ""}`;
}

export default async function PregledKifPage({ searchParams }: PregledKifPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

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
          id: true
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
            godina: true
          }
        })
      : null;

  const kifBooks =
    activeCompany && activeYear
      ? await prisma.kifBook.findMany({
          where: {
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            poslovna_godina_id: activeYear.id,
            is_deleted: false,
            ...(dateFrom || dateTo
              ? {
                  kif_date: {
                    ...(dateFrom ? { gte: dateFrom } : {}),
                    ...(dateTo ? { lte: dateTo } : {})
                  }
                }
              : {})
          },
          orderBy: {
            redni_broj: "desc"
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
              select: {
                id: true,
                total_base: true,
                total_output_vat: true,
                total_gross: true,
                posting_status: true
              }
            }
          }
        })
      : [];

  const totals = kifBooks.reduce(
    (sum, book) => {
      for (const entry of book.entries) {
        sum.base += Number(entry.total_base.toString());
        sum.vat += Number(entry.total_output_vat.toString());
        sum.gross += Number(entry.total_gross.toString());
        sum.entries += 1;
      }

      return sum;
    },
    {
      base: 0,
      vat: 0,
      gross: 0,
      entries: 0
    }
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Pregled KIF</h2>
          <p>Pregled otvorenih i unesenih knjiga izlaznih faktura.</p>
        </div>
        {activeCompany && activeYear ? (
          <Link className="secondary-button" href={printHref(params)} target="_blank">
            Štampa
          </Link>
        ) : null}
      </header>

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i godinu</h3>
          <p className="empty-state">
            KIF se vodi za aktivnu firmu i poslovnu godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>KIF knjiga</span>
              <strong>{kifBooks.length}</strong>
              <small>{totals.entries} računa ukupno</small>
            </div>
            <div className="metric">
              <span>Ukupno KIF</span>
              <strong>{decimalText(totals.gross)}</strong>
              <small>
                Osnovica {decimalText(totals.base)} · PDV {decimalText(totals.vat)}
              </small>
            </div>
            <div className="metric">
              <span>Godina</span>
              <strong>{activeYear.godina}</strong>
              <small>Aktivni kontekst</small>
            </div>
          </section>

          <section className="admin-panel">
            <form className="admin-form inline-filter-form" method="get">
              <label>
                Datum KIF-a od
                <input name="datum_od" type="date" defaultValue={params?.datum_od ?? ""} />
              </label>
              <label>
                Datum KIF-a do
                <input name="datum_do" type="date" defaultValue={params?.datum_do ?? ""} />
              </label>
              <button type="submit">Prikaži</button>
              <Link className="secondary-button" href="/agencija/racuni/pregled-kif">
                Svi periodi
              </Link>
            </form>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Spisak KIF knjiga</h3>
              <span>{kifBooks.length} ukupno</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Broj</th>
                    <th>Vrsta</th>
                    <th>Mjesec</th>
                    <th>Datum KIF-a</th>
                    <th>Računa</th>
                    <th>Osnovica</th>
                    <th>PDV</th>
                    <th>Ukupno</th>
                    <th>Status</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {kifBooks.length === 0 ? (
                    <tr>
                      <td colSpan={10}>Nema KIF knjiga za izabranu firmu i godinu.</td>
                    </tr>
                  ) : (
                    kifBooks.map((book) => {
                      const bookTotals = book.entries.reduce(
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
                      const statusLabel = bookPostingLabel(book.entries);

                      return (
                        <tr key={book.id}>
                          <td>
                            <strong>{book.internal_kif_number}</strong>
                          </td>
                          <td>{book.racun_vrsta.naziv}</td>
                          <td>{mjeseci[book.mjesec - 1] ?? book.mjesec}</td>
                          <td>{displayDate(book.kif_date)}</td>
                          <td>{book.entries.length}</td>
                          <td>{decimalText(bookTotals.base)}</td>
                          <td>{decimalText(bookTotals.vat)}</td>
                          <td>{decimalText(bookTotals.gross)}</td>
                          <td>
                            <span className={bookPostingClass(statusLabel)}>{statusLabel}</span>
                          </td>
                          <td>
                            <Link className="table-action" href={`/agencija/racuni/pregled-kif/${book.id}`}>
                              Otvori
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
