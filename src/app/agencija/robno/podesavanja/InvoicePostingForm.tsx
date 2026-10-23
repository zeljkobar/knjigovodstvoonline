"use client";

import { AccountSearchSelect } from "@/components/AccountSearchSelect";


import { calculationPostingFields } from "@/lib/inventory-calculation";
import { useState } from "react";
import { advanceInvoicePostingFields, advanceInvoiceRatePurposes } from "@/lib/advance-invoice-posting";
import { outgoingInvoicePostingFields, type InvoicePostingRule } from "@/lib/outgoing-invoice";
import { saveCalculationPostingSettings, saveOutgoingInvoicePostingSettings, saveAdvanceInvoicePostingSettings } from "./actions";

type Props = { kind?: "invoice" | "calculation" | "advance"; firmaId: string; settings: InvoicePostingRule[]; accounts: Array<{sifra:string;naziv:string}>; rates: Array<{sifra:string;naziv:string}> };
export function InvoicePostingForm({kind="invoice",firmaId,settings,accounts,rates}:Props) {
  const fields = kind === "calculation" ? calculationPostingFields : kind === "advance" ? advanceInvoicePostingFields : outgoingInvoicePostingFields;
  const [rows,setRows] = useState(()=>settings.length ? settings : fields.map(f=>({namjena:f.purpose,pdv_stopa_sifra:"GENERAL",sifra_konta:"",smjer:f.defaultDirection})));
  const update=(index:number,key:keyof InvoicePostingRule,value:string)=>setRows(rows.map((r,i)=>i===index?{...r,[key]:value}:r));
  return <form action={kind === "calculation" ? saveCalculationPostingSettings : kind === "advance" ? saveAdvanceInvoicePostingSettings : saveOutgoingInvoicePostingSettings} className="admin-form">
    <input type="hidden" name="firma_id" value={firmaId}/>
    <input type="hidden" name={kind === "calculation" ? "calculation_rules" : kind === "advance" ? "advance_rules" : "invoice_rules"} value={JSON.stringify(rows)}/>
    <p className="form-wide">Dodajte stavku knjiženja i izaberite PDV stopu. „Sve ostale stope“ važi samo kada za stopu ne postoji poseban red. Već napravljeni nalozi se ne mijenjaju čuvanjem šeme.</p>
    <div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>PDV stopa</th><th>Smjer</th><th>Konto</th><th></th></tr></thead><tbody>
      {rows.map((row,i)=>{const rateField=kind === "calculation" || (kind === "advance" ? advanceInvoiceRatePurposes : ["INVOICE_REVENUE","INVOICE_OUTPUT_VAT"]).includes(row.namjena);return <tr key={i}>
        <td><select aria-label={`Stavka ${i+1}`} value={row.namjena} onChange={e=>setRows(rows.map((r,n)=>n===i?{...r,namjena:e.target.value,pdv_stopa_sifra:"GENERAL"}:r))}>{fields.map(f=><option key={f.purpose} value={f.purpose}>{f.label}</option>)}</select></td>
        <td><select aria-label={`PDV stopa ${i+1}`} disabled={!rateField} value={row.pdv_stopa_sifra} onChange={e=>update(i,"pdv_stopa_sifra",e.target.value)}><option value="GENERAL">{rateField?"Sve ostale stope":"—"}</option>{rateField?rates.map(r=><option key={r.sifra} value={r.sifra}>{r.naziv}</option>):null}</select></td>
        <td><select aria-label={`Smjer ${i+1}`} value={row.smjer} onChange={e=>update(i,"smjer",e.target.value)}><option value="D">Duguje</option><option value="P">Potražuje</option></select></td>
        <td><AccountSearchSelect aria-label={`Konto ${i+1}`} value={row.sifra_konta} onChange={e=>update(i,"sifra_konta",e.target.value)}><option value="">Nije podešeno</option>{accounts.map(a=><option key={a.sifra} value={a.sifra}>{a.sifra} · {a.naziv}</option>)}</AccountSearchSelect></td>
        <td><button type="button" className="secondary-button" onClick={()=>setRows(rows.filter((_,n)=>n!==i))}>Ukloni</button></td>
      </tr>})}
    </tbody></table></div>
    <div className="form-actions form-wide"><button type="button" className="secondary-button" onClick={()=>setRows([...rows,{namjena:kind === "calculation" ? "CALCULATION_INCLUDED_VAT" : kind === "advance" ? "ADVANCE_RECEIVED" : "INVOICE_REVENUE",pdv_stopa_sifra:rates[0]?.sifra??"GENERAL",sifra_konta:"",smjer:"P"}])}>Dodaj stavku</button><button className="primary-button" type="submit">{kind === "calculation" ? "Sačuvaj šemu kalkulacije" : kind === "advance" ? "Sačuvaj šemu avansnih računa" : "Sačuvaj šemu fakture"}</button></div>
  </form>;
}
