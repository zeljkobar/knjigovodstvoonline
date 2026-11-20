import {deliveryContext} from "@/lib/fiscal-delivery-context";
import {invoiceArtifact} from "@/lib/fiscal-delivery-artifact";
import {auditLog} from "@/lib/audit";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const c=await deliveryContext("AGENCY");
 try{const file=await invoiceArtifact(c,(await params).id);await auditLog({korisnikId:c.user.id,agencijaId:c.user.agencija_id!,firmaId:c.firma.id,modul:"fiskalizacija",akcija:"download_pdf",tipEntiteta:"FiskalniIzlazniRacun",entitetId:(await params).id});
 return new Response(new Uint8Array(file.bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${file.name}"`,"Cache-Control":"private, no-store"}});}catch{return new Response("PDF nije dostupan. Provjerite potvrđene fiskalne podatke ili pokušajte kasnije.",{status:409});}
}
