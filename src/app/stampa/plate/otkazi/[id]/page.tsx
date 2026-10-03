import {notFound} from "next/navigation";
import {requireAnyRole} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {hasPermission} from "@/lib/permissions";
import {PrintButton} from "@/components/PrintButton";
import "../../ugovori/[id]/print.css";
export default async function PrintTermination({params}:{params:Promise<{id:string}>}) {
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),{id}=await params;
 if(!user.agencija_id||!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const contract=await prisma.otkazORadu.findFirst({where:{id,agencija_id:user.agencija_id,firma:{is_deleted:false,aktivan:true,...(user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:user.id,is_deleted:false}}})}}});
 if(!contract||!await hasPermission(user,{firmaId:contract.firma_id,modul:"plate",akcija:"view"}))notFound();
 const snapshot=contract.snapshot as {html?:string};
 if(!snapshot.html)notFound();
 return <main className="employment-print"><div className="employment-toolbar"><PrintButton/></div><div dangerouslySetInnerHTML={{__html:snapshot.html}}/></main>;
}
