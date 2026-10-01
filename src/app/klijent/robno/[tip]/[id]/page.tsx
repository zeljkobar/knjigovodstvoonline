import Link from "next/link";
import { loadClientInventory } from "@/lib/client-inventory";
import { clientDocumentStatusLabel } from "@/lib/client-inventory";

export default async function ClientDocument({ params }: { params: Promise<{ tip: string; id: string }> }) {
 const { tip, id } = await params;
 const data = await loadClientInventory(tip, { id });
 const doc = data.documents[0];
 return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">{data.title}</p><h1>{doc.number}</h1><p>{data.context.firma.naziv} · {doc.date.toLocaleDateString("sr-Latn-ME")} · {clientDocumentStatusLabel(tip, doc.status)}</p></div><Link className="secondary-button" href={`/klijent/robno/${tip}`}>Nazad na pregled</Link></header>
  <section className="admin-panel"><h2>{doc.description}</h2><p>{doc.totalLabel}: <strong>{doc.total} EUR</strong></p>{doc.note ? <p>{doc.note}</p> : null}{doc.status === "DRAFT" ? <p className="admin-message">Dokument je u pripremi. Iznosi se mogu promijeniti.</p> : null}</section>
  <section className="admin-panel"><div className="table-wrap"><table className="admin-table"><thead><tr><th>Artikal</th>{doc.columns.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{doc.lines.map((line) => <tr key={line.id}><td>{line.item}</td>{line.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}{!doc.lines.length ? <tr><td colSpan={doc.columns.length + 1}>Nema stavki.</td></tr> : null}</tbody></table></div></section>
 </div>;
}
