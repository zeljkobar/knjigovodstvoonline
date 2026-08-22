import Link from "next/link";
import { notFound } from "next/navigation";
import { createPortalPosStorno } from "@/app/portal/pos/actions";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { findDirectPortalInvoice, formatPortalDecimal } from "@/lib/direct-portal-invoices";

export default async function PortalPosStornoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const context = await requireDirectPortalContext({ modul: "fiskalizacija", akcija: "cancel" }, `/portal/racuni/${id}/storno`);
  const invoice = await findDirectPortalInvoice(context, id);
  if (!invoice || invoice.document_type !== "POS_RECEIPT") notFound();
  const allowed = invoice.fiscal_status === "Fiscalized" && Boolean(invoice.iic && invoice.jikr && invoice.fiscal_api_invoice_id) && invoice.corrective_invoices.length === 0 && !context.year.zakljucena && !context.readiness.blocksChanges;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Fiskalni računi / Storno</p><h2>Potpuni storno računa</h2><p className="muted-text">Original: {invoice.official_invoice_number ?? invoice.broj_racuna}</p></div><Link className="secondary-button" href={`/portal/racuni/${invoice.id}`}>Nazad</Link></header>
    {query.poruka ? <p className="status-banner error">Storno nije moguće. Provjerite potvrdu, fiskalni status, poslovnu godinu i postojeće korekcije.</p> : null}
    <section className="admin-panel"><h3>Pregled potpunog storna</h3><p className="muted-text">Biće kreiran poseban negativni fiskalni dokument. Original ostaje sačuvan, a roba se vraća na lager tačno jednom.</p><div className="table-wrap"><table><thead><tr><th>Artikal / usluga</th><th>Količina</th><th>Ukupno</th></tr></thead><tbody>{invoice.stavke.map((line) => <tr key={line.id}><td>{line.naziv_artikla}</td><td>{formatPortalDecimal(line.kolicina, 3)}</td><td>{formatPortalDecimal(line.ukupno_sa_pdv)} €</td></tr>)}</tbody></table></div><p><strong>Ukupno za storno: {formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong></p></section>
    <section className="admin-panel danger-panel"><h3>Kritična potvrda</h3>{!allowed ? <p className="status-banner error">Račun nije podoban za storno ili već ima korektivni dokument.</p> : <form action={createPortalPosStorno} className="form-grid"><input name="invoice_id" type="hidden" value={invoice.id}/><label className="full-width">Razlog storna<textarea name="reason" required minLength={3}/></label><label className="single-checkbox full-width"><input name="confirmation" type="checkbox" value="CONFIRM" required/><span>Potvrđujem potpuni storno svih stavki i cjelokupnog iznosa.</span></label><div className="full-width"><button className="danger-button" type="submit">Kreiraj i fiskalizuj storno</button></div></form>}<p className="muted-text">Djelimični povrat trenutno nije dostupan.</p></section>
  </div>;
}
