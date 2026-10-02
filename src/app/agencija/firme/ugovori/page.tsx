import Link from "next/link";
import { saveCompanyContract } from "../../actions";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { ContractPaymentTerms } from "./ContractPaymentTerms";

type UgovoriPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    firma?: string;
  }>;
};

const poruke: Record<string, string> = {
  ugovor_sacuvan: "Ugovor i cijena su sacuvani.",
  ugovor_greska: "Ugovor nije sacuvan. Provjerite podatke.",
  valuta_nevalidna: "Valuta nije validna."
};

const valute = ["EUR", "USD", "GBP", "RSD"];

function dateInputValue(date: Date | null) {
  if (!date) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function decimalValue(value: { toString: () => string } | null) {
  return value?.toString() ?? "";
}

function currencyValue(value: { toString: () => string } | null, currency: string) {
  if (!value) {
    return "-";
  }

  return `${Number(value.toString()).toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;
}

export default async function UgovoriPage({ searchParams }: UgovoriPageProps) {
  const user = await requireRole("admin_agencije");
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const selectedCompanyId = params?.firma ?? "";
  const canManage = user.rola === "admin_agencije";

  if (!user.agencija_id) {
    return null;
  }

  const firme = await prisma.firma.findMany({
    where: {
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(canManage
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    orderBy: {
      naziv: "asc"
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      ugovor: {
        select: {
          id: true,
          datum_zakljucenja: true,
          dan_placanja: true,
          nadlezni_sud: true,
          datum_pocetka: true,
          datum_prestanka: true,
          mjesecna_cijena: true,
          valuta: true,
          rok_placanja_dana: true,
          dan_fakturisanja: true,
          paket: true,
          dodatne_usluge: true,
          dugovanje: true,
          blokiran_zbog_duga: true,
          automatsko_fakturisanje: true,
          faktura_kao_nacrt: true,
          napomena: true
        }
      }
    }
  });

  const selectedCompany = selectedCompanyId ? firme.find((firma) => firma.id === selectedCompanyId) : firme[0];
  const selectedContract = selectedCompany?.ugovor ?? null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Ugovor i cijena</h2>
        </div>
        <Link className="table-link" href="/agencija/firme">
          Lista firmi
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {canManage && selectedCompany ? (
        <section className="admin-form-section">
          <h3>Uredi ugovor</h3>
          <AutoSubmitFilterForm action="/agencija/firme/ugovori" className="admin-form" key={`firma-${selectedCompany.id}`}>
            <label className="form-wide"><span>Firma</span>
              <select name="firma" defaultValue={selectedCompany.id}>
                {firme.map(firma => <option key={firma.id} value={firma.id}>{firma.naziv}{firma.pib ? ` (${firma.pib})` : ""}</option>)}
              </select>
            </label>
          </AutoSubmitFilterForm>
          <p className="muted-text">Ugovor koristi predložak sa 13 članova. Provjerite datume, cijenu bez PDV-a, rok plaćanja i nadležni sud. <Link href={`/agencija/firme/${selectedCompany.id}`}>Podaci firme i izvršni direktor</Link></p>
          <form className="admin-form" action={saveCompanyContract} key={selectedCompany.id}>
            <input type="hidden" name="firma_id" value={selectedCompany.id}/>
            <label><span>Datum zaključenja ugovora</span>
              <input name="datum_zakljucenja" type="date" defaultValue={dateInputValue(selectedContract?.datum_zakljucenja ?? null)}/>
            </label>
            <label>
              <span>Datum početka primjene</span>
              <input
                name="datum_pocetka"
                type="date"
                defaultValue={dateInputValue(selectedContract?.datum_pocetka ?? null)}
              />
            </label>
            <label>
              <span>Datum prestanka</span>
              <input
                name="datum_prestanka"
                type="date"
                defaultValue={dateInputValue(selectedContract?.datum_prestanka ?? null)}
              />
            </label>
            <label>
              <span>Mjesečna cijena bez PDV-a</span>
              <input
                name="mjesecna_cijena"
                inputMode="decimal"
                defaultValue={decimalValue(selectedContract?.mjesecna_cijena ?? null)}
              />
            </label>
            <label>
              <span>Valuta</span>
              <select name="valuta" defaultValue={selectedContract?.valuta ?? "EUR"} required>
                {valute.map((valuta) => (
                  <option key={valuta} value={valuta}>
                    {valuta}
                  </option>
                ))}
              </select>
            </label>
            <ContractPaymentTerms day={selectedContract?.dan_placanja ?? null} days={selectedContract?.rok_placanja_dana ?? null} isNew={!selectedContract}/>
            <label><span>Nadležni sud</span>
              <input name="nadlezni_sud" maxLength={200} defaultValue={selectedContract?.nadlezni_sud ?? "Sud u Baru"}/>
            </label>
            <label>
              <span>Dan fakturisanja</span>
              <input
                name="dan_fakturisanja"
                min="1"
                max="31"
                type="number"
                defaultValue={selectedContract?.dan_fakturisanja ?? ""}
              />
            </label>
            <label>
              <span>Paket</span>
              <input name="paket" defaultValue={selectedContract?.paket ?? ""} />
            </label>
            <label>
              <span>Dugovanje</span>
              <input
                name="dugovanje"
                inputMode="decimal"
                defaultValue={decimalValue(selectedContract?.dugovanje ?? null)}
              />
            </label>
            <label className="single-checkbox form-checkbox">
              <input
                name="automatsko_fakturisanje"
                type="checkbox"
                defaultChecked={selectedContract?.automatsko_fakturisanje ?? false}
              />
              <span>Automatsko fakturisanje</span>
            </label>
            <label className="single-checkbox form-checkbox">
              <input
                name="faktura_kao_nacrt"
                type="checkbox"
                defaultChecked={selectedContract?.faktura_kao_nacrt ?? true}
              />
              <span>Faktura kao nacrt</span>
            </label>
            <label className="single-checkbox form-checkbox">
              <input
                name="blokiran_zbog_duga"
                type="checkbox"
                defaultChecked={selectedContract?.blokiran_zbog_duga ?? false}
              />
              <span>Blokiran zbog duga</span>
            </label>
            <label className="form-wide">
              <span>Dodatne usluge</span>
              <textarea
                name="dodatne_usluge"
                defaultValue={selectedContract?.dodatne_usluge ?? ""}
              />
            </label>
            <label className="form-wide">
              <span>Napomena za ugovor (štampa se)</span>
              <textarea name="napomena" defaultValue={selectedContract?.napomena ?? ""} />
            </label>
            <div className="form-wide">
              <p className="muted-text">Novi ugovor preuzima podatke iz <Link href="/agencija/podesavanja/agencija">Podešavanja → Agencija</Link> i podatke firme. Sačuvani ugovor zadržava podatke ugovornih strana.</p>
              <label className="single-checkbox form-checkbox"><input type="checkbox" name="obnovi_podatke_strana"/><span>Preuzmi sadašnje podatke agencije i klijenta u ovaj ugovor (zamjenjuje ranije sačuvane podatke).</span></label>
            </div>
            <button type="submit">Sacuvaj ugovor</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled ugovora</h3>
          <span>{firme.filter((firma) => firma.ugovor).length} unijeto</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Firma</th>
                <th>Cijena</th>
                <th>Rok</th>
                <th>Paket</th>
                <th>Auto faktura</th>
                <th>Dug</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {firme.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nema firmi za prikaz.</td>
                </tr>
              ) : (
                firme.map((firma) => (
                  <tr key={firma.id}>
                    <td>
                      <Link className="inline-link" href={`/agencija/firme/ugovori?firma=${firma.id}`}>
                        {firma.naziv}
                      </Link>
                      <small>{firma.pib ?? "Bez PIB-a"}</small>
                    </td>
                    <td>{currencyValue(firma.ugovor?.mjesecna_cijena ?? null, firma.ugovor?.valuta ?? "EUR")}</td>
                    <td>
                      {firma.ugovor?.dan_placanja != null
                        ? `Do ${firma.ugovor.dan_placanja}. u mjesecu`
                        : firma.ugovor?.rok_placanja_dana != null ? `${firma.ugovor.rok_placanja_dana} dana` : "-"}
                    </td>
                    <td>{firma.ugovor?.paket ?? "-"}</td>
                    <td>{firma.ugovor?.automatsko_fakturisanje ? "Ukljuceno" : "Iskljuceno"}</td>
                    <td>
                      {firma.ugovor?.blokiran_zbog_duga
                        ? "Blokiran"
                        : currencyValue(firma.ugovor?.dugovanje ?? null, firma.ugovor?.valuta ?? "EUR")}
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={`/stampa/ugovori/${firma.id}`}
                      >
                        Stampa ugovora
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
