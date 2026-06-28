import Link from "next/link";
import { PdvMonthForm } from "../_components";
import { money, vatTransactionLabel } from "@/lib/pdv";
import { loadPdvBooks, normalizePdvMonth, requirePdvContext } from "@/lib/pdv-service";

type PageProps = {
  searchParams?: Promise<{
    mjesec?: string;
  }>;
};

export default async function UlazniPdvPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = normalizePdvMonth(params?.mjesec);
  const context = await requirePdvContext("view");
  const { kufBooks } = await loadPdvBooks({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month
  });
  const rows = kufBooks.flatMap((book) =>
    book.entries.map((entry) => ({
      ...entry,
      bookId: book.id,
      bookNumber: book.internal_kuf_number,
      bookDate: book.kuf_date
    }))
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Ulazni PDV</h2>
          <p>KUF računi koji ulaze u obračun po datumu KUF knjige.</p>
        </div>
      </header>

      <PdvMonthForm action="/agencija/pdv/ulazni" month={month} />

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>KUF</th>
              <th>Datum KUF-a</th>
              <th>Račun</th>
              <th>Dobavljač</th>
              <th>Tip prometa</th>
              <th>Osnovica</th>
              <th>Ulazni PDV</th>
              <th>Odbitni</th>
              <th>Neodbitni</th>
              <th>Uvoz/JCI</th>
              <th>Detalj</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11}>Nema KUF računa za izabrani mjesec.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.bookNumber}</td>
                  <td>{row.bookDate.toLocaleDateString("sr-Latn-ME")}</td>
                  <td>{row.supplier_invoice_number}</td>
                  <td>
                    {row.dobavljac.naziv}
                    <small>{row.dobavljac.pib ?? ""}</small>
                  </td>
                  <td>{vatTransactionLabel(row.vat_transaction_type)}</td>
                  <td className="numeric">{money(Number(row.total_base.toString()))}</td>
                  <td className="numeric">{money(Number(row.total_input_vat.toString()))}</td>
                  <td className="numeric">{money(Number(row.deductible_vat.toString()))}</td>
                  <td className="numeric">{money(Number(row.non_deductible_vat.toString()))}</td>
                  <td>
                    {row.customs_declaration_number ?? "-"}
                    <small>{money(Number(row.customs_vat_amount.toString()))}</small>
                  </td>
                  <td>
                    <Link className="secondary-button" href={`/agencija/racuni/kuf/${row.bookId}`}>
                      KUF
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
