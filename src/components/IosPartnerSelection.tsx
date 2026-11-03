"use client";
import { useState } from "react";
import { iosMoney } from "@/lib/ios-format";
type Props={query:string;rows:{id:string;name:string;tax:string|null;count:number;debit:number;credit:number}[]};
export function IosPartnerSelection({query,rows}:Props){
 const [selected,setSelected]=useState<Set<string>>(()=>new Set());
 return <form action="/stampa/ios" method="get" target="_blank">
  {Array.from(new URLSearchParams(query)).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  <div className="card-header"><span>{selected.size} izabranih partnera</span><button className="primary-button" disabled={!selected.size}>Štampaj izabrane IOS-e</button></div>
  <div className="table-wrap"><table className="admin-table"><thead><tr><th><input type="checkbox" aria-label="Označi sve partnere za IOS" checked={rows.length>0&&selected.size===rows.length} onChange={e=>setSelected(new Set(e.target.checked?rows.map(r=>r.id):[]))}/></th><th>Partner / PIB</th><th>Otvorene stavke</th><th>Otvoreno duguje</th><th>Otvoreno potražuje</th><th>Štampa</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><input type="checkbox" name="partner" value={row.id} aria-label={`IOS za ${row.name}`} checked={selected.has(row.id)} onChange={e=>{const checked=e.target.checked;setSelected(current=>{const next=new Set(current);if(checked)next.add(row.id);else next.delete(row.id);return next;});}}/></td><td>{row.name}<small>{row.tax}</small></td><td>{row.count}</td><td>{iosMoney(row.debit)}</td><td>{iosMoney(row.credit)}</td><td><a className="table-link" target="_blank" href={`/stampa/ios?${query}&partner=${encodeURIComponent(row.id)}`}>Štampaj IOS</a></td></tr>)}</tbody></table></div>
  {!rows.length?<p className="empty-state">Nema partnera za izabrane filtere.</p>:null}
 </form>;
}
