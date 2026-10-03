"use client";
import {useState} from "react";
import {workSchedules,getWorkSchedule} from "@/lib/employment-options";
type Props={jobs:{id:string;naziv:string;opis_poslova:string;aktivno:boolean}[];employee?:{jobId:string;jobName:string;address:string;location:string;type:string;end:string;schedule:string;percentage:string;monthly:string}};
export function EmploymentFields({jobs,employee}:Props) {
 const [schedule,setSchedule]=useState(employee?(getWorkSchedule(employee.schedule)?employee.schedule:"LEGACY"):"PUNO_8");
 const [monthly,setMonthly]=useState(employee?.monthly??"");
 const [type,setType]=useState(employee?.type??"");
 const [jobId,setJobId]=useState(employee?.jobId??"");
 const selected=jobs.find(j=>j.id===jobId);
 return <>
  <label><span>Adresa zaposlenog</span><input name="adresa" defaultValue={employee?.address??""}/></label>
  <label><span>Radno mjesto</span><select name="radno_mjesto_id" value={jobId} onChange={e=>setJobId(e.target.value)}><option value="">{employee?.jobName?`Postojeći unos: ${employee.jobName}`:"Izaberite radno mjesto"}</option>{jobs.filter(j=>j.aktivno||j.id===employee?.jobId).map(j=><option key={j.id} value={j.id}>{j.naziv}{!j.aktivno?" (neaktivno)":""}</option>)}</select></label>
  <label><span>Mjesto obavljanja rada</span><input name="mjesto_rada" defaultValue={employee?.location??""} placeholder="Mjesto i adresa rada"/></label>
  {selected?<p className="form-wide muted-text">Opis poslova: {selected.opis_poslova}</p>:null}
  <label><span>Trajanje ugovora</span><select name="tip_ugovora" value={type} onChange={e=>setType(e.target.value)}><option value="">Nije podešeno</option><option value="ODREDJENO">Na određeno vrijeme</option><option value="NEODREDJENO">Na neodređeno vrijeme</option></select></label>
  <label><span>Ugovoreni datum isteka</span><input key={type} name="ugovoreni_istek" type="date" disabled={type!=="ODREDJENO"} required={type==="ODREDJENO"} defaultValue={type==="ODREDJENO"?employee?.end??"":""}/></label>
  <label><span>Radno vrijeme</span><select name="vrsta_radnog_vremena" value={schedule} onChange={e=>{setSchedule(e.target.value);setMonthly("");}}>{employee&&!getWorkSchedule(employee.schedule)?<option value="LEGACY">Postojeći procenat — {employee.percentage}%</option>:null}{Object.entries(workSchedules).map(([key,v])=><option key={key} value={key}>{v.label} ({v.percentage}%)</option>)}</select></label>
  <label><span>Mjesečni sati (opciono)</span><input name="mjesecni_sati" type="number" min="1" max="744" value={monthly} onChange={e=>setMonthly(e.target.value)} placeholder="Automatski: fond mjeseca × procenat"/></label>
  <p className="form-wide muted-text">Izbor radnog vremena određuje procenat za obračun i sate u ugovoru. Ručno unijeti mjesečni sati imaju prednost u obračunu; promjena radnog vremena prazni ovo polje.</p>
 </>;
}
