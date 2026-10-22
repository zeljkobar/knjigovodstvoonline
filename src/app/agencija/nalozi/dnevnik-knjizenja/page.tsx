import Link from "next/link";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { PostingJournalTable } from "@/components/PostingJournalTable";
import { loadPostingJournal, postingJournalQuery, type PostingJournalParams } from "@/lib/posting-journal";
import "./style.css";
export default async function PostingJournalPage({ searchParams }: { searchParams?: Promise<PostingJournalParams> }) {
  const params = await searchParams ?? {};
  const data = await loadPostingJournal(params);
  if (!data) return <section className="admin-panel">Izaberite firmu i poslovnu godinu.</section>;
  const pages = Math.max(1, Math.ceil(data.count / 100));
  return <div className="posting-journal"><header className="admin-header"><div><h2>Dnevnik knjiženja</h2><p>{data.firma.naziv} · {data.godina.godina}</p><p>Sve proknjižene stavke, od najstarijeg datuma naloga. Nacrti i obrisani nalozi se ne prikazuju.</p></div>
    {data.canPrint && !data.error ? <Link className="button" target="_blank" href={`/stampa/dnevnik-knjizenja?${postingJournalQuery(params)}`}>Štampaj dnevnik</Link> : null}</header>
    <section className="admin-panel"><h3>Filteri i pretraga</h3><AutoSubmitFilterForm action="/agencija/nalozi/dnevnik-knjizenja" className="journal-filters">
      <label>Datum naloga od<input type="date" name="datum_od" defaultValue={params.datum_od} /></label>
      <label>Datum naloga do<input type="date" name="datum_do" defaultValue={params.datum_do} /></label>
      <label>R. br. u pregledu<input type="search" name="rbr" defaultValue={params.rbr} placeholder="Red u filtriranom pregledu" inputMode="numeric" /></label>
      <label>Nalog<input type="search" name="nalog" defaultValue={params.nalog} placeholder="Broj ili šifra naloga" /></label>
      <label>Stavka naloga<input type="search" name="stavka" defaultValue={params.stavka} placeholder="Redni broj stavke" inputMode="numeric" /></label>
      <label>Konto<input type="search" name="konto" defaultValue={params.konto} placeholder="Šifra ili dio naziva" /></label>
      <label>Partner<input type="search" name="partner" defaultValue={params.partner} placeholder="Naziv ili PIB" /></label>
      <label>Dokument<input type="search" name="dokument" defaultValue={params.dokument} placeholder="Broj dokumenta" /></label>
      <label>Datum dokumenta<input type="date" name="datum_dokumenta" defaultValue={params.datum_dokumenta} /></label>
      <label>Opis<input type="search" name="opis" defaultValue={params.opis} placeholder="Dio opisa" /></label>
      <label>Duguje<input type="search" name="duguje" defaultValue={params.duguje} placeholder="Tačan iznos, npr. 60,50" inputMode="decimal" /></label>
      <label>Potražuje<input type="search" name="potrazuje" defaultValue={params.potrazuje} placeholder="Tačan iznos, npr. 60,50" inputMode="decimal" /></label>
      <Link href="/agencija/nalozi/dnevnik-knjizenja">Poništi filtere</Link>
    </AutoSubmitFilterForm></section>
    {data.error ? <p role="alert">{data.error}</p> : <section className="admin-panel"><p>{data.count} stavki · Iznosi u EUR · Zbir obuhvata sve stranice.</p><div className="table-wrap"><PostingJournalTable data={data} /></div>
      <nav aria-label="Stranice dnevnika" className="journal-pagination">{data.page > 1 ? <Link href={`?${postingJournalQuery(params, data.page - 1)}`}>Prethodna</Link> : null}<span>Strana {data.page} / {pages}</span>{data.page < pages ? <Link href={`?${postingJournalQuery(params, data.page + 1)}`}>Sljedeća</Link> : null}</nav></section>}
  </div>;
}
