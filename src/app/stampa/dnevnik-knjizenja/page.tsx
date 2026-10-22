import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { PostingJournalTable } from "@/components/PostingJournalTable";
import { loadPostingJournal, postingJournalQuery, type PostingJournalParams } from "@/lib/posting-journal";
import "./print.css";
export default async function PostingJournalPrint({ searchParams }: { searchParams?: Promise<PostingJournalParams> }) {
  const params = await searchParams ?? {};
  const data = await loadPostingJournal(params, true);
  if (!data) return <main className="print-page">Izaberite firmu i poslovnu godinu.</main>;
  const date = (s?: string) => s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" }) : null;
  return <main className="print-page"><div className="print-toolbar"><Link href={`/agencija/nalozi/dnevnik-knjizenja?${postingJournalQuery(params)}`}>Nazad</Link>{!data.error ? <PrintButton label="Štampaj dnevnik" /> : null}</div><article className="posting-journal-print"><header><strong>{data.firma.naziv}</strong><p>PIB: {data.firma.pib}</p><h1>Dnevnik knjiženja</h1><p>Poslovna godina: {data.godina.godina}</p></header>{data.error ? <p>{data.error}</p> : <><p>Period: {date(params.datum_od) ?? "početak godine"} – {date(params.datum_do) ?? "kraj godine"} · Iznosi u EUR</p><p>{([["rbr", "R. br."], ["nalog", "Nalog"], ["stavka", "Stavka"], ["konto", "Konto"], ["partner", "Partner"], ["dokument", "Dokument"], ["datum_dokumenta", "Datum dokumenta"], ["opis", "Opis"], ["duguje", "Duguje"], ["potrazuje", "Potražuje"]] as const).filter(([key]) => params[key]).map(([key, label]) => `${label}: ${params[key]}`).join(" · ")}</p><PostingJournalTable data={data} print /><p>Samo proknjižene stavke, hronološki po datumu naloga.</p></>}</article></main>;
}
