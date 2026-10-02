import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { agencyProfileSelect, missingAgencyFields } from "@/lib/agency-profile";
import { saveAgencyProfile, saveAgencyBankAccount, deleteAgencyBankAccount } from "./actions";
import styles from "./profile.module.css";
const messages: Record<string,string> = {
  sacuvano:"Podaci agencije su sačuvani.",nedostaje:"Agencija nije dostupna.",
  zastarjelo:"Podaci su u međuvremenu izmijenjeni. Provjerite prikazane vrijednosti i ponovite izmjenu.",
  duplikat:"PIB ili bankovni račun već postoji. Provjerite unos.",podaci:"Unesite naziv i provjerite dužinu unesenih podataka.",
  pib:"PIB treba da sadrži osam cifara.",email:"Unesite ispravnu email adresu.",racun:"Provjerite naziv banke i broj računa (domaći broj ili IBAN)."
};
export default async function AgencyProfilePage({searchParams}:{searchParams?:Promise<{poruka?:string}>}) {
  const user=await requireRole("admin_agencije");
  const agency=user.agencija_id ? await prisma.agencija.findFirst({where:{id:user.agencija_id,aktivan:true,is_deleted:false,is_fiscal_direct_container:false},select:agencyProfileSelect}):null;
  if(!agency) return <p className="admin-message">Agencija nije dostupna.</p>;
  const params=await searchParams, missing=missingAgencyFields(agency), version=agency.updated_at.toISOString();
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Podešavanja</p><h1>Agencija</h1><p className="muted-text">Podaci vaše agencije za ugovore sa klijentima. Važe za cijelu agenciju, nezavisno od izabrane firme.</p></div></header>
    {params?.poruka && messages[params.poruka] ? <p role="status" className="admin-message">{messages[params.poruka]}</p>:null}
    {missing.length ? <p className="admin-message">Za popunjavanje ugovora dopunite: {missing.join(", ")}.</p>:null}
    <form action={saveAgencyProfile} className="admin-stack">
      <input type="hidden" name="verzija" value={version}/>
      <section className="admin-panel"><div className="panel-header"><h2>Osnovni podaci</h2></div>
        <div className="admin-form">
          <label className="form-wide"><span>Puni naziv agencije</span><input name="naziv" defaultValue={agency.naziv} required maxLength={250}/></label>
          <label><span>PIB</span><input name="pib" defaultValue={agency.pib??""} inputMode="numeric" maxLength={8} pattern="[0-9]{8}"/></label>
          <label><span>PDV broj (ako postoji)</span><input name="pdv_broj" defaultValue={agency.pdv_broj??""} maxLength={250}/></label>
          <label><span>Sjedište / grad</span><input name="grad" defaultValue={agency.grad??""} maxLength={250}/></label>
          <label><span>Adresa</span><input name="adresa" defaultValue={agency.adresa??""} maxLength={250}/></label>
        </div>
      </section>
      <section className="admin-panel"><div className="panel-header"><h2>Zastupnik i kontakt</h2></div>
        <div className="admin-form">
          <label><span>Ime i prezime ovlašćenog zastupnika</span><input name="zastupnik_ime" defaultValue={agency.zastupnik_ime??""} maxLength={250}/></label>
          <label><span>Funkcija zastupnika</span><input name="zastupnik_funkcija" defaultValue={agency.zastupnik_funkcija??""} placeholder="npr. izvršni direktor" maxLength={250}/></label>
          <label><span>Telefon</span><input type="tel" name="telefon" defaultValue={agency.telefon??""} maxLength={250}/></label>
          <label><span>Kontakt email</span><input type="email" name="email" defaultValue={agency.email??""} maxLength={250}/></label>
        </div>
        <div className={styles.actions}><button type="submit">Sačuvaj podatke agencije</button><Link className="table-link" href="/agencija/podesavanja/email">Podešavanja slanja emaila</Link></div>
      </section>
    </form>
    <section className="admin-panel"><div className="panel-header"><div><h2>Bankovni računi</h2><p className="muted-text">Glavni račun se preuzima u nove ugovore. Prvi uneseni račun automatski postaje glavni.</p></div></div>
      {agency.bankovni_racuni.map(account=><div className={styles.account} key={account.id}>
        <form action={saveAgencyBankAccount} className="admin-form">
          <input type="hidden" name="verzija" value={version}/><input type="hidden" name="racun_id" value={account.id}/>
          <label><span>Banka</span><input name="naziv_banke" defaultValue={account.naziv_banke} required maxLength={150}/></label>
          <label><span>Broj računa / IBAN</span><input name="broj_racuna" defaultValue={account.broj_racuna} required maxLength={40}/></label>
          <label className="single-checkbox form-checkbox"><input type="checkbox" name="glavni" defaultChecked={account.glavni}/><span>Glavni račun</span></label>
          <button className="table-button" type="submit">Sačuvaj račun</button>
        </form>
        <form action={deleteAgencyBankAccount} className={styles.remove}><input type="hidden" name="verzija" value={version}/><input type="hidden" name="racun_id" value={account.id}/><button className="table-button" type="submit">Ukloni račun</button></form>
      </div>)}
      <h3>Novi bankovni račun</h3>
      <form action={saveAgencyBankAccount} className="admin-form">
        <input type="hidden" name="verzija" value={version}/>
        <label><span>Banka</span><input name="naziv_banke" required maxLength={150}/></label>
        <label><span>Broj računa / IBAN</span><input name="broj_racuna" placeholder="000-0000000000000-00" required maxLength={40}/></label>
        <label className="single-checkbox form-checkbox"><input type="checkbox" name="glavni"/><span>Postavi kao glavni</span></label>
        <button type="submit">Dodaj račun</button>
      </form>
    </section>
    <p className="muted-text">Promjene ovih podataka ne mijenjaju sačuvane ugovore. Podatke u konkretnom ugovoru možete osvježiti kroz <Link href="/agencija/firme/ugovori">Ugovor i cijena</Link>.</p>
  </div>;
}
