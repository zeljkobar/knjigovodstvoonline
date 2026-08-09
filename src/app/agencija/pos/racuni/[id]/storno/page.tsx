import Link from "next/link";
import { notFound } from "next/navigation";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { createAndFiscalizePosStorno } from "../../../actions";

export default async function PosStornoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, query, ctx] = await Promise.all([params, searchParams, getPosContext("manage")]);
  if (!ctx.firma || !ctx.year || !ctx.allowed) return <section className="admin-panel"><p>Nemate pravo storniranja POS računa.</p></section>;
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({ where: { id, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, sales_channel: "POS", document_type: "POS_RECEIPT", is_deleted: false }, include: { stavke: { orderBy: { redni_broj: "asc" } }, corrective_invoices: { where: { is_deleted: false }, select: { id: true } } } });
  if (!invoice) notFound();
  const allowed = invoice.fiscal_status === "Fiscalized" && Boolean(invoice.iic && invoice.jikr && invoice.fiscal_api_invoice_id) && invoice.corrective_invoices.length === 0;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS / Povrat</p><h2>Potpuni storno računa</h2><p className="muted-text">Original: {invoice.broj_racuna}</p></div><Link className="secondary-button" href="/agencija/pos/racuni">Nazad</Link></header>
    {query.poruka ? <p className="status-banner error">Storno nije moguće. Provjerite potvrdu, fiskalni status, zaključavanje perioda i postojeće korekcije.</p> : null}
    <section className="admin-panel"><h3>Šta će se desiti</h3><p className="muted-text">Biće kreiran novi negativni fiskalni dokument povezan sa originalom. Original ostaje sačuvan, roba se vraća na lager, a KIF i PDV dobijaju korektivne iznose.</p><div className="table-wrap"><table><thead><tr><th>Artikal / usluga</th><th>Količina</th><th>Ukupno</th></tr></thead><tbody>{invoice.stavke.map((line) => <tr key={line.id}><td>{line.naziv_artikla}</td><td>{Number(line.kolicina).toFixed(3)}</td><td>{Number(line.ukupno_sa_pdv).toFixed(2)} €</td></tr>)}</tbody></table></div><p><strong>Ukupno za storno: {Number(invoice.ukupno_sa_pdv).toFixed(2)} €</strong></p></section>
    <section className="admin-panel danger-panel"><h3>Potvrda potpunog storna</h3>{!allowed ? <p className="status-banner error">Ovaj račun nije podoban za storno ili već ima korektivni dokument.</p> : <form action={createAndFiscalizePosStorno} className="form-grid"><input name="invoice_id" type="hidden" value={invoice.id} /><label className="full-width">Razlog storna<textarea name="reason" required minLength={3} placeholder="Npr. kupac je odustao od kupovine" /></label><label className="single-checkbox full-width"><input name="confirmation" type="checkbox" value="CONFIRM" required /><span>Potvrđujem potpuni storno svih stavki i cjelokupnog iznosa.</span></label><div className="full-width"><button className="danger-button" type="submit">Fiskalizuj potpuni storno</button></div></form>}<p className="muted-text">Djelimični povrat trenutno nije dostupan jer ga Fiscal API još ne podržava.</p></section>
  </div>;
}
