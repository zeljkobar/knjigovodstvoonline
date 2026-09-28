"use client";
import { FieldHelp } from "./FieldHelp";
import styles from "./form-help.module.css";
import { useState } from "react";
import { createFixedAsset } from "@/app/agencija/osnovna-sredstva/actions";
import { fixedAssetTypeLabels } from "@/lib/fixed-assets";
import { TaxGroupFields } from "./TaxGroupFields";
import { DepreciationFields } from "./DepreciationFields";
export function NewAssetForm({companyId,yearId,cutoff,yearStart,yearEnd,locked,canOpening,categories,units}:{companyId:string;yearId:string;cutoff:string;yearStart:string;yearEnd:string;locked:boolean;canOpening:boolean;categories:{id:string;sifra:string;naziv:string}[];units:{id:string;sifra:string;naziv:string}[]}) {
  const [mode,setMode]=useState(canOpening?"OPENING":"NEW"),[type,setType]=useState("MATERIAL"),[gross,setGross]=useState("");
  return <form action={createFixedAsset} className="admin-panel compact-form">
    <input type="hidden" name="ocekivana_firma_id" value={companyId}/><input type="hidden" name="ocekivana_godina_id" value={yearId}/>
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className={styles.fields}>
      <label>Način unosa<select name="nacin_unosa" value={mode} onChange={e=>setMode(e.target.value)}>{canOpening?<option value="OPENING">Preuzeto početno stanje</option>:null}<option value="NEW">Nova nabavka – nacrt</option></select></label>
      <label>Inventarski broj<input name="inventarski_broj" required /></label><label>Naziv<input name="naziv" required /></label>
      <label>Vrsta imovine<select name="vrsta_imovine" value={type} onChange={e=>setType(e.target.value)}>{Object.entries(fixedAssetTypeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Kategorija<select name="kategorija_id"><option value="">Bez kategorije</option>{categories.map(c=><option key={c.id} value={c.id}>{c.sifra} – {c.naziv}</option>)}</select></label>
      <label>Poslovna jedinica<select name="poslovna_jedinica_id"><option value="">Bez jedinice</option>{units.map(u=><option key={u.id} value={u.id}>{u.sifra} – {u.naziv}</option>)}</select></label>
      <FieldHelp title="Datum nabavke" help={<> Datum računa ili dokumenta nabavke.</>}><input name="datum_nabavke" type="date" min={mode==="NEW"?yearStart:undefined} max={mode==="OPENING"?cutoff:yearEnd}/></FieldHelp>
      <FieldHelp title="Spremno za korišćenje od" help={<> Datum kada je sredstvo osposobljeno za namjeravanu upotrebu.</>}><input key={mode} name="datum_raspolozivosti" type="date" required max={mode==="OPENING"?cutoff:undefined}/></FieldHelp>
      {mode==="OPENING"?<><FieldHelp title="Početno stanje na dan" help={<> Automatski dan prije aktivne godine. Novi obračun počinje {yearStart}.</>}><input name="datum_presjeka" type="date" value={cutoff} readOnly/></FieldHelp><FieldHelp title="Dosadašnja akumulirana amortizacija (EUR)" help={<> Ukupan raniji otpis do datuma presjeka.</>}><input name="akumulirana_amortizacija" defaultValue="0" inputMode="decimal" required/></FieldHelp></>:null}
      <FieldHelp title="Originalna nabavna vrijednost (EUR)" help={<> Bruto nabavna vrijednost prije bilo kakvog otpisa.</>}><input name="nabavna_vrijednost" inputMode="decimal" value={gross} onChange={e=>setGross(e.target.value)} required/></FieldHelp>
      <DepreciationFields exempt={type==="LAND"} opening={mode==="OPENING"} gross={gross}/>
      <TaxGroupFields key={type} assetType={type}/>
      <label>Broj dokumenta<input name="broj_dokumenta"/></label><label>Serijski broj<input name="serijski_broj"/></label><label>Lokacija<input name="lokacija"/></label><label>Zadužena osoba<input name="zaduzena_osoba"/></label>
    </div><label>Opis<textarea name="opis" rows={3}/></label>
    <p className="admin-note">{mode==="OPENING"?"Preuzeto stanje potvrđuje se bez novog naloga glavne knjige.":"Nova nabavka ostaje u pripremi do povezivanja sa knjiženim dokumentom."}</p>
    <button type="submit">Sačuvaj sredstvo</button></fieldset>
  </form>;
}
