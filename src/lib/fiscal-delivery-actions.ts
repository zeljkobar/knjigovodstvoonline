import "server-only";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {deliveryContext,deliveryBase,type DeliverySurface} from "./fiscal-delivery-context";
import {prepareDelivery} from "./fiscal-delivery-artifact";
import {queueDelivery,repeatDelivery,editDeliveryContact,createDeliveryContact} from "./fiscal-delivery";
import {fiscalMailConfigured} from "./fiscal-delivery-worker";
export async function handleDeliveryAction(surface:DeliverySurface,form:FormData) {
  const c=await deliveryContext(surface);const base=deliveryBase(surface);const op=String(form.get("op")??"");const id=String(form.get("id")??"");let destination=base;
  try {
    if(op==="prepare") {
      const params:Record<string,string>={};for(const [k,v]of form.entries())if(typeof v==="string"&&["racun","tip","od","do","kanal","kupac","kasa","okruzenje","artikal","artikal_id","grupa","placanje"].includes(k)){if(v.length>200)throw Error("NEISPRAVAN_ZAHTJEV");params[k]=v;}
      const draft=await prepareDelivery(c,params,String(form.get("format")??"pdf"));destination=`${base}?dostava=${draft.id}`;
    } else if(op==="queue") {
      if(!fiscalMailConfigured())throw Error("MAIL_NIJE_PODESEN");
      await queueDelivery(c,id,form);destination=`${base}?dostava=${id}&poruka=U_REDU`;
    } else if(op==="repeat") {
      const draft=await repeatDelivery(c,id,form.get("acknowledge")==="on");destination=`${base}?dostava=${draft.id}`;
    } else if(op==="new_contact"){await createDeliveryContact(c,form);destination=`${base}?poruka=KONTAKT_SACUVAN`;} else if(op==="contact") {await editDeliveryContact(c,id,form);destination=`${base}?poruka=KONTAKT_SACUVAN`;}else throw Error("NEISPRAVAN_ZAHTJEV");
  } catch(error) {
    const message=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:"DOSTAVA_GRESKA";
    destination=`${base}?poruka=${encodeURIComponent(message)}`;
  }
  revalidatePath(base);redirect(destination);
}
