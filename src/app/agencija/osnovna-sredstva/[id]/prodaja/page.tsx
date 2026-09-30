import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser,hasPermission } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { assetDate } from "@/lib/fixed-assets-batches";
import { fixedAssetMoney } from "@/lib/fixed-assets";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { KifTaxLinesForm } from "@/components/KifTaxLinesForm";
import { createKifEntry } from "@/app/agencija/racuni/actions";
import { confirmFixedAssetSale } from "../../lifecycle-actions";
export default async function AssetSale({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<{greska?:string}>}) {
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),ctx=await readWorkContext(),{id}=await params,query=await searchParams;
 if(!user.agencija_id||!ctx.firmaId||!ctx.poslovnaGodinaId)notFound();
 await requirePermissionForUser(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"view"});
 const scope={agencija_id:user.agencija_id,firma_id:ctx.firmaId,poslovna_godina_id:ctx.poslovnaGodinaId};
 const asset=await prisma.osnovnoSredstvo.findFirst({where:{id,agencija_id:user.agencija_id,firma_id:ctx.firmaId,is_deleted:false},include:{parametri:{orderBy:{vazi_od:"desc"},take:1}}});
 const year=await prisma.poslovnaGodina.findFirst({where:{id:ctx.poslovnaGodinaId,firma_id:ctx.firmaId}});if(!asset||!year)notFound();
 const [entry,books,rates,canEdit,canCreateKif,canPost]=await Promise.all([
 prisma.kifEntry.findFirst({where:{...scope,source_type:"FIXED_ASSET_SALE",source_id:id,is_deleted:false},include:{kupac:true}}),
 prisma.kifBook.findMany({where:{...scope,status:"OPEN",is_deleted:false},orderBy:{redni_broj:"desc"}}),
 prisma.pdvStopa.findMany({where:{agencija_id:user.agencija_id,aktivna:true},orderBy:{procenat:"desc"}}),
 hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"update"}),hasPermission(user,{firmaId:ctx.firmaId,modul:"izlazni_racuni",akcija:"create"}),hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"post"})]);
 const accounts=await prisma.firmaKonto.findMany({where:{firma_id:ctx.firmaId,id:{in:asset.parametri.flatMap(p=>[p.konto_sredstva_id,p.konto_ispravke_id].filter((id):id is string=>Boolean(id)))}}});
 const hidden=<><input type="hidden" name="ocekivana_firma_id" value={ctx.firmaId}/><input type="hidden" name="ocekivana_godina_id" value={ctx.poslovnaGodinaId}/></>;
 return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Osnovna sredstva</p><h2>Prodaja osnovnog sredstva</h2><p>{asset.inventarski_broj} · {asset.naziv}</p></div><Link href={`/agencija/osnovna-sredstva/${id}`}>Kartica sredstva</Link></header>
 {query?.greska?<p role="alert" className="admin-note">{query.greska}</p>:null}
 {entry?<section className="admin-panel"><h3>Prodajni dokument {entry.customer_invoice_number}</h3><p>Kupac: {entry.kupac.naziv} · Bez PDV-a: {fixedAssetMoney(entry.total_base)} EUR · Ukupno: {fixedAssetMoney(entry.total_gross)} EUR</p><p><Link href={`/agencija/racuni/kif/${entry.kif_book_id}`}>Otvori povezani KIF dokument</Link> · <Link href={`/stampa/osnovna-sredstva/prodaja/${entry.id}`} target="_blank">Štampa prodajnog dokumenta</Link></p>
 {asset.status==="DISPOSED"?<p>Prodaja je potvrđena. Isknjiženje i poreska promjena su evidentirani.</p>:<><p>Proknjižite prodajni dokument kroz KIF i njegov nalog. Zatim potvrdite prodaju: program knjiži isknjiženje sredstva i automatski prenosi prodaju u poresku amortizaciju.</p><form action={confirmFixedAssetSale} className="admin-form">{hidden}<input type="hidden" name="sredstvo_id" value={id}/><input type="hidden" name="verzija" value={asset.verzija}/><input type="hidden" name="kif_entry_id" value={entry.id}/><input type="hidden" name="datum" value={assetDate(entry.invoice_date)}/><label>Konto nabavne vrijednosti<input name="konto_sredstva" required defaultValue={accounts.find(a=>a.id===asset.parametri[0]?.konto_sredstva_id)?.sifra??""}/></label><label>Konto ispravke vrijednosti<input name="konto_ispravke" defaultValue={accounts.find(a=>a.id===asset.parametri[0]?.konto_ispravke_id)?.sifra??""}/></label><label>Konto rashoda neotpisane vrijednosti<input name="konto_rashoda"/></label><button disabled={!canPost||year.zakljucena}>Potvrdi prodaju i isknjiži sredstvo</button></form></>}
 </section>:<section className="admin-panel"><p>Sredstvo je preuzeto sa kartice. Ne bira se artikal i prodaja ne mijenja robni lager.</p><form action={createKifEntry} className="admin-form">{hidden}<input type="hidden" name="os_sredstvo_id" value={id}/><input type="hidden" name="note" value={`Prodaja osnovnog sredstva ${asset.inventarski_broj} – ${asset.naziv}`}/><fieldset disabled={asset.status!=="ACTIVE"||year.zakljucena||!canEdit||!canCreateKif} style={{border:0,padding:0,display:"grid",gap:20}}>
 <PartnerSearchInput name="kupac_id" label="Kupac sredstva" required/>
 <label>Broj prodajnog dokumenta<input name="customer_invoice_number" required/></label><label>Datum prodaje<input type="date" name="invoice_date" required min={assetDate(year.datum_od)} max={assetDate(year.datum_do)}/></label><label>Rok plaćanja<input type="date" name="due_date"/></label>
 <label>KIF knjiga za knjiženje<select name="kif_book_id" required><option value="">Izaberite otvorenu knjigu</option>{books.map(b=><option key={b.id} value={b.id}>{b.internal_kif_number} · mjesec {b.mjesec}</option>)}</select></label>
 <label>Vrsta prometa<select name="vat_transaction_type"><option value="DOMESTIC">Domaći promet</option><option value="EXPORT">Izvoz</option></select></label>
 <label>Konto prihoda od prodaje sredstva<input name="revenue_account_code" required/></label>
 <KifTaxLinesForm initialLines={[]} rates={rates.map(r=>({id:r.id,naziv:r.naziv,procenat:r.procenat.toString()}))}/>
 <button>Pripremi prodaju sredstva</button></fieldset></form></section>}
 </div>;
}
