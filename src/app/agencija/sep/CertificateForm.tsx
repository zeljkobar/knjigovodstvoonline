"use client";
import { useFormStatus } from "react-dom";
import { saveSepCertificate, removeSepCertificate } from "./actions";
function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit">{pending ? "Čuvanje…" : children}</button>;
}
export function CertificateForm({ configured, enabled }: { configured: boolean; enabled: boolean }) {
  return <>
    <form action={saveSepCertificate} className="admin-form" autoComplete="off">
      <label><span>Naziv sertifikata</span><input name="naziv" required maxLength={120} disabled={!enabled}/></label>
      <label><span>PFX / P12 fajl (do 512 KB)</span><input type="file" name="sertifikat" accept=".pfx,.p12" required disabled={!enabled}/></label>
      <label><span>Lozinka sertifikata</span><input type="password" name="lozinka" maxLength={1024} autoComplete="new-password" disabled={!enabled}/></label>
      <label><span>Vaš JMBG</span><input type="password" name="jmbg" inputMode="numeric" pattern="[0-9]{13}" minLength={13} maxLength={13} required autoComplete="new-password" disabled={!enabled}/></label>
      {enabled ? <div className="form-wide"><Submit>{configured ? "Zamijeni sertifikat" : "Sačuvaj sertifikat"}</Submit></div> : null}
    </form>
    {configured ? <form action={removeSepCertificate} onSubmit={event => { if (!confirm("Ukloniti vaš sačuvani SEP sertifikat i podatke za pristup?")) event.preventDefault(); }}><Submit>Ukloni sačuvani pristup</Submit></form> : null}
  </>;
}
