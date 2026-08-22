"use client";

import { useMemo, useState } from "react";

type Agency = { id: string; naziv: string; pib: string | null };
type Company = { id: string; agencijaId: string; naziv: string; pib: string | null };

export function FiscalClientActivationForm({
  action,
  agencies,
  companies
}: {
  action: (formData: FormData) => void | Promise<void>;
  agencies: Agency[];
  companies: Company[];
}) {
  const [type, setType] = useState("AGENCY");
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const available = useMemo(
    () => companies.filter((company) => company.agencijaId === agencyId),
    [agencyId, companies]
  );

  return <form className="admin-form" action={action}>
    <label><span>Način saradnje</span><select name="client_type" value={type} onChange={(event) => setType(event.target.value)}><option value="AGENCY">Klijent knjigovodstvene agencije</option><option value="DIRECT">Direktni klijent — bez agencije</option></select></label>
    {type === "AGENCY" ? <>
      <label><span>Agencija</span><select name="agencija_id" value={agencyId} onChange={(event) => setAgencyId(event.target.value)} required><option value="">Izaberi agenciju</option>{agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.naziv}{agency.pib ? ` — ${agency.pib}` : ""}</option>)}</select></label>
      <label><span>Postojeća firma</span><select name="firma_id" required><option value="">Izaberi firmu</option>{available.map((company) => <option key={company.id} value={company.id}>{company.naziv}{company.pib ? ` — PIB ${company.pib}` : ""}</option>)}</select></label>
      <div><strong>Postojeći podaci ostaju isti</strong><small>Firmi se dodaje fiskalizacija bez novog zapisa, korisnika ili poslovne godine.</small></div>
      <button type="submit">Uključi fiskalizaciju</button>
    </> : <>
      <label><span>Puni naziv firme</span><input name="naziv" required /></label>
      <label><span>Skraćeni naziv</span><input name="skraceni_naziv" /></label>
      <label><span>PIB</span><input name="pib" inputMode="numeric" required /></label>
      <label><span>Adresa</span><input name="adresa" /></label>
      <label><span>Grad</span><input name="grad" /></label>
      <label><span><input name="pdv_obveznik" type="checkbox" value="true" /> PDV obveznik</span></label>
      <div><strong>Pristup vlasnika firme (opciono)</strong><small>Ako popuniš oba polja, klijent dobija pozivnicu i pristup samo svojoj firmi.</small></div>
      <label><span>Korisničko ime klijenta</span><input name="korisnicko_ime" /></label>
      <label><span>E-mail klijenta</span><input name="email" type="email" /></label>
      <button type="submit">Dodaj direktnog fiskalnog klijenta</button>
    </>}
  </form>;
}
