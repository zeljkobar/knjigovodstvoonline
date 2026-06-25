import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatusLabel } from "@/lib/journals";
import { prisma } from "@/lib/prisma";

type NalogPrintPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString("sr-Latn-ME") : "-";
}

function money(value: number) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default async function NalogPrintPage({ params }: NalogPrintPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;

  if (!user.agencija_id || !isUuid(id)) {
    notFound();
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      sifra: true,
      broj: true,
      datum: true,
      datum_knjizenja: true,
      opis: true,
      status: true,
      created_at: true,
      proknjizen_at: true,
      firma: {
        select: {
          naziv: true,
          pib: true
        }
      },
      poslovna_godina: {
        select: {
          godina: true
        }
      },
      vrsta_naloga: {
        select: {
          naziv: true,
          prefiks: true
        }
      },
      kreirao_korisnik: {
        select: {
          korisnicko_ime: true
        }
      },
      stavke: {
        orderBy: {
          redni_broj: "asc"
        },
        select: {
          id: true,
          redni_broj: true,
          duguje: true,
          potrazuje: true,
          opis: true,
          broj_dokumenta: true,
          datum_dokumenta: true,
          datum_valute: true,
          firma_konto: {
            select: {
              sifra: true,
              naziv: true
            }
          },
          komitent: {
            select: {
              naziv: true,
              pib: true
            }
          }
        }
      }
    }
  });

  if (!nalog) {
    notFound();
  }

  const code =
    nalog.sifra ||
    formatJournalCode(nalog.vrsta_naloga.prefiks, nalog.poslovna_godina.godina, nalog.broj);
  const totalDebit = nalog.stavke.reduce((sum, stavka) => sum + Number(stavka.duguje), 0);
  const totalCredit = nalog.stavke.reduce((sum, stavka) => sum + Number(stavka.potrazuje), 0);
  const difference = totalDebit - totalCredit;
  const balanced = Math.round(totalDebit * 100) === Math.round(totalCredit * 100);

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <PrintButton label="Štampaj" />
      </div>
      <section className="journal-print-document">
        <header className="journal-print-header">
          <div>
            <p>Nalog za knjiženje</p>
            <h1>{code}</h1>
            <span>
              {nalog.firma.naziv}
              {nalog.firma.pib ? ` · PIB ${nalog.firma.pib}` : ""} · {nalog.poslovna_godina.godina}
            </span>
          </div>
          <div className="journal-print-status">
            <strong>{journalStatusLabel(nalog.status)}</strong>
            <span>{balanced ? "Izbalansiran" : "Nije izbalansiran"}</span>
          </div>
        </header>

        <section className="journal-print-meta">
          <div>
            <span>Vrsta naloga</span>
            <strong>{nalog.vrsta_naloga.naziv}</strong>
          </div>
          <div>
            <span>Datum naloga</span>
            <strong>{formatDate(nalog.datum)}</strong>
          </div>
          <div>
            <span>Datum knjiženja</span>
            <strong>{formatDate(nalog.datum_knjizenja)}</strong>
          </div>
          <div>
            <span>Kreirao</span>
            <strong>{nalog.kreirao_korisnik?.korisnicko_ime ?? "-"}</strong>
          </div>
          <div>
            <span>Datum kreiranja</span>
            <strong>{formatDate(nalog.created_at)}</strong>
          </div>
          <div>
            <span>Proknjižen</span>
            <strong>{formatDate(nalog.proknjizen_at)}</strong>
          </div>
        </section>

        <section className="journal-print-description">
          <span>Opis naloga</span>
          <strong>{nalog.opis ?? "-"}</strong>
        </section>

        <table className="journal-print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Datum</th>
              <th>Konto</th>
              <th>Partner</th>
              <th>Dokument</th>
              <th>Opis</th>
              <th>Duguje</th>
              <th>Potražuje</th>
            </tr>
          </thead>
          <tbody>
            {nalog.stavke.map((stavka) => (
              <tr key={stavka.id}>
                <td>{stavka.redni_broj}</td>
                <td>{formatDate(stavka.datum_dokumenta)}</td>
                <td>
                  <strong>{stavka.firma_konto.sifra}</strong>
                  <span>{stavka.firma_konto.naziv}</span>
                </td>
                <td>
                  <strong>{stavka.komitent?.naziv ?? "-"}</strong>
                  <span>{stavka.komitent?.pib ?? ""}</span>
                </td>
                <td>
                  <strong>{stavka.broj_dokumenta ?? "-"}</strong>
                  <span>Valuta: {formatDate(stavka.datum_valute)}</span>
                </td>
                <td>{stavka.opis ?? "-"}</td>
                <td>{money(Number(stavka.duguje))}</td>
                <td>{money(Number(stavka.potrazuje))}</td>
              </tr>
            ))}
            {nalog.stavke.length === 0 ? (
              <tr>
                <td colSpan={8}>Nalog nema stavki.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Ukupno</td>
              <td>{money(totalDebit)}</td>
              <td>{money(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="journal-print-summary">
          <div>
            <span>Duguje</span>
            <strong>{money(totalDebit)}</strong>
          </div>
          <div>
            <span>Potražuje</span>
            <strong>{money(totalCredit)}</strong>
          </div>
          <div className={balanced ? "journal-print-balanced" : "journal-print-unbalanced"}>
            <span>Razlika</span>
            <strong>{money(Math.abs(difference))}</strong>
          </div>
        </section>
      </section>
    </main>
  );
}
