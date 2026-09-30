import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { type TaxSnapshot } from "@/lib/fixed-assets-tax-data";
import { TaxReport } from "@/components/fixed-assets/TaxReport";
import { confirmTaxDepreciation, deleteTaxDepreciationDraft, reopenTaxDepreciation } from "../actions";
export default async function TaxDetail({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<{greska?:string}>}) {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),ctx=await readWorkContext(),{id}=await params,query=await searchParams;
  if(!user.agencija_id||!ctx.firmaId||!ctx.poslovnaGodinaId) notFound();
  await requirePermissionForUser(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"view"});
  const batch=await prisma.osPoreskiObracun.findFirst({where:{id,agencija_id:user.agencija_id,firma_id:ctx.firmaId,poslovna_godina_id:ctx.poslovnaGodinaId},include:{poslovna_godina:true}});
  if(!batch) notFound();
  const snapshot=batch.snapshot as unknown as TaxSnapshot;
  const [canPost,canDelete]=await Promise.all([
    hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"post"}),
    hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"delete"})
  ]);
  const hidden=<><input type="hidden" name="ocekivana_firma_id" value={ctx.firmaId}/><input type="hidden" name="ocekivana_godina_id" value={ctx.poslovnaGodinaId}/><input type="hidden" name="obracun_id" value={id}/></>;
  return <div className="admin-stack"><section className="admin-panel"><Link href="/agencija/osnovna-sredstva/poreska-amortizacija">← Poreska stanja i pregledi</Link><p><Link href={`/stampa/osnovna-sredstva/poreska-amortizacija/${id}`} target="_blank">Štampaj {batch.status==="CONFIRMED"?"OA obrazac":"nacrt OA"}</Link></p>
  {query?.greska?<p className="admin-note" role="alert">{query.greska}</p>:null}
  {batch.status!=="CONFIRMED"?<form action={confirmTaxDepreciation}>{hidden}<button disabled={!canPost||batch.poslovna_godina.zakljucena||snapshot.result.errors.length>0}>Potvrdi poreski obračun</button><p>Potvrda zaključava poreska stanja ove godine i omogućava njihov prenos. Ne knjiži nalog glavne knjige.</p></form>:null}</section>
  {!batch.poslovna_godina.zakljucena&&batch.status==="CONFIRMED"&&canPost?<section className="admin-panel"><h3>Ispravka potvrđenog obračuna</h3><p className="muted-text">Vraćanje otključava poreska stanja. Nije dozvoljeno ako je obračun prenesen ili postoji potvrđen obračun kasnije godine.</p><form action={reopenTaxDepreciation} className="admin-form">{hidden}<label>Razlog vraćanja u nacrt<input name="razlog_vracanja" minLength={3} required/></label><label className="checkbox-row"><input name="potvrda_vracanja" type="checkbox" value="DA" required/><span>Potvrđujem vraćanje poreskog obračuna u nacrt.</span></label><button className="danger-button" type="submit">Vrati u nacrt</button></form></section>:null}
  {!batch.poslovna_godina.zakljucena&&batch.status==="DRAFT"&&canDelete?<section className="admin-panel"><h3>Brisanje nacrta</h3><p className="muted-text">Ova revizija poreskog obračuna biće trajno izbrisana. Sačuvana poreska stanja ostaju dostupna za novi obračun.</p><form action={deleteTaxDepreciationDraft} className="admin-form">{hidden}<label>Razlog brisanja<input name="razlog_brisanja" minLength={3} required/></label><label className="checkbox-row"><input name="potvrda_brisanja" type="checkbox" value="DA" required/><span>Potvrđujem trajno brisanje nacrta poreskog obračuna.</span></label><button className="danger-button" type="submit">Izbriši nacrt</button></form></section>:null}
  <section className="admin-panel"><TaxReport snapshot={snapshot} confirmed={batch.status==="CONFIRMED"} revision={batch.revizija}/></section></div>;
}
