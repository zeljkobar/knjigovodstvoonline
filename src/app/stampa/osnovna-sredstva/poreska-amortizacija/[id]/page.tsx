import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { type TaxSnapshot } from "@/lib/fixed-assets-tax-data";
import { TaxReport } from "@/components/fixed-assets/TaxReport";
export default async function TaxPrint({params}:{params:Promise<{id:string}>}) {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),ctx=await readWorkContext(),{id}=await params;
  if(!user.agencija_id||!ctx.firmaId||!ctx.poslovnaGodinaId) notFound();
  await requirePermissionForUser(user,{firmaId:ctx.firmaId,modul:"osnovna_sredstva",akcija:"view"});
  const batch=await prisma.osPoreskiObracun.findFirst({where:{id,agencija_id:user.agencija_id,firma_id:ctx.firmaId,poslovna_godina_id:ctx.poslovnaGodinaId}});
  if(!batch) notFound();
  return <main className="tax-print"><div className="no-print"><PrintButton/></div><TaxReport snapshot={batch.snapshot as unknown as TaxSnapshot} confirmed={batch.status==="CONFIRMED"} revision={batch.revizija}/><style>{`
    .tax-print { background:white; color:#111; padding:24px; font:12px Arial,sans-serif; }
    .tax-print table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:10px; }
    .tax-print td,.tax-print th { border:1px solid #555; padding:5px; overflow-wrap:anywhere; }
    .tax-print th { background:#e7eef2; }
    .tax-print .table-wrap { overflow:visible; }
    .tax-print h2 { font-size:18px; } .tax-print h3 { font-size:13px; }
    @media print { @page {size:A4 landscape; margin:12mm;} .no-print {display:none!important;} .tax-print {padding:0;} .tax-print thead{display:table-header-group;} .tax-print tr{break-inside:avoid;} .tax-input-details {display:none;} }
  `}</style></main>;
}
