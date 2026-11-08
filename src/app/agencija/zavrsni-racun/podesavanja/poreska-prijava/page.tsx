import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { loadTaxAccountSettings } from "@/lib/corporate-tax-accounts-service";
import { taxAccountFields } from "@/lib/corporate-tax-accounts";
import { saveTaxAccounts } from "./actions";

export default async function PoreskaPrijavaPodesavanjaPage({ searchParams }: { searchParams?: Promise<{ greska?: string; sacuvano?: string }> }) {
  const user = await requireRole("admin_agencije");
  if (!user.agencija_id) return <p>Agencija nije dostupna.</p>;
  const settings = await loadTaxAccountSettings(), query = await searchParams;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja poreske prijave</h2>
          <p>{settings.agencyName} · Prijava poreza na dobit. Podešavanja važe za sve firme agencije.</p>
        </div>
      </header>
      <div className="tabs-row">
        <Link className="tab-link" href="/agencija/zavrsni-racun/podesavanja">
          Bilans uspjeha
        </Link>
        <Link className="tab-link" href="/agencija/zavrsni-racun/podesavanja/bilans-stanja">
          Bilans stanja
        </Link>
        <Link className="tab-link" href="/agencija/zavrsni-racun/podesavanja/statisticki-aneks">
          Statistički aneks
        </Link>
        <Link className="tab-link active" href="/agencija/zavrsni-racun/podesavanja/poreska-prijava" aria-current="page">
          Poreska prijava
        </Link>
      </div>
      <section className="admin-panel">
        <h3>Pozicije i konta</h3>
        {query?.greska ? <p role="alert">{query.greska}</p> : null}
        {query?.sacuvano ? <p role="status">Podešavanja su sačuvana.</p> : null}
        <p>Unesite konta ili prefikse odvojene zarezom. Prazno polje ostavlja ručni unos. Računa se neto promet proknjiženih naloga za izabranu godinu, bez početnog stanja i zaključnih knjiženja. Smjer određuje da li uzimamo duguje minus potražuje ili obrnuto; negativan rezultat se svodi na nulu.</p>
        <p>Reprezentacija (19): dio troška iznad 1% prihoda. Članarine (20): dio troška iznad 0,1% prihoda. Ukupni prihodi su neto potražni promet klase 6 za istu godinu. Nova prijava preuzima podešene iznose; već sačuvana se osvježava posebnim dugmetom u prijavi.</p>
        <form action={saveTaxAccounts}>
          <input type="hidden" name="agencyId" value={settings.agencyId} />
          <input type="hidden" name="revision" value={settings.revision} />
          <div className="table-wrap"><table className="admin-table"><thead><tr><th>Pozicija prijave</th><th>Konta / grupe</th><th>Preskoči konta</th><th>Smjer</th></tr></thead><tbody>
            {settings.rules.map(rule => <tr key={rule.key}>
              <td>{taxAccountFields.find(field => field.key === rule.key)!.label}</td>
              <td><input aria-label={`Konta ${rule.key.slice(1)}`} name={`accounts:${rule.key}`} defaultValue={rule.accounts} maxLength={1000} /></td>
              <td><input aria-label={`Preskoči ${rule.key.slice(1)}`} name={`exclude:${rule.key}`} defaultValue={rule.exclude} maxLength={1000} /></td>
              <td><select aria-label={`Smjer ${rule.key.slice(1)}`} name={`side:${rule.key}`} defaultValue={rule.side}><option value="DEBIT">Duguje − potražuje</option><option value="CREDIT">Potražuje − duguje</option></select></td>
            </tr>)}
          </tbody></table></div>
          <div className="form-actions"><button type="submit" className="primary-button">Sačuvaj podešavanja</button></div>
        </form>
      </section>
    </div>
  );
}
