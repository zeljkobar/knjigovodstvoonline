import type { Prisma } from "@prisma/client";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { kifEntryKinds } from "@/lib/kif-pazar";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KifPrintPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
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

function parseDateFilter(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function dateText(value: Date | null | undefined) {
  return value ? value.toLocaleDateString("sr-Latn-ME") : "-";
}

function documentText(entry: {
  entry_kind: string;
  customer_invoice_number: string;
  pazar_report_number: string | null;
}) {
  if (entry.entry_kind === kifEntryKinds.pazar) {
    return `Pazar${entry.pazar_report_number ? ` · ${entry.pazar_report_number}` : ""}`;
  }

  return normalizeFiscalInvoiceNumber(entry.customer_invoice_number);
}

function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function taxAmount(
  taxLines: Array<{ output_vat_amount: Prisma.Decimal; vat_rate_percent: Prisma.Decimal }>,
  rate: number
) {
  return taxLines
    .filter((line) => Number(line.vat_rate_percent.toString()) === rate)
    .reduce((sum, line) => sum + Number(line.output_vat_amount.toString()), 0);
}

function taxBase(
  taxLines: Array<{ tax_base: Prisma.Decimal; vat_rate_percent: Prisma.Decimal }>,
  rate: number
) {
  return taxLines
    .filter((line) => Number(line.vat_rate_percent.toString()) === rate)
    .reduce((sum, line) => sum + Number(line.tax_base.toString()), 0);
}

export default async function KifPrintPage({ searchParams }: KifPrintPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <main className="print-page ledger-print-page">
        <section className="ledger-print-document">
          <h1>Knjiga izdatih računa</h1>
          <p>Izaberite firmu i poslovnu godinu prije štampe.</p>
        </section>
      </main>
    );
  }

  const [firma, godina, books] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
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
        naziv: true,
        adresa: true,
        grad: true,
        pib: true,
        maticni_broj: true,
        pdv_broj: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.kifBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
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
      orderBy: [{ kif_date: "asc" }, { redni_broj: "asc" }],
      select: {
        id: true,
        mjesec: true,
        kif_date: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            id: true,
            entry_kind: true,
            customer_invoice_number: true,
            invoice_date: true,
            pazar_report_number: true,
            total_base: true,
            total_output_vat: true,
            total_gross: true,
            kupac: {
              select: {
                naziv: true,
                pdv_broj: true,
                pib: true
              }
            },
            tax_lines: {
              select: {
                tax_base: true,
                output_vat_amount: true,
                vat_rate_percent: true
              }
            }
          }
        }
      }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const rows = books.flatMap((book) =>
    book.entries.map((entry) => ({
      ...entry,
      bookMonth: book.mjesec,
      bookDate: book.kif_date
    }))
  );
  const periodFrom = dateFrom ?? books[0]?.kif_date ?? null;
  const periodTo = dateTo ?? books.at(-1)?.kif_date ?? null;
  const totals = rows.reduce(
    (sum, row) => {
      sum.exempt += taxBase(row.tax_lines, 0);
      sum.base += Number(row.total_base.toString());
      sum.vat0 += taxAmount(row.tax_lines, 0);
      sum.vat7 += taxAmount(row.tax_lines, 7);
      sum.vat15 += taxAmount(row.tax_lines, 15);
      sum.vat21 += taxAmount(row.tax_lines, 21);
      sum.gross += Number(row.total_gross.toString());
      return sum;
    },
    {
      exempt: 0,
      base: 0,
      vat0: 0,
      vat7: 0,
      vat15: 0,
      vat21: 0,
      gross: 0
    }
  );
  let currentMonth = 0;

  return (
    <main className="print-page ledger-print-page">
      <style>{`@page { size: A4 landscape; margin: 10mm; }`}</style>
      <div className="print-toolbar">
        <PrintButton label="Štampaj" />
      </div>
      <section className="ledger-print-document">
        <header className="ledger-print-header">
          <div className="ledger-taxpayer">
            <p>
              <strong>PORESKI OBVEZNIK:</strong> {firma.naziv}
            </p>
            <p>Naziv/ime i prezime: {firma.naziv}</p>
            <p>Adresa/opština, ulica i broj: {firma.adresa ?? firma.grad ?? "-"}</p>
            <p>PIB - MB/JMBG: {firma.pib ?? firma.maticni_broj ?? "-"}</p>
            <p>PDV broj: {firma.pdv_broj ?? "-"}</p>
          </div>
          <strong className="ledger-form-code">OBRAZAC I-RAČ</strong>
        </header>

        <div className="ledger-title">
          <h1>KNJIGA IZDATIH RAČUNA</h1>
          <p>
            Period: <strong>{dateText(periodFrom)}</strong> - <strong>{dateText(periodTo)}</strong>
          </p>
        </div>

        <table className="ledger-print-table ledger-print-table--kif">
          <colgroup>
            <col style={{ width: "3%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "9%" }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Red. broj</th>
              <th rowSpan={2}>Datum knjiženja računa</th>
              <th colSpan={2}>RAČUN</th>
              <th colSpan={2}>Kupac (primalac) proizvoda ili usluga</th>
              <th rowSpan={2}>Vrijednost oslobođenog prometa</th>
              <th colSpan={3}>Vrijednost oporezivog prometa bez PDV-a</th>
              <th colSpan={4}>IZNOS OBRAČUNATOG PDV PO STOPAMA</th>
              <th rowSpan={2}>Ukupna vrijednost oporezivog prometa sa PDV (8-14)</th>
            </tr>
            <tr>
              <th>Broj</th>
              <th>Datum ispostavljanja</th>
              <th>Naziv, ime i prezime, sjedište</th>
              <th>PDV broj</th>
              <th>Izvoz</th>
              <th>Obveznici PDV-a</th>
              <th>Krajnja potrošnja</th>
              <th>0%</th>
              <th>7%</th>
              <th>15%</th>
              <th>21%</th>
            </tr>
            <tr>
              {Array.from({ length: 15 }, (_, index) => (
                <th key={index}>{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={15}>Nema podataka za izabrani period.</td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const monthChanged = row.bookMonth !== currentMonth;
                currentMonth = row.bookMonth;
                const exempt = taxBase(row.tax_lines, 0);
                const base = Number(row.total_base.toString());

                return [
                  monthChanged ? (
                    <tr className="ledger-month-row" key={`month-${row.bookMonth}-${row.id}`}>
                      <td colSpan={15}>
                        Mjesec: <strong>{mjeseci[row.bookMonth - 1] ?? row.bookMonth}</strong>
                      </td>
                    </tr>
                  ) : null,
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>{dateText(row.bookDate)}</td>
                    <td>{documentText(row)}</td>
                    <td>{dateText(row.invoice_date)}</td>
                    <td>{row.kupac.naziv}</td>
                    <td>{row.kupac.pdv_broj ?? row.kupac.pib ?? ""}</td>
                    <td>{money(exempt)}</td>
                    <td>{money(0)}</td>
                    <td>{money(base - exempt)}</td>
                    <td>{money(0)}</td>
                    <td>{money(taxAmount(row.tax_lines, 0))}</td>
                    <td>{money(taxAmount(row.tax_lines, 7))}</td>
                    <td>{money(taxAmount(row.tax_lines, 15))}</td>
                    <td>{money(taxAmount(row.tax_lines, 21))}</td>
                    <td>{money(Number(row.total_gross.toString()))}</td>
                  </tr>
                ];
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>UKUPNO</td>
              <td>{money(totals.exempt)}</td>
              <td>{money(0)}</td>
              <td>{money(totals.base - totals.exempt)}</td>
              <td>{money(0)}</td>
              <td>{money(totals.vat0)}</td>
              <td>{money(totals.vat7)}</td>
              <td>{money(totals.vat15)}</td>
              <td>{money(totals.vat21)}</td>
              <td>{money(totals.gross)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </main>
  );
}
