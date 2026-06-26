import type { Prisma } from "@prisma/client";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KufPrintPageProps = {
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

function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function taxAmount(
  taxLines: Array<{ input_vat_amount: Prisma.Decimal; vat_rate_percent: Prisma.Decimal }>,
  rate: number
) {
  return taxLines
    .filter((line) => Number(line.vat_rate_percent.toString()) === rate)
    .reduce((sum, line) => sum + Number(line.input_vat_amount.toString()), 0);
}

function exemptBase(
  taxLines: Array<{ tax_base: Prisma.Decimal; vat_rate_percent: Prisma.Decimal }>
) {
  return taxLines
    .filter((line) => Number(line.vat_rate_percent.toString()) === 0)
    .reduce((sum, line) => sum + Number(line.tax_base.toString()), 0);
}

export default async function KufPrintPage({ searchParams }: KufPrintPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <main className="print-page ledger-print-page">
        <section className="ledger-print-document">
          <h1>Knjiga primljenih računa</h1>
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
    prisma.kufBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false,
        ...(dateFrom || dateTo
          ? {
              kuf_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {})
      },
      orderBy: [{ kuf_date: "asc" }, { redni_broj: "asc" }],
      select: {
        id: true,
        mjesec: true,
        kuf_date: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            id: true,
            redni_broj: true,
            supplier_invoice_number: true,
            invoice_date: true,
            receipt_date: true,
            total_base: true,
            total_input_vat: true,
            total_gross: true,
            dobavljac: {
              select: {
                naziv: true,
                pdv_broj: true,
                pib: true
              }
            },
            tax_lines: {
              select: {
                tax_base: true,
                input_vat_amount: true,
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
      bookDate: book.kuf_date
    }))
  );
  const periodFrom = dateFrom ?? books[0]?.kuf_date ?? null;
  const periodTo = dateTo ?? books.at(-1)?.kuf_date ?? null;
  const totals = rows.reduce(
    (sum, row) => {
      sum.exempt += exemptBase(row.tax_lines);
      sum.base += Number(row.total_base.toString());
      sum.vat += Number(row.total_input_vat.toString());
      sum.vat7 += taxAmount(row.tax_lines, 7);
      sum.vat15 += taxAmount(row.tax_lines, 15);
      sum.vat21 += taxAmount(row.tax_lines, 21);
      return sum;
    },
    {
      exempt: 0,
      base: 0,
      vat: 0,
      vat7: 0,
      vat15: 0,
      vat21: 0
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
            <p>PIB-MB/JMBG: {firma.pib ?? firma.maticni_broj ?? "-"}</p>
            <p>PDV broj: {firma.pdv_broj ?? "-"}</p>
          </div>
          <strong className="ledger-form-code">OBRAZAC U-RAČ</strong>
        </header>

        <div className="ledger-title">
          <h1>KNJIGA PRIMLJENIH RAČUNA</h1>
          <p>
            Period: <strong>{dateText(periodFrom)}</strong> - <strong>{dateText(periodTo)}</strong>
          </p>
        </div>

        <table className="ledger-print-table ledger-print-table--kuf">
          <colgroup>
            <col style={{ width: "3%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={3}>Red. broj</th>
              <th colSpan={2}>DATUM</th>
              <th colSpan={2}>RAČUN</th>
              <th colSpan={2}>ISPORUČILAC PROIZVODA ILI USLUGE (DOBAVLJAČ)</th>
              <th rowSpan={3}>Vrijednost nabavke oslobođene PDV</th>
              <th rowSpan={3}>Vrijednost oporezive nabavke</th>
              <th rowSpan={3}>UKUPAN IZNOS PDV (11 do 17)</th>
              <th colSpan={7}>STRUKTURA ULAZNOG PDV</th>
            </tr>
            <tr>
              <th rowSpan={2}>Prijem računa</th>
              <th rowSpan={2}>Knjiženje računa</th>
              <th rowSpan={2}>Broj</th>
              <th rowSpan={2}>Datum izdavanja</th>
              <th rowSpan={2}>Naziv, ime i prezime, sjedište</th>
              <th rowSpan={2}>PDV broj</th>
              <th colSpan={3}>PDV-a na domaće nabavke</th>
              <th colSpan={3}>PDV na usluge inostranih lica</th>
              <th>Paušalna nadoknada</th>
            </tr>
            <tr>
              <th>po stopi 7%</th>
              <th>po stopi 15%</th>
              <th>po stopi 21%</th>
              <th>po stopi 7%</th>
              <th>po stopi 15%</th>
              <th>po stopi 21%</th>
              <th>po stopi 8%</th>
            </tr>
            <tr>
              {Array.from({ length: 17 }, (_, index) => (
                <th key={index}>{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={17}>Nema podataka za izabrani period.</td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const monthChanged = row.bookMonth !== currentMonth;
                currentMonth = row.bookMonth;
                const exempt = exemptBase(row.tax_lines);
                const base = Number(row.total_base.toString());

                return [
                  monthChanged ? (
                    <tr className="ledger-month-row" key={`month-${row.bookMonth}-${row.id}`}>
                      <td colSpan={17}>
                        Mjesec: <strong>{mjeseci[row.bookMonth - 1] ?? row.bookMonth}</strong>
                      </td>
                    </tr>
                  ) : null,
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>{dateText(row.receipt_date)}</td>
                    <td>{dateText(row.bookDate)}</td>
                    <td>{normalizeFiscalInvoiceNumber(row.supplier_invoice_number)}</td>
                    <td>{dateText(row.invoice_date)}</td>
                    <td>{row.dobavljac.naziv}</td>
                    <td>{row.dobavljac.pdv_broj ?? row.dobavljac.pib ?? ""}</td>
                    <td>{money(exempt)}</td>
                    <td>{money(base - exempt)}</td>
                    <td>{money(Number(row.total_input_vat.toString()))}</td>
                    <td>{money(taxAmount(row.tax_lines, 7))}</td>
                    <td>{money(taxAmount(row.tax_lines, 15))}</td>
                    <td>{money(taxAmount(row.tax_lines, 21))}</td>
                    <td>{money(0)}</td>
                    <td>{money(0)}</td>
                    <td>{money(0)}</td>
                    <td>{money(0)}</td>
                  </tr>
                ];
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>UKUPNO</td>
              <td>{money(totals.exempt)}</td>
              <td>{money(totals.base - totals.exempt)}</td>
              <td>{money(totals.vat)}</td>
              <td>{money(totals.vat7)}</td>
              <td>{money(totals.vat15)}</td>
              <td>{money(totals.vat21)}</td>
              <td>{money(0)}</td>
              <td>{money(0)}</td>
              <td>{money(0)}</td>
              <td>{money(0)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </main>
  );
}
