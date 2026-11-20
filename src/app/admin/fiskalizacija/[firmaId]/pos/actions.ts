"use server";
import { requireRole } from "@/lib/auth";
import { savePlatformPosSetup,PosSetupError } from "@/lib/platform-pos-setup";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function configurePlatformPos(form:FormData) {
  const admin=await requireRole("admin");
  const value=(key:string)=>String(form.get(key)??"");
  const firmaId=value("firma_id");
  if(!/^[a-f0-9-]{36}$/i.test(firmaId)) throw Error("Neispravna firma.");
  let code="SACUVANO";
  try{await savePlatformPosSetup({actor:{id:admin.id,name:admin.korisnicko_ime,rola:admin.rola},firmaId,enabled:value("enabled")==="true",version:value("version"),registerId:value("register_id"),registerVersion:value("register_version"),unitId:value("unit_id"),deviceId:value("device_id"),operatorId:value("operator_id")});}
  catch(error){code=error instanceof PosSetupError?error.message:"API_GRESKA";}
  for(const path of ["/portal","/portal/pos","/portal/podesavanja","/agencija/pos",`/admin/fiskalizacija/${firmaId}/pristup`]) revalidatePath(path);
  redirect(`/admin/fiskalizacija/${firmaId}/pos?poruka=${code}`);
}
