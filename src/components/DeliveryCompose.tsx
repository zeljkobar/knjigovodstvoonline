"use client";
import {useRef} from "react";
import {useFormStatus} from "react-dom";
function SendButton(){const {pending}=useFormStatus();return <button type="submit" className="primary-button" disabled={pending}>{pending?"Predajem u red za slanje…":"Pošalji pripremljeni prilog"}</button>;}
export function DeliveryCompose({id,subject,body,email,contacts,canManage,enabled,action}:{id:string;subject:string;body:string;email:string;contacts:{id:string;naziv:string;email:string;podrazumijevan:boolean}[];canManage:boolean;enabled:boolean;action:(form:FormData)=>Promise<void>}) {
  const recipient=useRef<HTMLInputElement>(null);
  return <form action={action} className="admin-form"><input type="hidden" name="op" value="queue"/><input type="hidden" name="id" value={id}/>
    <label><span>Izaberi iz adresara (opciono)</span><select defaultValue="" onChange={e=>{const c=contacts.find(c=>c.id===e.target.value);if(c&&recipient.current)recipient.current.value=c.email;}}><option value="">Ručni unos adrese</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.naziv} · {c.email}{c.podrazumijevan?" · podrazumijevan":""}</option>)}</select></label>
    <label><span>Primalac</span><input ref={recipient} type="email" name="primalac" required maxLength={254} defaultValue={email}/></label><label><span>Kopija (jedna adresa, opciono)</span><input type="email" name="kopija" maxLength={254}/></label>
    <label style={{gridColumn:"1 / -1"}}><span>Naslov</span><input name="naslov" required maxLength={200} defaultValue={subject}/></label><label style={{gridColumn:"1 / -1"}}><span>Poruka</span><textarea name="poruka" maxLength={5000} rows={6} defaultValue={body}/></label>
    {canManage?<fieldset className="fiscal-access-fields"><legend>Sačuvaj primaoca u adresar</legend><label className="api-checkbox"><input type="checkbox" name="save_contact"/><span>Sačuvaj ovu adresu (samo ako označite)</span></label><label><span>Naziv kontakta / uloga</span><input name="contact_name" maxLength={120} placeholder="Npr. Računovodstvo"/></label><label className="api-checkbox"><input name="default_contact" type="checkbox"/><span>Podrazumijevani primalac za ovog kupca / izvještaje</span></label></fieldset>:null}
    <div>{enabled?<SendButton/>:<p role="alert">Slanje nije uključeno na serveru. Prilog možete pregledati i preuzeti.</p>}</div><p className="muted-text">Izbor kontakta i priprema priloga ne šalju mejl. Prihvaćeno od mail servisa ne znači potvrđenu isporuku ili čitanje.</p>
  </form>;
}
