import Link from "next/link";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { completePosTransferAccounting, retryPosFiscalization } from "../actions";

const paymentLabels: Record<string, string> = { CASH: "Gotovina", CARD: "Kartica", BANK_TRANSFER: "Virman", OTHER: "Ostalo" };
const accountingLabels: Record<string, string> = { WAITING_KIF: "Čeka KIF", ACCOUNTING_PENDING: "Čeka knjiženje", WAITING_PAZAR: "Čeka zbirni pazar", NOT_REQUIRED: "Bez integracije", IMPORTED: "U KIF-u" };
const accountingErrors: Record<string, string> = {
  godina: "Poslovna godina je zaključana.",
  pdv_period: "PDV period računa je zaključan.",
  vrsta_naloga: "Nije pronađena aktivna vrsta naloga za izlazne račune.",
  podesavanja: "Nijesu kompletno podešena konta za knjiženje izlaznih računa.",
  balans: "Šema knjiženja nije u ravnoteži.",
  konto: "Jedno od podešenih konta nije dostupno firmi.",
  racun: "Račun nije fiskalizovan virman račun ove firme.",
  neocekivano: "Došlo je do neočekivane greške pri pripremi knjiženja."
};

export default async function PosReceiptsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; uspjeh?: string; greska?: string; obrada?: string; knjizenje?: string }> }) {
  const params = await searchParams;
  const ctx = await getPosContext("view");
  if (!ctx.firma || !ctx.year || !ctx.allowed) return <section className="admin-panel"><p>Nemate pravo pregleda POS računa.</p></section>;
  const invoices = await prisma.fiskalniIzlazniRacun.findMany({ where: { firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, sales_channel: "POS", is_deleted: false }, include: { pos_register: true, placanja: true }, orderBy: { issued_at: "desc" }, take: 200 });

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS</p><h2>Fiskalni računi</h2><p className="muted-text">Posljednjih 200 računa aktivne firme.</p></div><Link className="primary-button" href="/agencija/pos">Nova prodaja</Link></header>
    {params.uspjeh ? <p className="status-banner success">Neuspjeli račun je uspješno fiskalizovan bez kreiranja novog dokumenta ili broja.</p> : null}
    {params.knjizenje ? <p className="status-banner success">Virman račun je pripremljen za KIF i kreiran je nalog po šemi izlaznih računa.</p> : null}
    {params.greska ? <p className="status-banner error">Ponovna fiskalizacija nije uspjela. Račun je ostao sačuvan i može se ponovo pokušati.</p> : null}
    {params.poruka ? <p className="status-banner error">Ponovna fiskalizacija nije moguća za izabrani račun ili fiskalna kasa nije spremna.</p> : null}
    {params.obrada ? <p className="status-banner error">Račun je fiskalizovan, ali računovodstvena obrada nije završena: {accountingErrors[params.obrada] ?? accountingErrors.neocekivano}</p> : null}
    <section className="admin-panel"><div className="table-wrap"><table><thead><tr><th>Vrijeme</th><th>Broj</th><th>Kasa</th><th>Plaćanje</th><th>Ukupno</th><th>Fiskalni status</th><th>Računovodstvo</th><th></th></tr></thead><tbody>
      {invoices.map((invoice) => <tr key={invoice.id}>
        <td>{invoice.issued_at?.toLocaleString("sr-Latn-ME")}</td><td>{invoice.broj_racuna}</td><td>{invoice.pos_register?.naziv}</td>
        <td>{invoice.placanja.map((payment) => paymentLabels[payment.payment_method] ?? payment.payment_method).join(", ")}</td><td>{Number(invoice.ukupno_sa_pdv).toFixed(2)} €</td>
        <td>{invoice.fiscal_status}</td><td>{accountingLabels[invoice.kif_status] ?? invoice.kif_status}</td>
        <td><div className="table-actions"><Link className="table-button" href={`/stampa/robno/izlazne-fakture/${invoice.id}`}>Štampa</Link>
          {invoice.fiscal_status === "FiscalizationFailed" ? <form action={retryPosFiscalization}><input name="invoice_id" type="hidden" value={invoice.id}/><button className="table-button" type="submit">Ponovi fiskalizaciju</button></form> : null}
          {invoice.fiscal_status === "Fiscalized" && invoice.nacin_placanja === "BANK_TRANSFER" && invoice.kif_status === "ACCOUNTING_PENDING" ? <form action={completePosTransferAccounting}><input name="invoice_id" type="hidden" value={invoice.id}/><button className="table-button" type="submit">Završi knjiženje</button></form> : null}
        </div></td>
      </tr>)}
    </tbody></table></div></section>
  </div>;
}
