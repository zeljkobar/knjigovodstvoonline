import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createFiscalClient } from "../actions";

type Props = { searchParams?: Promise<{ poruka?: string }> };

const messages: Record<string, string> = {
  KLIJENT_OBAVEZNA_POLJA: "Izaberite način saradnje i unesite naziv firme i PIB. Agencija je obavezna samo za klijenta agencije.",
  PRISTUP_OBAVEZNA_POLJA: "Za pristup klijenta unesite i korisničko ime i e-mail.",
  AGENCIJA_NIJE_PRONADJENA: "Izabrana agencija nije pronađena.",
  KLIJENT_GRESKA: "Fiskalni klijent nije kreiran. Provjerite PIB, korisničko ime i e-mail."
};

export default async function FiscalClientsPage({ searchParams }: Props) {
  const query = await searchParams;
  const [agencies, companies] = await Promise.all([
    prisma.agencija.findMany({
      where: { aktivan: true, is_deleted: false, is_fiscal_direct_container: false },
      orderBy: { naziv: "asc" },
      select: { id: true, naziv: true, pib: true }
    }),
    prisma.firma.findMany({
      where: { is_deleted: false, fiscalCompanyLink: { isNot: null } },
      orderBy: { created_at: "desc" },
      select: {
        id: true, naziv: true, pib: true,
        agencija: { select: { naziv: true, is_fiscal_direct_container: true } },
        fiscalCompanyLink: { select: { is_suspended: true, onboarding_status: true, fiscal_environment: true } },
        korisnici: {
          where: { access_type: "FISCAL_CLIENT", is_deleted: false },
          select: { korisnik: { select: { korisnicko_ime: true, email: true, aktivan: true } } },
          take: 1
        }
      }
    })
  ]);
  const message = query?.poruka ? messages[query.poruka] ?? query.poruka : null;

  return <div className="admin-stack">
    <header className="admin-header">
      <div>
        <p className="eyebrow">Fiskalna platforma</p>
        <h2>Fiskalni klijenti</h2>
        <p>Dodaj firmu preko knjigovodstvene agencije ili kao direktnog klijenta bez agencije.</p>
      </div>
      <Link className="secondary-link" href="/admin/fiskalizacija">Pregled platforme</Link>
    </header>
    {message ? <p className="admin-message">{message}</p> : null}

    <section className="admin-form-section">
      <h3>Novi fiskalni klijent</h3>
      <p>Za klijenta agencije račune mogu praviti agencija i klijent. Kod direktnog klijenta račune pravi samo klijent i njegovi korisnici.</p>
      <form className="admin-form" action={createFiscalClient}>
        <label><span>Način saradnje</span><select name="client_type" required><option value="AGENCY">Klijent knjigovodstvene agencije</option><option value="DIRECT">Direktni klijent — bez agencije</option></select></label>
        <label><span>Agencija (samo ako ga vodi naša agencija)</span><select name="agencija_id"><option value="">Bez agencije / izaberi agenciju</option>{agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.naziv}{agency.pib ? ` — ${agency.pib}` : ""}</option>)}</select></label>
        <label><span>Puni naziv firme</span><input name="naziv" required /></label>
        <label><span>Skraćeni naziv</span><input name="skraceni_naziv" /></label>
        <label><span>PIB</span><input name="pib" inputMode="numeric" required /></label>
        <label><span>Adresa</span><input name="adresa" /></label>
        <label><span>Grad</span><input name="grad" /></label>
        <label><span><input name="pdv_obveznik" type="checkbox" value="true" /> PDV obveznik</span></label>
        <div><strong>Pristup vlasnika firme (opciono)</strong><small>Ako popuniš oba polja, klijent dobija pozivnicu i pristup samo svojoj firmi.</small></div>
        <label><span>Korisničko ime klijenta</span><input name="korisnicko_ime" /></label>
        <label><span>E-mail klijenta</span><input name="email" type="email" /></label>
        <button type="submit">Dodaj fiskalnog klijenta</button>
      </form>
    </section>

    <section className="admin-panel">
      <div className="panel-header"><h3>Postojeći fiskalni klijenti</h3><span>{companies.length} ukupno</span></div>
      <div className="table-wrap"><table><thead><tr><th>Firma</th><th>Agencija</th><th>Pristup klijenta</th><th>Okruženje</th><th>Status</th><th>Akcija</th></tr></thead><tbody>
        {companies.map((company) => {
          const client = company.korisnici[0]?.korisnik;
          return <tr key={company.id}>
            <td><strong>{company.naziv}</strong><small>PIB {company.pib || "-"}</small></td>
            <td>{company.agencija.is_fiscal_direct_container ? "Direktan klijent — bez agencije" : company.agencija.naziv}</td>
            <td>{client ? <><strong>{client.korisnicko_ime}</strong><small>{client.email} — {client.aktivan ? "aktivan" : "suspendovan"}</small></> : "Nije otvoren"}</td>
            <td>{company.fiscalCompanyLink?.fiscal_environment || "-"}</td>
            <td>{company.fiscalCompanyLink?.is_suspended ? "Suspendovana" : company.fiscalCompanyLink?.onboarding_status || "Nije podešeno"}</td>
            <td><Link className="table-link" href={`/admin/fiskalizacija/${company.id}`}>Otvori podešavanja</Link></td>
          </tr>;
        })}
      </tbody></table></div>
    </section>
  </div>;
}
