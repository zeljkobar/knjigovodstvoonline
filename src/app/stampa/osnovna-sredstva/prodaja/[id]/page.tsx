import {notFound} from "next/navigation";
import {requireAnyRole} from "@/lib/auth";
import {requirePermissionForUser} from "@/lib/permissions";
import {readWorkContext} from "@/lib/work-context";
import {prisma} from "@/lib/prisma";
import {fixedAssetMoney} from "@/lib/fixed-assets";
import {PrintButton} from "@/components/PrintButton";
export default async function SalePrint({params}:{params:Promise<{id:string}>}){
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),ctx=await readWorkContext(),{id}=await params;if(!user.agencija_id||!ctx.firmaId||!ctx.poslovnaGodinaId)notFound();
 await requirePermissionForUser(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"view"});
 const entry=await prisma.kifEntry.findFirst({where:{id,agencija_id:user.agencija_id,firma_id:ctx.firmaId,poslovna_godina_id:ctx.poslovnaGodinaId,source_type:"FIXED_ASSET_SALE",is_deleted:false},include:{firma:true,kupac:true,tax_lines:true}});if(!entry||!entry.source_id)notFound();
 const asset=await prisma.osnovnoSredstvo.findFirst({where:{id:entry.source_id,agencija_id:user.agencija_id,firma_id:ctx.firmaId,is_deleted:false}});if(!asset)notFound();
 return <main className="print-page"><PrintButton/><h1>Prodaja osnovnog sredstva</h1><h2>{entry.customer_invoice_number}</h2><p>Prodavac: {entry.firma.naziv} · PIB {entry.firma.pib}<br/>Kupac: {entry.kupac.naziv} · PIB {entry.kupac.pib}</p><p>Datum: {entry.invoice_date.toLocaleDateString("sr-Latn-ME",{timeZone:"UTC"})} · Rok plaćanja: {entry.due_date?.toLocaleDateString("sr-Latn-ME",{timeZone:"UTC"})??"—"}</p><table><thead><tr><th>Inventarski broj</th><th>Osnovno sredstvo</th><th>Količina</th><th>Bez PDV-a</th></tr></thead><tbody><tr><td>{asset.inventarski_broj}</td><td>{asset.naziv}</td><td>1</td><td>{fixedAssetMoney(entry.total_base)} EUR</td></tr></tbody></table><p>PDV: {fixedAssetMoney(entry.total_output_vat)} EUR</p><h3>Za plaćanje: {fixedAssetMoney(entry.total_gross)} EUR</h3>{entry.tax_lines.map(line=><p key={line.id}>{line.vat_rate_name} ({line.vat_rate_percent.toString()}%): osnovica {fixedAssetMoney(line.tax_base)}, PDV {fixedAssetMoney(line.output_vat_amount)}</p>)}<p>{entry.note}</p><p>Dokument evidentiran u KIF-u: {entry.internal_kif_number}.</p></main>;
}
