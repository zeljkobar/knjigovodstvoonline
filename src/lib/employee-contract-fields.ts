import "server-only";
import type {PlateRadnik,Prisma} from "@prisma/client";
import {getWorkSchedule,strictEmploymentDate} from "./employment-options";
import {jobPositions} from "./job-positions";
export async function employeeContractFields(form:FormData,agencyId:string,tx:Prisma.TransactionClient,previous?:PlateRadnik) {
 const text=(key:string)=>String(form.get(key)??"").trim();
 const key=text("vrsta_radnog_vremena");
 const schedule=getWorkSchedule(key);
 const legacy=key==="LEGACY"&&previous&&!getWorkSchedule(previous.vrsta_radnog_vremena??"");
 if(!schedule&&!legacy)throw new Error("EMPLOYEE_FIELDS");
 const jobId=text("radno_mjesto_id");
 const jobs=await jobPositions(agencyId,tx);
 const job=jobs.find(j=>j.id===jobId);
 if(jobId&&(!job||!job.aktivno&&previous?.radno_mjesto_id!==jobId))throw new Error("EMPLOYEE_FIELDS");
 const type=text("tip_ugovora");
 if(type&&!["ODREDJENO","NEODREDJENO"].includes(type))throw new Error("EMPLOYEE_FIELDS");
 const start=text("datum_pocetka"),end=text("ugovoreni_istek");
 const from=start?strictEmploymentDate(start):null,until=end?strictEmploymentDate(end):null;
 if(start&&!from||end&&!until||type==="ODREDJENO"&&(!from||!until)||type!=="ODREDJENO"&&end||from&&until&&until<from)throw new Error("EMPLOYEE_FIELDS");
 const monthly=text("mjesecni_sati");
 if(monthly&&(!/^\d+$/.test(monthly)||Number(monthly)>744))throw new Error("EMPLOYEE_FIELDS");
 return {radno_mjesto_id:jobId||null,radno_mjesto:job?.naziv??previous?.radno_mjesto??null,
  adresa:text("adresa")||null,mjesto_rada:text("mjesto_rada")||null,tip_ugovora:type||null,ugovoreni_istek:until,
  vrsta_radnog_vremena:legacy?previous!.vrsta_radnog_vremena:key,
  procenat_radnog_vremena:schedule?.percentage??previous!.procenat_radnog_vremena,
  mjesecni_sati:monthly?Number(monthly)||null:null};
}
