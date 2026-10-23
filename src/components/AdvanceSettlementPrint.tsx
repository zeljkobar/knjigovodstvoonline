import Image from "next/image";
import QRCode from "qrcode";
import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { fiscalAdminApi } from "@/lib/fiscal-admin-api";
import { settlementState } from "@/lib/advance-invoice";
import { PrintButton } from "./PrintButton";
const money=(value: unknown)=>Number(value??0).toLocaleString("sr-Latn-ME",{minimumFractionDigits:2,maximumFractionDigits:2});
export async function AdvanceSettlementPrint({id,portal=false}:{id:string;portal?:boolean}) {
  let companyId, agencyId, actor;
  if (portal) {
    const ctx=await requireDirectPortalContext({modul:"fiskalizacija",akcija:"view"},`/portal/fakture/${id}`);
    await requirePermissionForUser(ctx.user,{firmaId:ctx.firma.id,modul:"fiskalizacija",akcija:"export"});
    companyId=ctx.firma.id;agencyId=ctx.user.agencija_id;actor={id:ctx.user.id,name:ctx.user.korisnicko_ime};
  } else {
    const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),work=await readWorkContext();
    if (!work.firmaId) notFound();
    await requirePermissionForUser(user,{firmaId:work.firmaId,modul:"fiskalizacija",akcija:"view"});
    await requirePermissionForUser(user,{firmaId:work.firmaId,modul:"fiskalizacija",akcija:"export"});
    companyId=work.firmaId;agencyId=user.agencija_id;actor={id:user.id,name:user.korisnicko_ime};
  }
  if (!companyId || !agencyId) notFound();
  const invoice=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,firma_id:companyId,agencija_id:agencyId,is_deleted:false},include:{avansni_racun:true,firma:{select:{naziv:true,pib:true}}}});
  const state=settlementState(invoice?.avans_umanjenje);
  if (!invoice || !state?.remoteId) notFound();
  const remote=(await fiscalAdminApi.getInvoice(state.remoteId,actor)).data;
  const items=(remote.items??[]) as Array<{name:string;quantity:number;vatRate:number;unitPrice:number}>;
  const final=remote.status==="Fiscalized"&&remote.jikr&&remote.iic&&remote.qrCodeData;
  const qr=final?await QRCode.toDataURL(remote.qrCodeData!,{errorCorrectionLevel:"M",margin:1}):null;
  const issuer=(invoice.issuer_snapshot??{}) as Record<string,string>;
  const buyer=(invoice.buyer_snapshot??{}) as Record<string,string>;
  return <main className="print-page"><div className="print-toolbar"><PrintButton/></div><article className="invoice-print-document"><header><h1>{issuer.naziv??invoice.firma.naziv}</h1><p>PIB: {issuer.pib??invoice.firma.pib}</p><h2>Umanjenje avansnog računa</h2><strong>{remote.officialInvoiceNumber??"NACRT — NIJE FISKALIZOVANO"}</strong><p>Kupac: {buyer.naziv??buyer.name??""} · {buyer.pib??""}</p><p>Avans: {invoice.avansni_racun?.official_invoice_number} · IKOF {invoice.avansni_racun?.iic}</p><p>Konačni račun: {invoice.official_invoice_number} · IKOF {invoice.iic}</p><p>Okruženje: {invoice.fiscal_environment} · Status: {remote.status}</p></header><table><thead><tr><th>Stavka</th><th>Količina</th><th>Cijena sa PDV</th><th>PDV stopa</th></tr></thead><tbody>{items.map((item,index)=><tr key={index}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{item.vatRate}%</td></tr>)}</tbody></table><p>Osnovica: {money(remote.totalNetAmount)} € · PDV: {money(remote.totalVatAmount)} € · Ukupno: <strong>{money(remote.totalGrossAmount)} €</strong></p><p>Umanjenje avansa nije nova bankovna isplata kupcu.</p>{final?<><p>IKOF: {remote.iic}</p><p>JIKR: {remote.jikr}</p>{qr?<Image src={qr} width={130} height={130} alt="QR provjera umanjenja" unoptimized/>:null}</>:<p>NACRT — dokument još nema potvrđenu fiskalizaciju.</p>}</article></main>;
}
