import Link from "next/link";
import { PdvMonthForm } from "../_components";
import { money, vatTransactionLabel } from "@/lib/pdv";
import { loadPdvBooks, normalizePdvMonth, requirePdvContext } from "@/lib/pdv-service";

type PageProps = {
  searchParams?: Promise<{
    mjesec?: string;
  }>;
};

export default async function IzlazniPdvPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = normalizePdvMonth(params?.mjesec);
  const context = await requirePdvContext("view");
  const { kifBooks } = await loadPdvBooks({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month
  });
  const rows = kifBooks.flatMap((book) =>
    book.entries.map((entry) => ({
      ...entry,
      bookId: book.id,
      bookNumber: book.internal_kif_number,
      bookDate: book.kif_date
    }))
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Izlazni PDV</h2>
          <p>KIF računi koji ulaze u obračun po datumu KIF knjige.</p>
        </div>
      </header>

      <PdvMonthForm action="/agencija/pdv/izlazni" month={month} />

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>KIF</th>
              <th>Datum KIF-a</th>
              <th>Račun</th>
              <th>Kupac</th>
              <th>Tip prometa</th>
              <th>Osnovica</th>
              <th>Izlazni PDV</th>
              <th>Ukupno</th>
              <th>Detalj</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9}>Nema KIF računa za izabrani mjesec.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.bookNumber}</td>
                  <td>{row.bookDate.toLocaleDateString("sr-Latn-ME")}</td>
                  <td>{row.customer_invoice_number}</td>
                  <td>
                    {row.kupac.naziv}
                    <small>{row.kupac.pib ?? ""}</small>
                  </td>
                  <td>{vatTransactionLabel(row.vat_transaction_type)}</td>
                  <td className="numeric">{money(Number(row.total_base.toString()))}</td>
                  <td className="numeric">{money(Number(row.total_output_vat.toString()))}</td>
                  <td className="numeric">{money(Number(row.total_gross.toString()))}</td>
                  <td>
                    <Link className="secondary-button" href={`/agencija/racuni/kif/${row.bookId}`}>
                      KIF
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
