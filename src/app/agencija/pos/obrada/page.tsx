import Link from "next/link";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { createPosBatch } from "./actions";

const errors: Record<string, string> = {
  datum: "Izaberite ispravan datum perioda.", rezim: "Izaberite dnevni ili mjesečni režim.", godina: "Poslovna godina je zaključana ili datum ne pripada aktivnoj godini.", integracija: "Računovodstvena integracija POS-a nije uključena.", kif: "Za izabrani mjesec prvo otvorite KIF knjigu.", nema_racuna: "Nema novih fiskalizovanih gotovinskih ili kartičnih računa za taj period.", naplata: "Zbir plaćanja se ne slaže sa ukupnim prometom. Obrada je zaustavljena.", preklapanje: "Za izabrani period već postoji ručno ili automatski unesen pazar u KIF-u."
};

function dateValue(date: Date) { return date.toISOString().slice(0, 10); }

export default async function PosBatchPage({ searchParams }: { searchParams: Promise<{ poruka?: string; uspjeh?: string }> }) {
  const [query, ctx] = await Promise.all([searchParams, getPosContext("manage")]);
  if (!ctx.firma || !ctx.year || !ctx.allowed) return <section className="admin-panel"><p>Nemate pravo upravljanja POS obradom.</p></section>;
  const [settings, batches] = await Promise.all([
    prisma.posPodesavanje.findUnique({ where: { firma_id: ctx.firma.id } }),
    prisma.posKifBatch.findMany({ where: { firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id }, include: { kif_entry: { select: { kif_book_id: true, internal_kif_number: true, posting_status: true } }, accounting_batch: { select: { status: true, journal_id: true } } }, orderBy: { period_from: "desc" }, take: 50 })
  ]);
  const today = new Date();
  const defaultDate = today.getUTCFullYear() === ctx.year.godina ? today : new Date(Date.UTC(ctx.year.godina, 0, 1));
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS / Računovodstvo</p><h2>Zbirna obrada POS računa</h2><p className="muted-text">Gotovina i kartice ulaze zbirno u KIF i jedan zbirni nalog. Virmani ostaju pojedinačni.</p></div><Link className="secondary-button" href="/agencija/pos/racuni">Fiskalni računi</Link></header>
    {query.uspjeh ? <p className="status-banner success">POS zbir je kreiran. Otvorite pripadajući KIF i proknjižite ga postojećim KIF tokom.</p> : null}
    {query.poruka ? <p className="status-banner error">{errors[query.poruka] ?? "Zbirna obrada nije uspjela."}</p> : null}
    <section className="admin-panel"><div className="panel-header"><h3>Novi zbir</h3><span>{settings?.racunovodstvena_integracija ? "Integracija uključena" : "Integracija isključena"}</span></div>
      <p className="muted-text">Sistem uzima samo uspješno fiskalizovane POS račune koji nijesu ranije obuhvaćeni batchom. Režim se čuva u POS podešavanjima.</p>
      <form action={createPosBatch} className="form-grid"><label>Režim<select name="mode" defaultValue={settings?.kif_rezim ?? "DAILY"}><option value="DAILY">Dnevni zbir</option><option value="MONTHLY">Mjesečni zbir</option></select></label><label>Datum perioda<input type="date" name="period_date" defaultValue={dateValue(defaultDate)} required /></label><button className="primary-button" type="submit" disabled={!settings?.racunovodstvena_integracija}>Kreiraj zbir i prenesi u KIF</button></form>
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Prethodne obrade</h3><span>{batches.length} prikazano</span></div><div className="table-wrap"><table><thead><tr><th>Period</th><th>Režim</th><th>Računa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th><th>KIF</th><th>Nalog</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td>{batch.period_from.toLocaleDateString("sr-Latn-ME")} – {batch.period_to.toLocaleDateString("sr-Latn-ME")}</td><td>{batch.aggregation_mode === "DAILY" ? "Dnevni" : "Mjesečni"}</td><td>{batch.invoice_count}</td><td>{Number(batch.total_base).toFixed(2)} €</td><td>{Number(batch.total_tax).toFixed(2)} €</td><td>{Number(batch.total_gross).toFixed(2)} €</td><td>{batch.kif_entry.kif_book_id ? <Link href={`/agencija/racuni/kif/${batch.kif_entry.kif_book_id}`}>{batch.kif_entry.internal_kif_number}</Link> : batch.kif_entry.internal_kif_number}</td><td>{batch.accounting_batch?.journal_id ? <Link href={`/agencija/nalozi/${batch.accounting_batch.journal_id}`}>Otvori nalog</Link> : "Čeka knjiženje KIF-a"}</td></tr>)}</tbody></table></div></section>
  </div>;
}
