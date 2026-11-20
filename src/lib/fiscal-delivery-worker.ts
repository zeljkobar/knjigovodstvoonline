import "server-only";
import nodemailer from "nodemailer";
import { createHash } from "crypto";
import { rawPrisma as db } from "./prisma";
import { queuedDeliveryAllowed } from "./fiscal-delivery-context";
import { SYSTEM_EMAIL_FROM } from "./email";
import { auditLogInTransaction } from "./audit";
export function fiscalMailConfigured(){return process.env.FISCAL_MAIL_ENABLED==="true"&&["SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASS"].every(k=>Boolean(process.env[k]));}
async function finish(job:{id:string;korisnik_id:string;agencija_id:string;firma_id:string},status:string,messageId?:string,reason?:string) {
  await db.$transaction(async tx=>{
    const changed=await tx.fiskalnaDostava.updateMany({where:{id:job.id,status:"SENDING"},data:{status,message_id:messageId??null,accepted_at:status==="ACCEPTED"?new Date():null,greska:status==="ACCEPTED"?null:reason??status}});
    if(changed.count)await auditLogInTransaction(tx,{korisnikId:job.korisnik_id,agencijaId:job.agencija_id,firmaId:job.firma_id,modul:"fiskalna_dostava",akcija:`delivery_${status.toLowerCase()}`,tipEntiteta:"FiskalnaDostava",entitetId:job.id,staraVrijednost:{status:"SENDING"},novaVrijednost:{status,message_id:messageId??null},upisiAktivnost:false});
  });
}
export async function runFiscalDeliveryOnce() {
  // A lost process/SMTP acknowledgement is ambiguous. Never automatically send it again.
  const stale=await db.fiskalnaDostava.findMany({where:{status:"SENDING",started_at:{lt:new Date(Date.now()-10*60000)}},select:{id:true,korisnik_id:true,agencija_id:true,firma_id:true},take:25});
  for(const lost of stale)await finish(lost,"UNKNOWN",undefined,"PROCESS_INTERRUPTED");
  await db.fiskalnaDostava.updateMany({where:{prilog:{not:null},expires_at:{lt:new Date()},status:{notIn:["SENDING"]}},data:{prilog:null}});
  if(!fiscalMailConfigured())return;
  const job=await db.$transaction(async tx=>{
    const candidate=await tx.fiskalnaDostava.findFirst({where:{status:"QUEUED"},orderBy:{queued_at:"asc"}});if(!candidate)return null;
    const claimed=await tx.fiskalnaDostava.updateMany({where:{id:candidate.id,status:"QUEUED"},data:{status:"SENDING",started_at:new Date()}});return claimed.count?candidate:null;
  });
  if(!job)return;
  if(!job.prilog||job.expires_at<new Date()||createHash("sha256").update(job.prilog).digest("hex")!==job.sha256||!await queuedDeliveryAllowed(job)){await finish(job,"BLOCKED");return;}
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT),secure:process.env.SMTP_SECURE==="true",requireTLS:process.env.SMTP_SECURE!=="true",tls:{minVersion:"TLSv1.2"},auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:60000,disableFileAccess:true,disableUrlAccess:true});
  try {
    const result=await transport.sendMail({from:SYSTEM_EMAIL_FROM,to:job.primalac!,cc:job.kopija||undefined,subject:job.naslov!,text:job.poruka!,messageId:`<fiscal-${job.id}@summasummarum.me>`,attachments:[{filename:job.naziv,content:Buffer.from(job.prilog),contentType:job.mime}],disableFileAccess:true,disableUrlAccess:true});
    await finish(job,result.rejected?.length?"UNKNOWN":"ACCEPTED",String(result.messageId),result.rejected?.length?"PARTIAL_ACCEPTANCE":undefined);
  } catch(error) {
    const e=error as {code?:string;responseCode?:number};
    await finish(job,(e.responseCode&&e.responseCode>=400)||["EAUTH","EENVELOPE","ECONNECTION","EDNS"].includes(e.code??"")?"FAILED":"UNKNOWN",undefined,e.responseCode?`SMTP_${e.responseCode}`:["EAUTH","EENVELOPE","ECONNECTION","EDNS"].includes(e.code??"")?e.code:"SMTP_UNCONFIRMED");
  } finally {transport.close();}
}
export function startFiscalDeliveryWorker() {
  const state=globalThis as typeof globalThis & {fiscalDeliveryTimer?:ReturnType<typeof setInterval>;fiscalDeliveryBusy?:boolean};if(state.fiscalDeliveryTimer)return;
  const tick=async()=>{if(state.fiscalDeliveryBusy)return;state.fiscalDeliveryBusy=true;try{await runFiscalDeliveryOnce();}catch{console.error("Obrada fiskalne dostave trenutno nije dostupna.");}finally{state.fiscalDeliveryBusy=false;}};
  state.fiscalDeliveryTimer=setInterval(()=>{void tick();},15000);state.fiscalDeliveryTimer.unref();void tick();
}
