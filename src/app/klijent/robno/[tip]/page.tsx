import Link from "next/link";
import { loadClientInventory, clientInventoryTypes } from "@/lib/client-inventory";
import { clientDocumentStatusLabel } from "@/lib/client-inventory";

export default async function ClientDocuments({ params, searchParams }: {
 params: Promise<{ tip: string }>; searchParams: Promise<{ strana?: string; status?: string }>;
}) {
 const { tip } = await params;
 const query = await searchParams;
 const data = await loadClientInventory(tip, { page: Number(query.strana) || 1, status: query.status });
 return <div className="admin-stack">
  <header className="admin-header"><div><p className="eyebrow">Robno</p><h1>{data.title}</h1><p>{data.context.firma.naziv} · {data.context.year.godina}</p></div></header>
  <nav className="tabs-row" aria-label="Robni dokumenti">{Object.entries(clientInventoryTypes).map(([key, label]) => <Link key={key} className={tip === key ? "tab-link active" : "tab-link"} href={`/klijent/robno/${key}`}>{label}</Link>)}</nav>
  <section className="admin-panel"><form className="admin-form"><label>Status<select name="status" defaultValue={query.status ?? ""}><option value="">Svi dokumenti</option><option value="DRAFT">Nacrti</option><option value="POSTED">Proknjiženi</option></select></label><button className="secondary-button" type="submit">Prikaži</button></form><p className="muted-text">Nacrti su u pripremi i ne predstavljaju proknjižen promet.</p></section>
  <section className="admin-panel"><div className="table-wrap"><table className="admin-table"><thead><tr><th>Broj</th><th>Datum</th><th>Partner / magacin</th><th>Vrijednost</th><th>Status</th><th></th></tr></thead><tbody>{data.documents.map((doc) => <tr key={doc.id}><td>{doc.number}</td><td>{doc.date.toLocaleDateString("sr-Latn-ME")}</td><td>{doc.description}</td><td>{doc.total}<small>{doc.totalLabel}</small></td><td>{clientDocumentStatusLabel(tip, doc.status)}</td><td><Link href={`/klijent/robno/${tip}/${doc.id}`}>Otvori</Link></td></tr>)}{!data.documents.length ? <tr><td colSpan={6}>Nema dokumenata za izabrane uslove.</td></tr> : null}</tbody></table></div>
  <div className="table-actions"><span>{data.count} dokumenata · Strana {data.page}</span>{data.page > 1 ? <Link href={`?strana=${data.page - 1}&status=${encodeURIComponent(query.status ?? "")}`}>Prethodna</Link> : null}{data.page * 50 < data.count ? <Link href={`?strana=${data.page + 1}&status=${encodeURIComponent(query.status ?? "")}`}>Sljedeća</Link> : null}</div></section>
 </div>;
}
