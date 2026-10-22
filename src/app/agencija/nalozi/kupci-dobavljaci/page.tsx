import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import Link from "next/link";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { loadPartnerSummary, partnerSummaryMoney as money, partnerSummaryQuery, type PartnerSummaryRow, type PartnerSummaryParams } from "@/lib/partner-summary";

type KupciDobavljaciPageProps = { searchParams?: Promise<PartnerSummaryParams> };

function analyticsHref(row: PartnerSummaryRow, params?: Awaited<KupciDobavljaciPageProps["searchParams"]>) {
  const query = new URLSearchParams({
    konto: row.kontoId,
    partner: row.partnerId
  });

  if (params?.datum_od) {
    query.set("datum_od", params.datum_od);
  }

  if (params?.datum_do) {
    query.set("datum_do", params.datum_do);
  }

  return `/agencija/nalozi/analiticke-kartice?${query.toString()}`;
}

export default async function KupciDobavljaciPage({
  searchParams
}: KupciDobavljaciPageProps) {
  const params = await searchParams;
  const data = await loadPartnerSummary(params);
  if (!data) return <div className="admin-stack"><h1>Kupci / dobavljači</h1><p>Izaberite firmu i poslovnu godinu u gornjem izboru.</p></div>;
  const { firma, godina, accounts, rows, totalDebitBalance, totalCreditBalance, canPrint, filterError } = data;
  const selectedAccount = params?.konto ?? "";

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Kupci / dobavljači</h1>
        </div>
        {canPrint ? <Link className="secondary-button" target="_blank" rel="noopener noreferrer" href={`/stampa/kupci-dobavljaci?${partnerSummaryQuery(params)}`}>Štampaj pregled</Link> : null}
      </header>
      {filterError ? <p role="alert" className="admin-message">{filterError}</p> : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>Firma</span>
          <strong>{firma.naziv}</strong>
        </article>
        <article className="stat-card">
          <span>Godina</span>
          <strong>{godina.godina}</strong>
        </article>
        <article className="stat-card">
          <span>Saldo duguje</span>
          <strong>{money(totalDebitBalance)}</strong>
        </article>
        <article className="stat-card">
          <span>Saldo potražuje</span>
          <strong>{money(totalCreditBalance)}</strong>
        </article>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Filteri</h2>
          <span>{rows.length} partnera</span>
        </div>
        <AutoSubmitFilterForm
          action="/agencija/nalozi/kupci-dobavljaci"
          className="admin-form journal-filter-form"
        >
          <label>
            <span>Konto</span>
            <AccountSearchSelect name="konto" defaultValue={selectedAccount || "ALL"}>
              <option value="ALL">Sva konta sa analitikom</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </AccountSearchSelect>
          </label>
          <label>
            <span>Datum od</span>
            <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
          </label>
        </AutoSubmitFilterForm>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Pregled po partnerima</h2>
          <span>Otvoreni saldo po analitičkom kontu i partneru</span>
        </div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Partner</th>
                <th>Duguje</th>
                <th>Potražuje</th>
                <th>Saldo duguje</th>
                <th>Saldo potražuje</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kontoId}-${row.partnerId}`}>
                  <td>
                    {row.kontoSifra}
                    <small>{row.kontoNaziv}</small>
                  </td>
                  <td>
                    {row.partnerName}
                    <small>{row.partnerPib ?? ""}</small>
                  </td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>
                    <strong>{row.balance > 0 ? money(row.balance) : "0,00"}</strong>
                  </td>
                  <td>
                    <strong>{row.balance < 0 ? money(Math.abs(row.balance)) : "0,00"}</strong>
                  </td>
                  <td>
                    <Link className="table-link" href={analyticsHref(row, params)}>
                      Kartica
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nema otvorenih stavki za izabrane uslove.</td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="balance-total-row">
                <td colSpan={2}>Ukupno</td>
                <td>{money(rows.reduce((sum, row) => sum + row.debit, 0))}</td>
                <td>{money(rows.reduce((sum, row) => sum + row.credit, 0))}</td>
                <td>{money(totalDebitBalance)}</td>
                <td>{money(totalCreditBalance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
