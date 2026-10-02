"use client";

import { useState } from "react";

export function ContractPaymentTerms({day, days, isNew}: {day: number | null; days: number | null; isNew: boolean}) {
  const [mode, setMode] = useState(day !== null || isNew ? "dan_u_mjesecu" : "dani");
  return <>
    <label><span>Način određivanja roka plaćanja</span>
      <select name="rok_placanja_tip" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="dan_u_mjesecu">Do dana u mjesecu za prethodni mjesec</option>
        <option value="dani">Broj dana od izdavanja fakture</option>
      </select>
    </label>
    {mode === "dan_u_mjesecu" ? <label><span>Plaćanje do dana u mjesecu</span>
      <input key="dan" name="dan_placanja" type="number" min="1" max="31" defaultValue={day ?? (isNew ? 5 : "")} />
    </label> : <label><span>Rok plaćanja (dana od fakture)</span>
      <input key="dani" name="rok_placanja_dana" type="number" min="0" max="365" defaultValue={days ?? ""} />
    </label>}
  </>;
}
