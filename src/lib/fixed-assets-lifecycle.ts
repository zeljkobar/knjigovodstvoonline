import { Prisma } from "@prisma/client";
import { type AssetBatchScope } from "./fixed-assets-batches";
export async function lockAssetLifecycle(tx:Prisma.TransactionClient,scope:AssetBatchScope,assetId:string,date:Date) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM firme WHERE id=${scope.firma_id}::uuid AND agencija_id=${scope.agencija_id}::uuid FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM poslovne_godine WHERE id=${scope.poslovna_godina_id}::uuid AND firma_id=${scope.firma_id}::uuid FOR UPDATE`);
  const year=await tx.poslovnaGodina.findFirst({where:{id:scope.poslovna_godina_id,firma_id:scope.firma_id,firma:{agencija_id:scope.agencija_id,is_deleted:false,aktivan:true}}});
  if(!year||year.zakljucena||date<year.datum_od||date>year.datum_do)throw new Error("Datum mora pripadati aktivnoj otvorenoj godini.");
  const periods=await tx.$queryRaw<{status:string}[]>(Prisma.sql`SELECT status FROM pdv_periodi WHERE firma_id=${scope.firma_id}::uuid AND datum_do>=${date} AND datum_od<=${year.datum_do} ORDER BY datum_od FOR UPDATE`);
  if(periods.some(p=>p.status==="LOCKED"))throw new Error("Promjena obuhvata zaključan PDV period.");
  if(await tx.osPoreskiObracun.findFirst({where:{agencija_id:scope.agencija_id,firma_id:scope.firma_id,status:"CONFIRMED",poslovna_godina:{datum_do:{gte:date}}}}))throw new Error("Postoji potvrđen poreski obračun ove ili kasnije godine. Potrebna je njegova kontrolisana korekcija.");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM osnovna_sredstva WHERE id=${assetId}::uuid AND firma_id=${scope.firma_id}::uuid FOR UPDATE`);
  const asset=await tx.osnovnoSredstvo.findFirst({where:{id:assetId,agencija_id:scope.agencija_id,firma_id:scope.firma_id,is_deleted:false},include:{parametri:{orderBy:{vazi_od:"desc"}},promjene:{where:{is_deleted:false},orderBy:{datum:"asc"}}}});
  if(!asset)throw new Error("Sredstvo nije pronađeno.");
  return {year,asset};
}
