import type { loadClientPartnerCardReport } from "@/lib/client-partner-card";
import { formatInventoryMoney as money } from "@/app/agencija/_components/inventory-report-utils";

export function clientPartnerCardDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" });
}

type PartnerCardReport = Awaited<ReturnType<typeof loadClientPartnerCardReport>>;

function rowDescription(row: PartnerCardReport["rows"][number], print: boolean) {
  if (print) {
    const { bankStatements, source_type, vrsta_naloga } = row.nalog;
    const statementNumber = bankStatements.length === 1
      ? bankStatements[0].statement_number
      : bankStatements.length === 0 && (source_type === "BANK_STATEMENT" || vrsta_naloga.sifra === "BANK_STATEMENT")
        ? row.broj_dokumenta
        : null;
    if (statementNumber) return `Izvod ${statementNumber}`;
  }
  return [row.opis, row.dodatni_opis].filter(Boolean).join(" · ");
}

export function ClientPartnerCardTable({ report, print = false }: {
  report: PartnerCardReport;
  print?: boolean;
}) {
  const { rows, opening, debit, credit, balance } = report;
  return <>
    <p>Početni saldo prije perioda: <strong>{money(opening)}</strong></p>
    <div className={print ? undefined : "table-wrap"}>
      <table className={print ? "account-card-print-table client-partner-print-table" : "admin-table"}>
        <thead><tr>
          <th>Datum</th><th>Dokument</th><th>Opis</th><th>Valuta</th><th>Duguje</th><th>Potražuje</th><th>Saldo</th>
        </tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.id}>
            <td>{clientPartnerCardDate(row.nalog.datum)}</td>
            <td>{row.broj_dokumenta ?? "—"}</td>
            <td>{rowDescription(row, print)}</td>
            <td>{row.datum_valute ? clientPartnerCardDate(row.datum_valute) : "—"}</td>
            <td>{money(row.debit)}</td><td>{money(row.credit)}</td><td>{money(row.balance)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={7}>Nema prometa u izabranom periodu.</td></tr>}
        </tbody>
        <tfoot><tr>
          <th colSpan={4}>Ukupno</th><td>{money(debit)}</td><td>{money(credit)}</td><td>{money(balance)}</td>
        </tr></tfoot>
      </table>
    </div>
  </>;
}
