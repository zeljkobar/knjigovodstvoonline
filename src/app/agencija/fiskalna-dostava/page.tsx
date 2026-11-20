import {FiscalDeliveryPage} from "@/components/FiscalDeliveryPage";
import {deliveryAction} from "./actions";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){return FiscalDeliveryPage({surface:"AGENCY",query:Object.fromEntries(Object.entries(await searchParams).filter((entry):entry is [string,string]=>typeof entry[1]==="string")),action:deliveryAction});}
