import "server-only";
import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
export async function jobPositions(agencyId:string,db:Prisma.TransactionClient=prisma) {
 const rows=await db.radnoMjesto.findMany({where:{OR:[{agencija_id:null},{agencija_id:agencyId}]},orderBy:{naziv:"asc"}});
 return rows.filter(r=>!r.globalno_id).map(base=>{
  const override=rows.find(r=>r.globalno_id===base.id&&r.agencija_id===agencyId);
  return {...(override??base),id:base.id,editId:(override??base).id,source:base.agencija_id?"Agencijsko":override?"Prilagođeno":"Globalno",version:override?.updated_at.toISOString()??(base.agencija_id?base.updated_at.toISOString():"")};
 }).sort((a,b)=>a.naziv.localeCompare(b.naziv,"sr-Latn"));
}
