"use client";
import { FieldHelp, CalculationHelp } from "./FieldHelp";
import styles from "./form-help.module.css";
import { useState } from "react";
import { fixedAssetMethodLabels, scaledDecimal, decimalString } from "@/lib/fixed-assets-rates";
import { parseFixedAssetMoney } from "@/lib/fixed-assets";
export function DepreciationFields({ exempt=false, revision=false, opening=false, gross="", initialMethod="LINEAR", initialRate="", initialResidual="0", initialLife="", initialUnit="", initialQuantity="", initialUnitRate="", initialSource="DERIVED" }: {
  exempt?:boolean; revision?:boolean; opening?:boolean; gross?:string; initialMethod?:string; initialRate?:string; initialResidual?:string; initialLife?:string; initialUnit?:string; initialQuantity?:string; initialUnitRate?:string; initialSource?:string;
}) {
  const [method,setMethod]=useState(initialMethod==="NONE"?"LINEAR":initialMethod);
  const [manualRate,setManualRate]=useState(initialUnitRate);
  const [source,setSource]=useState(initialSource),[quantity,setQuantity]=useState(initialQuantity),[residual,setResidual]=useState(initialResidual);
  const quantityScaled=scaledDecimal(quantity), cost=parseFixedAssetMoney(gross), rest=parseFixedAssetMoney(residual);
  const rate=quantityScaled && cost!==null && rest!==null && cost>=rest ? decimalString((BigInt(cost-rest)*BigInt(10_000_000_000)+quantityScaled/BigInt(2))/quantityScaled) : null;
  const manualScaled=scaledDecimal(manualRate);
  const derivedCapacity=manualScaled && cost!==null && rest!==null && cost>rest ? decimalString((BigInt(cost-rest)*BigInt(10_000_000_000)+manualScaled/BigInt(2))/manualScaled) : null;
  if(exempt) return <p className="admin-note">Zemljište se ne amortizuje. Metoda, stopa i vijek se ne unose.<input type="hidden" name="ostatak_vrijednosti" value="0" /></p>;
  return <div className={styles.fields}>
    <label>Metoda amortizacije<select name="metoda" value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(fixedAssetMethodLabels).filter(([key])=>key!=="NONE").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <FieldHelp title="Ostatak vrijednosti (EUR)" help={<> Procijenjena vrijednost na kraju korišćenja; taj iznos se ne otpisuje.</>}><input name="ostatak_vrijednosti" value={residual} onChange={e=>setResidual(e.target.value)} inputMode="decimal" required /></FieldHelp>
    {method!=="UNITS_OF_PRODUCTION" ? <FieldHelp title="Godišnja stopa amortizacije (%)" help={<> Unesite procenat od 0 do 100 (bez znaka %), najviše šest decimala.</>}><input key={method} name="godisnja_stopa" defaultValue={initialRate} inputMode="decimal" placeholder="npr. 20" required /></FieldHelp> : null}
    {method==="LINEAR" ? <CalculationHelp>{revision ? "Stopa se primjenjuje na preostalu vrijednost umanjenu za novi ostatak, na datum promjene." : "Stopa se primjenjuje na originalnu nabavnu vrijednost umanjenu za ostatak. Raniji otpis smanjuje preostalu vrijednost, a ne ovu osnovicu."} Godišnji otpis dijeli se na 12 mjeseci; nepotpun mjesec srazmjerno danima.</CalculationHelp> : null}
    {method==="DEGRESSIVE" ? <><label>{opening||revision?"Preostali":"Korisni"} vijek (mjeseci)<input defaultValue={initialLife} name="korisni_vijek_mjeseci" type="number" min="1" max="1200" required /></label><CalculationHelp>Stopa se primjenjuje na neto vrijednost na početku godine. Kada linearni otpis kroz preostali vijek bude veći, obračun prelazi na njega do kraja vijeka.</CalculationHelp></> : null}
    {method==="UNITS_OF_PRODUCTION" ? <>
      <label>Jedinica učinka<input name="jedinica_ucinka" defaultValue={initialUnit} placeholder="npr. sat, km, komad" maxLength={40} required /></label>
      {source==="DERIVED" ? <label>{revision?"Procijenjeni preostali učinak od ove promjene":"Procijenjeni ukupni učinak tokom cijelog vijeka"}<input name="ocekivani_ucinak" value={quantity} onChange={e=>setQuantity(e.target.value)} inputMode="decimal" required /></label> : <p className="admin-note">{derivedCapacity ? `Očekivani učinak iz stope: ${derivedCapacity.replace(".",",")}.` : "Očekivani učinak računa se iz osnovice i unesene stope."}</p>}
      {opening&&!revision ? <FieldHelp title="Učinak ostvaren do početnog presjeka" help={<> Mora odgovarati unesenoj akumuliranoj amortizaciji i stopi.</>}><input name="prethodni_ucinak" defaultValue="0" inputMode="decimal" required /></FieldHelp> : <input type="hidden" name="prethodni_ucinak" value="0" />}
      <label>Način zadavanja stope<select name="izvor_stope" value={source} onChange={e=>setSource(e.target.value)}><option value="DERIVED">Izračunaj iz osnovice i učinka</option><option value="MANUAL">Unesi EUR po jedinici</option></select></label>
      {source==="MANUAL" ? <label>Stopa amortizacije (EUR po jedinici)<input name="stopa_po_jedinici" value={manualRate} onChange={e=>setManualRate(e.target.value)} inputMode="decimal" required /></label> : <p className="admin-note">{revision?"Stopa = preostala osnovica na datum promjene ÷ novi procijenjeni preostali učinak.":rate?`Stopa: ${rate.replace(".",",")} EUR po jedinici (prikaz zaokružen na 6 decimala).`:"Stopa = (nabavna vrijednost − ostatak) ÷ ukupni učinak."} </p>}
      <CalculationHelp>Amortizacija je stopa po jedinici pomnožena sa ostvarenim učinkom. Izvedena stopa koristi precizan odnos osnovice i procijenjenog učinka. Stvarni učinak unosite na kartici sredstva; unesite nulu kada nije bilo korišćenja.</CalculationHelp>
    </> : null}
  </div>;
}
