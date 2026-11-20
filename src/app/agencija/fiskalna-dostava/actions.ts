"use server";
import {handleDeliveryAction} from "@/lib/fiscal-delivery-actions";
export async function deliveryAction(form:FormData){return handleDeliveryAction("AGENCY",form);}
