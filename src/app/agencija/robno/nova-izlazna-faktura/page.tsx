import Link from "next/link";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createOutgoingInvoice } from "../izlazne-fakture/actions";

export default async function NewOutgoingInvoicePage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const [{ poruka }, context] = await Promise.all([searchParams, getInventoryContext("create")]);
  if (!context.firma) return <MissingInventoryContext title="Nova izlazna faktura" />;
  if (!context.allowed) return <InventoryAccessDenied title="Nova izlazna faktura" />;
  const today = new Date().toISOString().slice(0, 10);
  const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Prodaja</p><h2>Nova izlazna faktura</h2><p className="muted-text">Prvo unesite kupca i datum. Stavke dodajete odmah na narednom ekranu.</p></div><Link className="secondary-button" href="/agencija/robno/izlazne-fakture">Pregled faktura</Link></header>
    {poruka ? <p className="admin-message">{poruka === "obavezno" ? "Kupac i datum računa su obavezni." : "Provjerite unesene podatke."}</p> : null}
    <section className="admin-form-section"><form action={createOutgoingInvoice} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><PartnerSearchInput label="Kupac" name="kupac_id" required /><label><span>Datum računa</span><input type="date" name="datum_racuna" defaultValue={today} required /></label><label><span>Datum valute</span><input type="date" name="datum_valute" defaultValue={defaultDueDate} /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori nacrt i dodaj stavke</button></div></form></section></div>;
}
