import "server-only";
import { createHash } from "crypto";
import { prisma } from "./prisma";
import { deliveryAllowed,type DeliveryContext } from "./fiscal-delivery-context";
import { parseDirectPortalReportFilters,parseDirectPortalReportKind } from "./direct-portal-reports";
import { loadBoundedFiscalExport } from "./fiscal-export-data";
import { fiscalReportPdf } from "./fiscal-pdf";
import { fiscalReportWorkbook } from "./fiscal-report-xlsx";
import { fiscalInvoicePdf } from "./fiscal-invoice-pdf";
import { auditLogInTransaction } from "./audit";
export async function invoiceArtifact(c:DeliveryContext,id:string) {
  const local=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,agencija_id:c.user.agencija_id!,firma_id:c.firma.id,poslovna_godina_id:c.year.id,is_deleted:false,status:"FINALIZED",fiscal_status:{in:["Fiscalized","StornoCreated"]},sales_channel:{in:c.channels}},include:{firma:{include:{fiscalCompanyLink:true}}}});
  if(!local)throw Error("RACUN_NIJE_DOSTUPAN");
  if(!await deliveryAllowed(c,local.sales_channel==="POS"?"pos":"fiskalizacija","view"))throw Error("NEMA_PRAVA");
  const result=await fiscalInvoicePdf(local,{id:c.user.id,name:c.user.korisnicko_ime});
  return{bytes:result.bytes,title:result.title,name:`racun-${local.id}.pdf`,mime:"application/pdf",source:{type:"invoice",invoiceId:local.id,channels:[local.sales_channel],partnerKey:local.kupac_id??"FIRMA"}};
}
export async function reportArtifact(c:DeliveryContext,params:Record<string,string>,format:string) {
  if(!await deliveryAllowed(c,"izvjestaji","view")||!await deliveryAllowed(c,"izvjestaji","export"))throw Error("NEMA_PRAVA_IZVOZA");
  const kind=parseDirectPortalReportKind(params.tip);if(!kind||!["pdf","xlsx"].includes(format))throw Error("NEISPRAVAN_IZVJESTAJ");
  const filters=parseDirectPortalReportFilters(params,c.year);if(filters.invalidPeriod)throw Error("NEISPRAVAN_PERIOD");
  if(c.channels.length===1)filters.salesChannel=c.channels[0];
  const report=await loadBoundedFiscalExport(c,filters,kind);if(!report)throw Error("IZVOZ_PREVELIK");
  const at=new Date();const bytes=format==="pdf"?await fiscalReportPdf(report,c.firma,at,kind):fiscalReportWorkbook(report,c.firma,at,kind);
  return{bytes,title:`Izvještaj ${kind} · ${filters.periodFrom} - ${filters.periodTo}`,name:`izvjestaj-${kind}-${filters.periodFrom}-${filters.periodTo}.${format}`,mime:format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",source:{type:"report",filters:{...params,kanal:filters.salesChannel},kind,generatedAt:at.toISOString(),channels:filters.salesChannel?[filters.salesChannel]:c.channels,partnerKey:"FIRMA"}};
}
export async function prepareDelivery(c:DeliveryContext,params:Record<string,string>,format:string) {
  const type=params.racun?"invoice":"report";
  if(!await deliveryAllowed(c,type==="invoice"?"fiskalna_dostava":"izvjestaji_dostava","create"))throw Error("NEMA_PRAVA_SLANJA");
  // The UI uses POST to prepare, never GET. Limit drafts before expensive PDF rendering.
  if(await prisma.fiskalnaDostava.count({where:{firma_id:c.firma.id,status:{in:["DRAFT","QUEUED"]},created_at:{gte:new Date(Date.now()-86400000)}}})>=100)throw Error("DNEVNI_LIMIT");
  const a=type==="invoice"?await invoiceArtifact(c,params.racun):await reportArtifact(c,params,format);
  if(a.bytes.length>10485760)throw Error("PRILOG_PREVELIK");
  return prisma.$transaction(async tx=>{
    const draft=await tx.fiskalnaDostava.create({data:{agencija_id:c.user.agencija_id!,firma_id:c.firma.id,poslovna_godina_id:c.year.id,korisnik_id:c.user.id,povrsina:c.surface,izvor:a.source,naziv:a.name,mime:a.mime,prilog:new Uint8Array(a.bytes),sha256:createHash("sha256").update(a.bytes).digest("hex"),velicina:a.bytes.length,expires_at:new Date(Date.now()+86400000)}});
    await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:"attachment_prepared",tipEntiteta:"FiskalnaDostava",entitetId:draft.id,novaVrijednost:{sha256:draft.sha256,naziv:draft.naziv},upisiAktivnost:false});return draft;
  });
}
