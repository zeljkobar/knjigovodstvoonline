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

export default async function PregledKufPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

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

  const kufBooks =
    activeCompany && activeYear
      ? await prisma.kufBook.findMany({
          where: {
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            poslovna_godina_id: activeYear.id,
            is_deleted: false
          },
          orderBy: {
            redni_broj: "desc"
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
              select: {
                id: true,
                total_base: true,
                total_input_vat: true,
                total_gross: true
              }
            }
          }
        })
      : [];

  const totals = kufBooks.reduce(
    (sum, book) => {
      for (const entry of book.entries) {
        sum.base += Number(entry.total_base.toString());
        sum.vat += Number(entry.total_input_vat.toString());
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
          <h2>Pregled KUF</h2>
          <p>Pregled otvorenih i unesenih knjiga ulaznih faktura.</p>
        </div>
      </header>

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i godinu</h3>
          <p className="empty-state">
            KUF se vodi za aktivnu firmu i poslovnu godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>KUF knjiga</span>
              <strong>{kufBooks.length}</strong>
              <small>{totals.entries} računa ukupno</small>
            </div>
            <div className="metric">
              <span>Ukupno KUF</span>
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
            <div className="panel-header">
              <h3>Spisak KUF knjiga</h3>
              <span>{kufBooks.length} ukupno</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Broj</th>
                    <th>Vrsta</th>
                    <th>Mjesec</th>
                    <th>Datum KUF-a</th>
                    <th>Računa</th>
                    <th>Osnovica</th>
                    <th>PDV</th>
                    <th>Ukupno</th>
                    <th>Status</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {kufBooks.length === 0 ? (
                    <tr>
                      <td colSpan={10}>Nema KUF knjiga za izabranu firmu i godinu.</td>
                    </tr>
                  ) : (
                    kufBooks.map((book) => {
                      const bookTotals = book.entries.reduce(
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

                      return (
                        <tr key={book.id}>
                          <td>
                            <strong>{book.internal_kuf_number}</strong>
                          </td>
                          <td>{book.racun_vrsta.naziv}</td>
                          <td>{mjeseci[book.mjesec - 1] ?? book.mjesec}</td>
                          <td>{displayDate(book.kuf_date)}</td>
                          <td>{book.entries.length}</td>
                          <td>{decimalText(bookTotals.base)}</td>
                          <td>{decimalText(bookTotals.vat)}</td>
                          <td>{decimalText(bookTotals.gross)}</td>
                          <td>{book.status}</td>
                          <td>
                            <Link className="table-action" href={`/agencija/racuni/pregled-kuf/${book.id}`}>
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
