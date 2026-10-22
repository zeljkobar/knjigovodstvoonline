import Link from "next/link";
import { formatJournalCode } from "@/lib/journals";
import { journalMoney, type loadPostingJournal } from "@/lib/posting-journal";

type Data = NonNullable<Awaited<ReturnType<typeof loadPostingJournal>>>;
const date = (value: Date | null) => value?.toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" }) ?? "—";
export function PostingJournalTable({ data, print = false }: { data: Data; print?: boolean }) {
  return <table><thead><tr><th>R. br.</th><th>Datum naloga</th><th>Nalog / stavka</th><th>Konto</th><th>Partner</th><th>Dokument</th><th>Opis</th><th>Duguje</th><th>Potražuje</th></tr></thead>
    <tbody>{data.rows.map((row, index) => {
      const code = row.nalog.sifra || formatJournalCode(row.nalog.vrsta_naloga.prefiks, data.godina.godina, row.nalog.broj);
      return <tr key={row.id}><td>{data.ordinal ?? ((print ? 0 : (data.page - 1) * 100) + index + 1)}</td><td>{date(row.nalog.datum)}</td>
        <td>{print ? code : <Link href={`/agencija/nalozi/${row.nalog_id}`}>{code}</Link>}<small>Stavka {row.redni_broj}</small></td>
        <td>{row.firma_konto.sifra}<small>{row.firma_konto.naziv}</small></td><td>{row.komitent?.naziv ?? "—"}<small>{row.komitent?.pib}</small></td>
        <td>{row.broj_dokumenta ?? "—"}<small>{date(row.datum_dokumenta)}</small></td>
        <td>{row.opis || row.nalog.opis || "—"}{row.dodatni_opis ? <small>{row.dodatni_opis}</small> : null}</td>
        <td className="journal-amount">{journalMoney(row.debit)}</td><td className="journal-amount">{journalMoney(row.credit)}</td></tr>;
    })}{!data.rows.length ? <tr><td colSpan={9}>Nema proknjiženih stavki za izabrani period.</td></tr> : null}</tbody>
    <tfoot><tr><th colSpan={7}>UKUPNO ZA IZABRANI PERIOD ({data.count} stavki)</th><th className="journal-amount">{journalMoney(data.debit)}</th><th className="journal-amount">{journalMoney(data.credit)}</th></tr></tfoot>
  </table>;
}
