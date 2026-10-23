import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createOutgoingInvoice } from "../izlazne-fakture/actions";

export default async function NewOutgoingInvoicePage({ searchParams }: { searchParams: Promise<{ poruka?: string; tip?: string; avans?: string }> }) {
  const [{ poruka, tip, avans }, context] = await Promise.all([searchParams, getInventoryContext("create")]);
  if (!context.firma) return <MissingInventoryContext title="Nova izlazna faktura" />;
  if (!context.allowed) return <InventoryAccessDenied title="Nova izlazna faktura" />;
  const source = avans && /^[0-9a-f-]{36}$/i.test(avans) ? await prisma.fiskalniIzlazniRacun.findFirst({where:{id:avans,agencija_id:context.user.agencija_id!,firma_id:context.firma.id,vrsta_racuna:"ADVANCE",document_type:"INVOICE",fiscal_status:"Fiscalized",is_deleted:false},include:{kupac:true}}) : null;
  if (avans && !source) notFound();
  const isAdvance = tip === "avans";
  const today = new Date().toISOString().slice(0, 10);
  const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Prodaja</p><h2>{isAdvance ? "Novi avansni račun" : source ? "Konačni račun iz avansa" : "Nova izlazna faktura"}</h2><p className="muted-text">Prvo unesite kupca i datum. Stavke dodajete odmah na narednom ekranu.</p></div><Link className="secondary-button" href={isAdvance ? "/agencija/robno/avansni-racuni" : "/agencija/robno/izlazne-fakture"}>{isAdvance ? "Pregled avansnih računa" : "Pregled faktura"}</Link></header>
    {poruka ? <p className="admin-message">{poruka === "obavezno" ? "Kupac i datum računa su obavezni." : "Provjerite unesene podatke."}</p> : null}
    <section className="admin-form-section"><form action={createOutgoingInvoice} className="admin-form"><input type="hidden" name="vrsta_racuna" value={isAdvance?"ADVANCE":"NORMAL"}/><input type="hidden" name="avansni_racun_id" value={source?.id??""}/><input type="hidden" name="firma_id" value={context.firma.id} /><PartnerSearchInput initialPartner={source?{id:source.kupac.id,naziv:source.kupac.naziv,label:source.kupac.naziv,pib:source.kupac.pib,scope:source.kupac.scope}:null} label="Kupac" name="kupac_id" required /><label><span>Datum računa</span><input type="date" name="datum_racuna" defaultValue={today} required /></label><label><span>Datum valute</span><input type="date" name="datum_valute" defaultValue={defaultDueDate} /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori nacrt i dodaj stavke</button></div></form></section></div>;
}
