import {requireRole} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {JobPositionList} from "./JobPositionList";
export default async function JobsPage({searchParams}:{searchParams?:Promise<{poruka?:string}>}) {
 await requireRole("admin");
 const rows=await prisma.radnoMjesto.findMany({where:{agencija_id:null},orderBy:{naziv:"asc"}});
 return <div className="admin-stack"><header className="admin-header"><div><h1>Globalna radna mjesta</h1><p className="muted-text">Nazivi i opisi dostupni svim agencijama. Agencije mogu sačuvati svoje verzije.</p></div></header><JobPositionList rows={rows.map(r=>({...r,version:r.updated_at.toISOString(),source:"Globalno"}))} message={(await searchParams)?.poruka}/></div>;
}
