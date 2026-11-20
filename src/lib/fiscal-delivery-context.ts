import "server-only";
import { requireDirectPortalContext } from "./direct-portal";
import { getAgencyFiscalReportContext } from "./agency-fiscal-report";
import { hasAllPermissions } from "./permissions";
import { rawPrisma } from "./prisma";
export type DeliverySurface="PORTAL"|"AGENCY";
export async function deliveryContext(surface:DeliverySurface) {
  if(surface==="PORTAL") {
    const c=await requireDirectPortalContext(undefined,"/portal/dostava");
    return {...c,surface,channels:[...(c.permissionKeys.has("robno:view")?["OFFICE"]:[]),...(c.permissionKeys.has("pos:view")?["POS"]:[])]};
  }
  const c=await getAgencyFiscalReportContext("export");if(!c)throw Error("NEMA_PRAVA");return{...c,surface};
}
export type DeliveryContext=Awaited<ReturnType<typeof deliveryContext>>;
export const deliveryBase=(surface:DeliverySurface)=>surface==="PORTAL"?"/portal/dostava":"/agencija/fiskalna-dostava";
export async function deliveryAllowed(c:DeliveryContext,module:string,action:"view"|"create"|"manage"|"export") {
  if(c.surface==="PORTAL")return "permissionKeys" in c && c.permissionKeys.has(`${module}:${action}`);
  return hasAllPermissions(c.user,[{firmaId:c.firma.id,modul:module,akcija:action}]);
}
// The worker re-reads the author and tenant. No session cookie or saved grant can authorize a future send.
export async function queuedDeliveryAllowed(job:{agencija_id:string;firma_id:string;poslovna_godina_id:string;korisnik_id:string;povrsina:string;izvor:unknown}) {
  const user=await rawPrisma.korisnik.findFirst({where:{id:job.korisnik_id,agencija_id:job.agencija_id,aktivan:true,is_deleted:false,agencija:{aktivan:true,is_deleted:false}},select:{id:true,agencija_id:true,rola:true,korisnicko_ime:true,tema_paleta:true,tema_rezim:true,agencija:{select:{aktivan:true,is_deleted:true,is_fiscal_direct_container:true}},firme:{select:{firma_id:true}}}});
  const firm=await rawPrisma.firma.findFirst({where:{id:job.firma_id,agencija_id:job.agencija_id,aktivan:true,is_deleted:false}});
  const year=await rawPrisma.poslovnaGodina.findFirst({where:{id:job.poslovna_godina_id,firma_id:job.firma_id}});
  if(!user||!firm||!year)return false;
  const source=job.izvor as {type:string;channels:string[];invoiceId?:string};
  const required=[{modul:source.type==="invoice"?"fiskalna_dostava":"izvjestaji_dostava",akcija:"create" as const},...(source.type==="report"?[{modul:"izvjestaji",akcija:"view" as const},{modul:"izvjestaji",akcija:"export" as const}]:[])];
  if(!Array.isArray(source.channels)||!source.channels.length)return false;
  if(job.povrsina==="PORTAL") {
    const assignment=await rawPrisma.korisnikFirma.findFirst({where:{korisnik_id:user.id,firma_id:firm.id,is_deleted:false,fiscal_portal_enabled:true,AND:[{OR:[{valid_from:null},{valid_from:{lte:new Date()}}]},{OR:[{valid_to:null},{valid_to:{gte:new Date()}}]}]}});
    if(!assignment)return false;const keys=new Set(assignment.fiscal_portal_permissions);
    if(!keys.has("fiskalizacija:view")||!required.every(p=>keys.has(`${p.modul}:${p.akcija}`))||!source.channels.every(ch=>keys.has(`${ch==="POS"?"pos":"robno"}:view`)))return false;
  } else {
    if(!["admin_agencije","korisnik_agencije"].includes(user.rola))return false;
    if(user.rola!=="admin_agencije"&&!await rawPrisma.korisnikFirma.findFirst({where:{korisnik_id:user.id,firma_id:firm.id,is_deleted:false}}))return false;
    if(!await hasAllPermissions(user,[...required,...source.channels.flatMap(ch=>[{modul:ch==="POS"?"pos":"robno",akcija:"view" as const},{modul:ch==="POS"?"pos":"robno",akcija:"export" as const}])].map(p=>({...p,firmaId:firm.id}))))return false;
  }
  if(source.type==="invoice"&&!await rawPrisma.fiskalniIzlazniRacun.findFirst({where:{id:source.invoiceId,agencija_id:job.agencija_id,firma_id:job.firma_id,poslovna_godina_id:job.poslovna_godina_id,is_deleted:false,fiscal_status:{in:["Fiscalized","StornoCreated"]}}}))return false;
  return true;
}
