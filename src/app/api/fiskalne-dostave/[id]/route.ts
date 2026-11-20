import {deliveryContext} from "@/lib/fiscal-delivery-context";
import {authorizedDelivery} from "@/lib/fiscal-delivery";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const url=new URL(request.url);const surface=url.searchParams.get("povrsina")==="PORTAL"?"PORTAL":"AGENCY";
 const c=await deliveryContext(surface);
 try{const row=await authorizedDelivery(c,(await params).id);if(!row.prilog||row.expires_at<new Date())return new Response("Prilog nije dostupan.",{status:410});
 return new Response(new Uint8Array(row.prilog),{headers:{"Content-Type":row.mime,"Content-Disposition":`${url.searchParams.get("inline")==="1"&&row.mime==="application/pdf"?"inline":"attachment"}; filename="${row.naziv}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'"}});
 }catch{return new Response("Prilog nije dostupan.",{status:404});}
}
