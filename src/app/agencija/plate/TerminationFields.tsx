"use client";
import {useState} from "react";
import {terminationTypes} from "@/lib/employment-termination";
export function TerminationFields({expiry}:{expiry:string}) {
 const [type,setType]=useState("");
 return <>
  <label>Vrsta prestanka<select name="vrsta_prestanka" value={type} onChange={e=>setType(e.target.value)} required><option value="">Izaberite vrstu</option>{Object.entries(terminationTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label>Datum dokumenta<input name="datum_dokumenta" type="date" required/></label>
  <label>Datum prestanka<input key={type} name="datum_prestanka" type="date" defaultValue={type==="ISTEK"?expiry:""} required/></label>
  {type==="RADNIK"?<label className="single-checkbox"><input type="checkbox" name="kraci_rok"/><span>Dogovoren kraći otkazni rok od 30 dana</span></label>:null}
 </>;
}
