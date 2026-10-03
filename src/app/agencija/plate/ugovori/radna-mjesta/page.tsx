import {requireRole} from "@/lib/auth";
import {jobPositions} from "@/lib/job-positions";
import {JobPositionList} from "@/app/admin/radna-mjesta/JobPositionList";
export default async function JobsPage({searchParams}:{searchParams?:Promise<{poruka?:string}>}) {
 const user=await requireRole("admin_agencije");
 const rows=user.agencija_id?await jobPositions(user.agencija_id):[];
 return <div className="admin-stack"><header className="admin-header"><div><h1>Radna mjesta agencije</h1><p className="muted-text">Dodajte svoje radno mjesto ili prilagodite globalno. Izmjene važe samo za vašu agenciju.</p></div></header><JobPositionList rows={rows} message={(await searchParams)?.poruka}/></div>;
}
