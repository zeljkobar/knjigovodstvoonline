import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser, hasPermission } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { automaticTaxEvents, isAutomaticTaxEvent } from "@/lib/fixed-assets-tax-events";
import { initialTaxInput, taxAssets } from "@/lib/fixed-assets-tax-data";
import { type TaxInput } from "@/lib/fixed-assets-tax";
import { assetDate } from "@/lib/fixed-assets-batches";
import { fixedAssetMoney } from "@/lib/fixed-assets";
import { TaxInputsForm } from "@/components/fixed-assets/TaxInputsForm";
import { calculateTaxDepreciation, carryTaxOpening, undoTaxCarry } from "./actions";
export default async function TaxPage({ searchParams }: { searchParams?: Promise<{ greska?: string; sacuvano?: string }> }) {
  const user = await requireAnyRole(["admin_agencije","korisnik_agencije"]), ctx = await readWorkContext(), query=await searchParams;
  if (!user.agencija_id || !ctx.firmaId || !ctx.poslovnaGodinaId) return <p>Izaberite firmu i poslovnu godinu.</p>;
  await requirePermissionForUser(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"view"});
  const scope={agencija_id:user.agencija_id,firma_id:ctx.firmaId,poslovna_godina_id:ctx.poslovnaGodinaId};
  const year=await prisma.poslovnaGodina.findFirst({where:{id:ctx.poslovnaGodinaId,firma_id:ctx.firmaId,firma:{agencija_id:user.agencija_id,is_deleted:false}},include:{firma:true}});
  if (!year) return <p>Godina nije dostupna.</p>;
  const [stored,assets,batches,canEdit,canCreate,canDelete] = await Promise.all([
    prisma.osPoreskaGodina.findFirst({where:scope}), taxAssets(prisma,scope,year.datum_od,year.datum_do),
    prisma.osPoreskiObracun.findMany({where:scope,orderBy:{revizija:"desc"}}),
    hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"update"}),hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"create"}),
    hasPermission(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"delete"})
  ]);
  const input=stored?.ulazi as unknown as TaxInput | undefined, initial=initialTaxInput(assets);
  const merged: TaxInput=input?{...input,assets:initial.assets.map(a=>input.assets.find(old=>old.id===a.id)??a)}:initial;
  const automatic=await automaticTaxEvents(prisma,scope,merged,year.datum_od,year.datum_do);
  for(const row of merged.assets) if(!row.source)row.source=automatic.events.find(e=>e.kind==="PURCHASE"&&e.origin.assetId===row.id)?.source??"";
  merged.events=merged.events.filter(e=>!isAutomaticTaxEvent(e));
  const locked=year.zakljucena || batches.some(b=>b.status==="CONFIRMED");
  const hidden=<><input type="hidden" name="ocekivana_firma_id" value={ctx.firmaId}/><input type="hidden" name="ocekivana_godina_id" value={ctx.poslovnaGodinaId}/><input type="hidden" name="verzija" value={stored?.verzija??0}/></>;
  return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Osnovna sredstva</p><h2>Poreska amortizacija</h2><p>{year.firma.naziv} · {year.godina}</p></div></header>
    {query?.greska?<p role="alert" className="admin-note">{query.greska}</p>:null}{query?.sacuvano?<p role="status">Poreski podaci su sačuvani.</p>:null}
    {locked?<p className="admin-note">Podaci su zaključani zbog potvrđenog poreskog obračuna ili zaključane poslovne godine.</p>:null}
    <section className="admin-panel"><h3>Godišnji obračun</h3><p>{year.datum_od.toLocaleDateString("sr-Latn-ME",{timeZone:"UTC"})} – {year.datum_do.toLocaleDateString("sr-Latn-ME",{timeZone:"UTC"})}. Obračun koristi sačuvana poreska stanja i promjene. Potvrda ne pravi nalog glavne knjige.</p>
    <form action={calculateTaxDepreciation}>{hidden}<button disabled={locked||!stored||!canCreate}>Obračunaj poresku amortizaciju</button></form>
    {!stored?<form action={carryTaxOpening} style={{marginTop:12}}>{hidden}<button className="button-secondary" disabled={locked||!canEdit}>Prenesi iz potvrđenog obračuna prethodne godine</button></form>:null}
    </section>
    <section className="admin-panel"><h3>Pregledi obračuna</h3><div className="table-wrap"><table><thead><tr><th>Revizija</th><th>Datum</th><th>Status</th><th>Redovna amortizacija</th><th/></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td>{b.revizija}</td><td>{b.created_at.toLocaleString("sr-Latn-ME")}</td><td>{b.status==="CONFIRMED"?"Potvrđen":"Nacrt"}</td><td>{fixedAssetMoney(b.ukupna_amortizacija)}</td><td><Link href={`/agencija/osnovna-sredstva/poreska-amortizacija/${b.id}`}>Otvori OA pregled</Link></td></tr>)}{!batches.length?<tr><td colSpan={5}>Još nema sačuvanih poreskih obračuna.</td></tr>:null}</tbody></table></div></section>
    {stored?.prethodni_obracun_id && !locked && canDelete ? <section className="admin-panel"><h3>Poništi poreski prenos</h3><p>Poništavanje briše sačuvana poreska stanja i ručno unesene promjene ove godine. Prethodni obračun ostaje sačuvan i može se korigovati. Nakon korekcije ponovite prenos; automatske nabavke i prodaje ponovo će se preuzeti.</p><p>Prvo izbrišite sve nacrte obračuna ove godine.</p><form action={undoTaxCarry} className="admin-form">{hidden}<input type="hidden" name="poreska_godina_id" value={stored.id}/><label>Razlog poništavanja<input name="razlog" minLength={3} required/></label><label className="checkbox-row"><input type="checkbox" name="potvrda" value="DA" required/><span>Potvrđujem brisanje poreskih stanja i ručnih promjena ove godine.</span></label><button className="danger-button" disabled={batches.length > 0}>Poništi poreski prenos</button></form></section> : null}
    <section className="admin-panel"><TaxInputsForm key={stored?.verzija??0} input={merged} automaticEvents={automatic.events} automaticErrors={automatic.errors} assets={assets} companyId={ctx.firmaId} yearId={ctx.poslovnaGodinaId} version={stored?.verzija??0} locked={locked||!canEdit} from={assetDate(year.datum_od)} to={assetDate(year.datum_do)} carried={Boolean(stored?.prethodni_obracun_id)}/></section>
  </div>;
}
