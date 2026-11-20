import "server-only";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { deliveryAllowed,type DeliveryContext } from "./fiscal-delivery-context";
export const deliveryStatuses:Record<string,string>={DRAFT:"Pripremljen prilog",QUEUED:"U redu za slanje",SENDING:"Slanje je u toku",ACCEPTED:"Prihvaćeno od mail servisa",FAILED:"Slanje odbijeno / neuspjelo",UNKNOWN:"Ishod nije potvrđen - provjerite prije ponavljanja",BLOCKED:"Slanje blokirano"};
export function singleEmail(value:string,optional=false) {
  const v=value.trim().toLowerCase();if(optional&&!v)return null;
  if(v.length>254||!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,63}$/i.test(v)||/[\r\n,;<>]/.test(v))throw Error("NEISPRAVAN_EMAIL");return v;
}
export function deliveryScope(c:DeliveryContext){return{agencija_id:c.user.agencija_id!,firma_id:c.firma.id,poslovna_godina_id:c.year.id,povrsina:c.surface};}
export async function authorizedDelivery(c:DeliveryContext,id:string) {
  const row=await prisma.fiskalnaDostava.findFirst({where:{id,...deliveryScope(c)}});if(!row)throw Error("DOSTAVA_NIJE_DOSTUPNA");
  const source=row.izvor as {type:string;channels:string[]};
  if(!await deliveryAllowed(c,source.type==="invoice"?"fiskalna_dostava":"izvjestaji_dostava","create")||!source.channels?.every(ch=>c.channels.includes(ch))||source.type==="report"&&(!await deliveryAllowed(c,"izvjestaji","view")||!await deliveryAllowed(c,"izvjestaji","export")))throw Error("NEMA_PRAVA");
  return row;
}
export async function queueDelivery(c:DeliveryContext,id:string,form:FormData) {
  const row=await authorizedDelivery(c,id);if(row.korisnik_id!==c.user.id||row.status!=="DRAFT"||!row.prilog||row.expires_at<new Date())throw Error("PRILOG_ISTEKAO_ILI_POSLAT");
  const primalac=singleEmail(String(form.get("primalac")??""))!,kopija=singleEmail(String(form.get("kopija")??""),true);
  const naslov=String(form.get("naslov")??"").trim(),poruka=String(form.get("poruka")??"").trim();
  if(!naslov||naslov.length>200||/[\r\n]/.test(naslov)||poruka.length>5000)throw Error("NEISPRAVNA_PORUKA");
  if(form.get("save_contact")==="on"&&!await deliveryAllowed(c,"fiskalni_kontakti","manage"))throw Error("NEMA_PRAVA_KONTAKTA");
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT id FROM firme WHERE id = ${c.firma.id}::uuid FOR UPDATE`;
    if(await tx.fiskalnaDostava.count({where:{firma_id:c.firma.id,queued_at:{gte:new Date(Date.now()-86400000)}}})>=100)throw Error("DNEVNI_LIMIT");
    const changed=await tx.fiskalnaDostava.updateMany({where:{id:row.id,...deliveryScope(c),korisnik_id:c.user.id,status:"DRAFT",expires_at:{gt:new Date()}},data:{status:"QUEUED",primalac,kopija,naslov,poruka,queued_at:new Date(),expires_at:new Date(Date.now()+30*86400000)}});
    if(changed.count!==1)throw Error("DOSTAVA_VEC_POTVRDJENA");
    if(form.get("save_contact")==="on") {
      const key=(row.izvor as {partnerKey?:string}).partnerKey??"FIRMA";
      const naziv=String(form.get("contact_name")??"").trim();if(!naziv||naziv.length>120)throw Error("NAZIV_KONTAKTA");
      if(await tx.fiskalniKontakt.count({where:{firma_id:c.firma.id,is_deleted:false}})>=500)throw Error("LIMIT_KONTAKATA");
      if(form.get("default_contact")==="on")await tx.fiskalniKontakt.updateMany({where:{firma_id:c.firma.id,partner_key:key,is_deleted:false},data:{podrazumijevan:false}});
      const contact=await tx.fiskalniKontakt.create({data:{agencija_id:c.user.agencija_id!,firma_id:c.firma.id,partner_key:key,naziv,email:primalac,podrazumijevan:form.get("default_contact")==="on",created_by:c.user.id,updated_by:c.user.id}});
      await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:"contact_created",tipEntiteta:"FiskalniKontakt",entitetId:contact.id,upisiAktivnost:false});
    }
    await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:"delivery_queued",tipEntiteta:"FiskalnaDostava",entitetId:row.id,novaVrijednost:{primalac,kopija,sha256:row.sha256},upisiAktivnost:false});
  });
}
export async function repeatDelivery(c:DeliveryContext,id:string,acknowledged:boolean) {
  const row=await authorizedDelivery(c,id);
  if(!["ACCEPTED","FAILED","UNKNOWN","BLOCKED"].includes(row.status)||!row.prilog||row.expires_at<new Date()||!acknowledged)throw Error("POTVRDITE_PONOVNO_SLANJE");
  return prisma.$transaction(async tx=>{
    const {id:_id,created_at:_created,updated_at:_updated,...data}=row;void _id;void _created;void _updated;
    const draft=await tx.fiskalnaDostava.create({data:{...data,izvor:row.izvor as object,korisnik_id:c.user.id,status:"DRAFT",message_id:null,greska:null,queued_at:null,started_at:null,accepted_at:null,expires_at:new Date(Date.now()+86400000)}});
    await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:"repeat_prepared",tipEntiteta:"FiskalnaDostava",entitetId:draft.id,novaVrijednost:{prethodna_dostava:row.id,sha256:row.sha256},upisiAktivnost:false});return draft;
  });
}
export async function editDeliveryContact(c:DeliveryContext,id:string,form:FormData) {
  if(!await deliveryAllowed(c,"fiskalni_kontakti","manage"))throw Error("NEMA_PRAVA_KONTAKTA");
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT id FROM firme WHERE id = ${c.firma.id}::uuid FOR UPDATE`;
    const contact=await tx.fiskalniKontakt.findFirst({where:{id,agencija_id:c.user.agencija_id!,firma_id:c.firma.id,is_deleted:false}});if(!contact)throw Error("KONTAKT_NIJE_DOSTUPAN");
    const remove=form.get("remove")==="true";const naziv=String(form.get("naziv")??"").trim();
    if(!remove&&(!naziv||naziv.length>120))throw Error("NAZIV_KONTAKTA");
    const preferred=!remove&&form.get("default_contact")==="on";
    if(preferred)await tx.fiskalniKontakt.updateMany({where:{firma_id:c.firma.id,partner_key:contact.partner_key,is_deleted:false},data:{podrazumijevan:false}});
    const saved=await tx.fiskalniKontakt.update({where:{id},data:remove?{is_deleted:true,deleted_at:new Date(),podrazumijevan:false,updated_by:c.user.id}:{naziv,email:singleEmail(String(form.get("email")??""))!,podrazumijevan:preferred,updated_by:c.user.id}});
    await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:remove?"contact_removed":"contact_updated",tipEntiteta:"FiskalniKontakt",entitetId:id,staraVrijednost:{naziv:contact.naziv,email:contact.email,podrazumijevan:contact.podrazumijevan,is_deleted:false},novaVrijednost:{naziv:saved.naziv,email:saved.email,podrazumijevan:saved.podrazumijevan,is_deleted:saved.is_deleted},upisiAktivnost:false});
  });
}

export async function createDeliveryContact(c:DeliveryContext,form:FormData) {
  if(!await deliveryAllowed(c,"fiskalni_kontakti","manage"))throw Error("NEMA_PRAVA_KONTAKTA");
  const naziv=String(form.get("naziv")??"").trim();if(!naziv||naziv.length>120)throw Error("NAZIV_KONTAKTA");const email=singleEmail(String(form.get("email")??""))!;
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT id FROM firme WHERE id = ${c.firma.id}::uuid FOR UPDATE`;
    if(await tx.fiskalniKontakt.count({where:{firma_id:c.firma.id,is_deleted:false}})>=500)throw Error("LIMIT_KONTAKATA");
    const preferred=form.get("default_contact")==="on";
    if(preferred)await tx.fiskalniKontakt.updateMany({where:{firma_id:c.firma.id,partner_key:"FIRMA",is_deleted:false},data:{podrazumijevan:false}});
    const row=await tx.fiskalniKontakt.create({data:{agencija_id:c.user.agencija_id!,firma_id:c.firma.id,partner_key:"FIRMA",naziv,email,podrazumijevan:preferred,created_by:c.user.id,updated_by:c.user.id}});
    await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalna_dostava",akcija:"contact_created",tipEntiteta:"FiskalniKontakt",entitetId:row.id,upisiAktivnost:false});
  });
}
