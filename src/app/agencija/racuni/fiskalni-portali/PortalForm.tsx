"use client";
import { useState } from "react";
import { saveFiscalPortal } from "./actions";
type Props = { firmId: string; configured: boolean; version: string; provider: string; username: string; active: boolean; enabled: boolean; defaultDevice: string };
export default function PortalForm(props: Props) {
  const [provider, setProvider] = useState(props.provider), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  async function check() {
    setBusy(true); setMessage(""); setDevices([]);
    try { const response = await fetch(`/api/pazar-import/devices?firma=${props.firmId}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Provjera veze nije uspjela."); setDevices(data.devices); setMessage(data.devices.length ? "Veza je uspješna. Dostupne kase:" : "Veza radi, ali nema podešenih kasa."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Provjera veze nije uspjela."); } finally { setBusy(false); }
  }
  return <><form className="admin-form" action={saveFiscalPortal}>
    <input type="hidden" name="firma_id" value={props.firmId}/><input type="hidden" name="version" value={props.version}/>
    <label>Provajder<select name="provider" value={provider} onChange={e => setProvider(e.target.value)}><option value="VG_EFISKAL">VG eFiskal</option><option value="SUMMA_FISKAL">Summa Fiskal</option></select></label>
    {provider === "VG_EFISKAL" ? <><label>Korisničko ime / email<input name="korisnicko_ime" type="email" defaultValue={props.username} maxLength={320} autoComplete="off" required/></label><label>{props.configured && props.provider === provider ? "Nova lozinka (prazno zadržava postojeću)" : "Lozinka"}<input name="lozinka" type="password" maxLength={4096} autoComplete="new-password" required={!props.configured || props.provider !== provider}/></label></> : <p className="form-wide">Podaci se čitaju iz baze ove firme: samo fiskalizovani POS računi i POS storna.</p>}
    {devices.length && provider === props.provider ? <label>Podrazumijevana kasa<select name="podrazumijevana_kasa" defaultValue={props.defaultDevice}><option value="">Bez podrazumijevane kase</option>{devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label> : <input name="podrazumijevana_kasa" type="hidden" value={provider === props.provider ? props.defaultDevice : ""}/>}
    <label><input name="aktivan" type="checkbox" defaultChecked={props.active}/> Aktivno povezivanje</label>
    <div className="form-actions"><button type="submit" disabled={!props.enabled}>Sačuvaj povezivanje</button></div>
  </form>
  {props.configured && props.active ? <div className="admin-stack"><p>Provjera koristi posljednje sačuvane podatke.</p><div><button type="button" className="secondary-button" disabled={busy} onClick={check}>{busy ? "Provjeravam…" : "Provjeri vezu i učitaj kase"}</button></div>{message ? <p role="status" className="admin-message">{message}</p> : null}{devices.length ? <ul>{devices.map(d => <li key={d.id}>{d.label}</li>)}</ul> : null}</div> : null}</>;
}
