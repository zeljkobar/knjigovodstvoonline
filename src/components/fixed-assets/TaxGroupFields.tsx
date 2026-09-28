"use client";
import { useState } from "react";
import { fixedAssetTaxGroups, taxClassificationOptions, taxGroupsSource } from "@/lib/fixed-assets-tax-groups";
import { FieldHelp } from "./FieldHelp";

export function TaxGroupFields({ assetType }: { assetType: string }) {
  const options = taxClassificationOptions(assetType);
  const [selection, setSelection] = useState(options.length === 1 ? options[0].value : "");
  const group = fixedAssetTaxGroups.find(group => group.id === selection);
  return <>
    <FieldHelp title="Poreska grupa / tretman" help={<>
      <p>Poreska grupa je odvojena od računovodstvene metode i stope. Otvorite grupu da vidite pripadajuća sredstva.</p>
      {fixedAssetTaxGroups.map(item => <details key={item.id}><summary>Grupa {item.id} – {item.rate}%</summary><ul>{item.items.split(";").map(name => <li key={name}>{name}</li>)}</ul></details>)}
      <p>Zemljište i umjetnička djela se ne amortizuju. Za nematerijalnu imovinu i sredstva uzeta u zakup sa pravom korišćenja dužim od godinu dana, priznata kao sredstvo kod primaoca lizinga, priznaje se računovodstvena amortizacija. Ovi tretmani prate izbor vrste imovine.</p>
      <p>Poseban tretman koristite za sredstva koja zahtijevaju dodatnu provjeru, npr. eksploataciju prirodnih bogatstava. Takav izbor ne određuje poresku stopu.</p>
      <a href={taxGroupsSource} target="_blank" rel="noreferrer">Pravilnik – spisak sredstava i posebni tretmani</a>
    </>}><select name="poreska_klasifikacija" required value={selection} onChange={event => setSelection(event.target.value)}>
      {options.length > 1 ? <option value="">Izaberite poresku grupu ili tretman</option> : null}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></FieldHelp>
    <label>Poreska stopa<input readOnly value={group ? `${group.rate}%` : selection === "EXEMPT" ? "Ne amortizuje se" : selection === "ACCOUNTING_AMOUNT" ? "Prema računovodstvenoj amortizaciji" : "Nije određena"}/></label>
  </>;
}
