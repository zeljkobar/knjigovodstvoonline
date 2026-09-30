"use client";
import Link from "next/link";
import type { AutomaticTaxEvent } from "@/lib/fixed-assets-tax-events";
import { fixedAssetCentsMoney } from "@/lib/fixed-assets";
import { useState } from "react";
import { saveTaxInputs } from "@/app/agencija/osnovna-sredstva/poreska-amortizacija/actions";
import { fixedAssetCentsToDecimal } from "@/lib/fixed-assets";
import { taxClassificationOptions } from "@/lib/fixed-assets-tax-groups";
import { type TaxAsset, type TaxInput } from "@/lib/fixed-assets-tax";
import { FieldHelp } from "./FieldHelp";
export function TaxInputsForm({ input, automaticEvents, automaticErrors, assets, companyId, yearId, version, locked, from, to, carried }: { input: TaxInput; automaticEvents: AutomaticTaxEvent[]; automaticErrors: string[]; assets: TaxAsset[]; companyId: string; yearId: string; version: number; locked: boolean; from: string; to: string; carried: boolean }) {
  const [openingSource,setSource] = useState(input.openingSource);
  const [pools,setPools] = useState(input.pools.map(p=>({...p,opening: version || carried ? fixedAssetCentsToDecimal(p.opening) : ""})));
  const [rows,setRows] = useState(input.assets.map(a=>({...a,basis: fixedAssetCentsToDecimal(a.basis),previous: fixedAssetCentsToDecimal(a.previous),accounting: fixedAssetCentsToDecimal(a.accounting)})));
  const [events,setEvents] = useState(input.events.map(e=>({...e,amount: fixedAssetCentsToDecimal(e.amount)})));
  const changeRow = (id: string, values: Partial<typeof rows[number]>) => setRows(rows.map(a=>a.id===id?{...a,...values}:a));
  return <form action={saveTaxInputs} className="admin-form">
    <input type="hidden" name="ocekivana_firma_id" value={companyId}/><input type="hidden" name="ocekivana_godina_id" value={yearId}/><input type="hidden" name="verzija" value={version}/>
    <input type="hidden" name="ulazi" value={JSON.stringify({ openingSource,pools,assets:rows,events })}/>
    <fieldset disabled={locked} style={{border:0,padding:0,minWidth:0,display:"grid",gap:24}}>
      <section><h3>Početna poreska stanja na 01.01.{from.slice(0,4)}.</h3>
      <p>Prepišite poreska stanja iz prethodnog OA obrasca. Računovodstvena stanja se ne preuzimaju. Unesite i nule za grupe bez salda.</p>
      <label>Izvor početnog stanja<input required maxLength={500} value={openingSource} onChange={e=>setSource(e.target.value)} placeholder="Npr. OA za prethodnu godinu, datum i broj dokumenta"/></label>
      <div className="table-wrap"><table><thead><tr><th>Grupa</th><th>Neotpisani poreski saldo (EUR)</th><th>Prodaja svih sredstava grupe tokom godine</th></tr></thead><tbody>{pools.map(p=><tr key={p.group}><td>{p.group}</td><td><input aria-label={`Početni saldo grupe ${p.group}`} inputMode="decimal" required readOnly={carried} value={p.opening} onChange={e=>setPools(pools.map(row=>row.group===p.group?{...row,opening:e.target.value}:row))}/></td><td><input aria-label={`Sva sredstva grupe ${p.group} su prodata`} type="checkbox" checked={p.soldAll} onChange={e=>setPools(pools.map(row=>row.group===p.group?{...row,soldAll:e.target.checked}:row))}/></td></tr>)}</tbody></table></div></section>
      <section><h3>Klasifikacija i pojedinačna poreska stanja</h3><p>Klasifikacija važi za ovu poresku godinu. Za I grupu unesite poresku nabavnu osnovicu prije otpisa i ukupnu poresku amortizaciju prethodnih godina.</p>
      {rows.map(row=>{const asset=assets.find(a=>a.id===row.id)!;return <details key={row.id} open={row.classification === "I" || row.classification === "ACCOUNTING_AMOUNT" || row.classification === "UNSUPPORTED"} style={{marginBottom:16}}><summary>{asset.name}</summary><div style={{display:"grid",gap:14,padding:"12px 0"}}>
        <label>Poreska grupa / tretman<select value={row.classification} onChange={e=>changeRow(row.id,{classification:e.target.value,basis:"0",previous:"0",accounting:"0",source:""})}>{taxClassificationOptions(asset.type).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        {["I","ACCOUNTING_AMOUNT"].includes(row.classification) ? <><FieldHelp title="Poreska nabavna osnovica (EUR)" help="Originalna poreska osnovica, prije prethodne amortizacije. Ne unosite samo preostalu neotpisanu vrijednost."><input required inputMode="decimal" value={row.basis} onChange={e=>changeRow(row.id,{basis:e.target.value})}/></FieldHelp><label>Ranija poreska amortizacija (EUR)<input required inputMode="decimal" value={row.previous} onChange={e=>changeRow(row.id,{previous:e.target.value})}/></label></> : null}
        {row.classification === "ACCOUNTING_AMOUNT" ? <FieldHelp title="Računovodstvena amortizacija ove godine (EUR)" help="Unesite godišnji iznos iz potvrđenog računovodstvenog obračuna. Ovo nije početno stanje niti ukupan raniji otpis."><input required inputMode="decimal" value={row.accounting} onChange={e=>changeRow(row.id,{accounting:e.target.value})}/></FieldHelp> : null}
        {["I","ACCOUNTING_AMOUNT"].includes(row.classification) ? <label>Izvor iznosa / dokument<input value={row.source} maxLength={500} required onChange={e=>changeRow(row.id,{source:e.target.value})}/></label> : null}
      </div></details>;})}
      {!rows.length ? <p>Nema aktivnih sredstava u registru za ovu godinu. Grupna poreska stanja možete unijeti nezavisno.</p>:null}</section>
      <section><h3>Poreske promjene tokom godine</h3><p>Potvrđene nabavke i prodaje automatski se preuzimaju sa kartice sredstva pri otvaranju i obračunu. Početno stanje se ne preuzima kao nova nabavka.</p>
      {automaticErrors.length?<ul role="alert">{automaticErrors.map(error=><li key={error}>{error}</li>)}</ul>:null}
      <div className="table-wrap"><table><thead><tr><th>Datum</th><th>Sredstvo</th><th>Promjena</th><th>Grupa</th><th>Iznos (EUR)</th><th>Izvor</th></tr></thead><tbody>{automaticEvents.map(event=><tr key={event.id}><td>{event.date.split("-").reverse().join(".")}</td><td><Link href={`/agencija/osnovna-sredstva/${event.origin.assetId}`}>{event.origin.assetName}</Link></td><td>{event.kind==="PURCHASE"?"Nabavka":"Prodaja"}</td><td>{event.group}</td><td>{fixedAssetCentsMoney(event.amount)}</td><td><Link href={`/agencija/nalozi/${event.origin.journalId}`}>Izvorni nalog</Link></td></tr>)}{!automaticEvents.length?<tr><td colSpan={6}>Još nema potvrđenih nabavki/prodaja za ovu godinu.</td></tr>:null}</tbody></table></div>
      <details><summary>Ručne dopune i popravke</summary><p>Koristite samo za promjene koje nijesu evidentirane na kartici sredstva. Automatske promjene ispravljaju se u izvornom dokumentu.</p>
      {events.map((event,index)=><div key={event.id} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:20}}>
        <label>Grupa<select value={event.group} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,group:e.target.value,assetId:""}:r))}>{["I","II","III","IV","V","POSEBNO"].map(g=><option key={g}>{g}</option>)}</select></label>
        {["I","POSEBNO"].includes(event.group) ? <label>Sredstvo<select required value={event.assetId} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,assetId:e.target.value}:r))}><option value="">Izaberite sredstvo</option>{rows.filter(r=>r.classification === (event.group === "I" ? "I" : "ACCOUNTING_AMOUNT")).map(a=><option key={a.id} value={a.id}>{assets.find(s=>s.id===a.id)!.name}</option>)}</select></label>:null}
        <label>Promjena<select value={event.kind} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,kind:e.target.value as typeof event.kind}:r))}><option value="PURCHASE">Nabavka stavljena u upotrebu</option><option value="SALE">Prodaja</option><option value="REPAIR">Popravka / ulaganje</option></select></label>
        <label>Datum<input required type="date" min={from} max={to} value={event.date} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,date:e.target.value}:r))}/></label>
        <label>Iznos (EUR)<input required inputMode="decimal" value={event.amount} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,amount:e.target.value}:r))}/></label>
        <label>Izvor / broj dokumenta<input required maxLength={500} value={event.source} onChange={e=>setEvents(events.map((r,i)=>i===index?{...r,source:e.target.value}:r))}/></label>
        <button type="button" className="button-secondary" onClick={()=>setEvents(events.filter((_,i)=>i!==index))}>Ukloni promjenu</button>
      </div>)}
      <button type="button" className="button-secondary" onClick={()=>setEvents([...events,{id:crypto.randomUUID(),group:"II",assetId:"",kind:"PURCHASE",date:from,amount:"",source:""}])}>Dodaj ručnu dopunu</button></details></section>
      <button type="submit">Sačuvaj poreska stanja i promjene</button>
    </fieldset>
  </form>;
}
