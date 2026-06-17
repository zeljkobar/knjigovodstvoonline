import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createBusinessYear,
  toggleBusinessYear,
  updateCompany
} from "../../actions";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type FirmaDetaljPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  firma_kreirana: "Firma je kreirana i poslovna godina je otvorena.",
  firma_sacuvana: "Podaci firme su sacuvani.",
  firma_obavezno: "Naziv firme je obavezan.",
  firma_greska: "Firma nije sacuvana. Provjerite podatke.",
  pib_postoji: "Firma sa ovim PIB-om vec postoji u agenciji.",
  tip_nevalidan: "Tip subjekta nije validan.",
  status_nevalidan: "Status firme nije validan.",
  godina_kreirana: "Poslovna godina je otvorena.",
  godina_postoji: "Ova poslovna godina vec postoji.",
  godina_greska: "Poslovna godina nije sacuvana.",
      godina_zakljucena: "Poslovna godina je zakljucena.",
  godina_otvorena: "Poslovna godina je ponovo otvorena.",
  racun_kreiran: "Bankovni racun je dodat.",
  racun_glavni: "Racun je oznacen kao glavni.",
  racun_aktiviran: "Racun je aktiviran.",
  racun_deaktiviran: "Racun je deaktiviran.",
  ugovor_sacuvan: "Ugovor i cijena su sacuvani."
};

const subjectTypes = [
  ["DOO", "DOO"],
  ["PREDUZETNIK", "Preduzetnik"],
  ["NVO", "NVO"],
  ["PAUSALAC", "Pausalac"],
  ["FIZICKO_LICE", "Fizicko lice"],
  ["DRUGO", "Drugo"]
];

const companyStatuses = [
  ["ACTIVE", "Aktivna"],
  ["INACTIVE", "Neaktivna"],
  ["ARCHIVED", "Arhivirana"],
  ["DEACTIVATED", "Deaktivirana"]
];

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn");
}

function statusLabel(status: string) {
  return companyStatuses.find(([value]) => value === status)?.[1] ?? status;
}

function moneyLabel(value: { toString: () => string } | null, currency: string) {
  if (!value) {
    return "-";
  }

  return `${Number(value.toString()).toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;
}

export default async function FirmaDetaljPage({
  params,
  searchParams
}: FirmaDetaljPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const message = resolvedSearchParams?.poruka
    ? poruke[resolvedSearchParams.poruka]
    : null;
  const currentYear = new Date().getFullYear();

  if (!user.agencija_id) {
    return null;
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      is_deleted: false
    },
    select: {
      id: true,
      naziv: true,
      skraceni_naziv: true,
      tip_subjekta: true,
      pib: true,
      maticni_broj: true,
      pdv_broj: true,
      sifra_djelatnosti: true,
      opis_djelatnosti: true,
      pravna_forma: true,
      status_registracije: true,
      status_firme: true,
      adresa: true,
      opstina: true,
      grad: true,
      drzava: true,
      telefon: true,
      email: true,
      web_sajt: true,
      napomena: true,
      pdv_obveznik: true,
      aktivan: true,
      created_at: true,
      poslovne_godine: {
        orderBy: {
          godina: "desc"
        },
        select: {
          id: true,
          godina: true,
          datum_od: true,
          datum_do: true,
          zakljucena: true
        }
      },
      korisnici: {
        where: {
          is_deleted: false
        },
        select: {
          id: true,
          glavni_radnik: true,
          korisnik: {
            select: {
              korisnicko_ime: true,
              rola: true
            }
          }
        }
      },
      bankovni_racuni: {
        where: {
          is_deleted: false
        },
        orderBy: [{ glavni: "desc" }, { naziv_banke: "asc" }],
        select: {
          id: true,
          naziv_banke: true,
          broj_racuna: true,
          valuta: true,
          glavni: true,
          aktivan: true
        }
      },
      ugovor: {
        select: {
          mjesecna_cijena: true,
          valuta: true,
          rok_placanja_dana: true,
          dan_fakturisanja: true,
          paket: true,
          automatsko_fakturisanje: true,
          blokiran_zbog_duga: true
        }
      }
    }
  });

  if (!firma) {
    notFound();
  }

  const canManage = user.rola === "admin_agencije";

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Firma</p>
          <h2>{firma.naziv}</h2>
        </div>
        <div className="table-actions">
          <Link className="table-link" href="/agencija/firme">
            Lista firmi
          </Link>
          {canManage ? (
            <Link className="primary-link" href="/agencija/firme/nova">
              Dodaj firmu
            </Link>
          ) : null}
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="metric-grid">
        <div className="metric">
          <span>PIB</span>
          <strong className="metric-text">{firma.pib ?? "-"}</strong>
        </div>
        <div className="metric">
          <span>Poslovne godine</span>
          <strong>{firma.poslovne_godine.length}</strong>
        </div>
        <div className="metric">
          <span>Status</span>
          <strong className="metric-text">{statusLabel(firma.status_firme)}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Bankovni racuni</h3>
          <Link className="table-link" href={`/agencija/firme/bankovni-racuni?firma=${firma.id}`}>
            Uredi racune
          </Link>
        </div>

        {firma.bankovni_racuni.length === 0 ? (
          <p className="empty-state">Firma jos nema unesene bankovne racune.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Banka</th>
                  <th>Broj racuna</th>
                  <th>Valuta</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {firma.bankovni_racuni.map((racun) => (
                  <tr key={racun.id}>
                    <td>
                      <strong>{racun.naziv_banke}</strong>
                    </td>
                    <td>{racun.broj_racuna}</td>
                    <td>{racun.valuta}</td>
                    <td>{racun.glavni ? "Glavni" : racun.aktivan ? "Aktivan" : "Neaktivan"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Ugovor i cijena</h3>
          <Link className="table-link" href={`/agencija/firme/ugovori?firma=${firma.id}`}>
            Uredi ugovor
          </Link>
        </div>

        {firma.ugovor ? (
          <dl className="detail-list">
            <div>
              <dt>Mjesecna cijena</dt>
              <dd>{moneyLabel(firma.ugovor.mjesecna_cijena, firma.ugovor.valuta)}</dd>
            </div>
            <div>
              <dt>Rok placanja</dt>
              <dd>
                {firma.ugovor.rok_placanja_dana
                  ? `${firma.ugovor.rok_placanja_dana} dana`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>Dan fakturisanja</dt>
              <dd>{firma.ugovor.dan_fakturisanja ?? "-"}</dd>
            </div>
            <div>
              <dt>Paket</dt>
              <dd>{firma.ugovor.paket ?? "-"}</dd>
            </div>
            <div>
              <dt>Automatsko fakturisanje</dt>
              <dd>{firma.ugovor.automatsko_fakturisanje ? "Ukljuceno" : "Iskljuceno"}</dd>
            </div>
            <div>
              <dt>Status duga</dt>
              <dd>{firma.ugovor.blokiran_zbog_duga ? "Blokiran zbog duga" : "Aktivan"}</dd>
            </div>
          </dl>
        ) : (
          <p className="empty-state">Ugovor i cijena jos nisu uneseni.</p>
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Osnovni podaci</h3>
          <span>{firma.pdv_obveznik ? "PDV obveznik" : "Nije PDV obveznik"}</span>
        </div>

        {canManage ? (
          <form className="admin-form company-form" action={updateCompany}>
            <input name="firma_id" type="hidden" value={firma.id} />
            <label>
              <span>Naziv firme</span>
              <input name="naziv" required defaultValue={firma.naziv} />
            </label>
            <label>
              <span>Skraceni naziv</span>
              <input name="skraceni_naziv" defaultValue={firma.skraceni_naziv ?? ""} />
            </label>
            <label>
              <span>Tip subjekta</span>
              <select name="tip_subjekta" defaultValue={firma.tip_subjekta} required>
                {subjectTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status firme</span>
              <select name="status_firme" defaultValue={firma.status_firme} required>
                {companyStatuses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>PIB</span>
              <input name="pib" inputMode="numeric" defaultValue={firma.pib ?? ""} />
            </label>
            <label>
              <span>PDV broj</span>
              <input name="pdv_broj" defaultValue={firma.pdv_broj ?? ""} />
            </label>
            <label>
              <span>Maticni broj</span>
              <input name="maticni_broj" defaultValue={firma.maticni_broj ?? ""} />
            </label>
            <label>
              <span>Pravna forma</span>
              <input name="pravna_forma" defaultValue={firma.pravna_forma ?? ""} />
            </label>
            <label>
              <span>Sifra djelatnosti</span>
              <input
                name="sifra_djelatnosti"
                defaultValue={firma.sifra_djelatnosti ?? ""}
              />
            </label>
            <label>
              <span>Opis djelatnosti</span>
              <input
                name="opis_djelatnosti"
                defaultValue={firma.opis_djelatnosti ?? ""}
              />
            </label>
            <label>
              <span>Status registracije</span>
              <input
                name="status_registracije"
                defaultValue={firma.status_registracije ?? ""}
              />
            </label>
            <label>
              <span>Adresa</span>
              <input name="adresa" defaultValue={firma.adresa ?? ""} />
            </label>
            <label>
              <span>Opstina</span>
              <input name="opstina" defaultValue={firma.opstina ?? ""} />
            </label>
            <label>
              <span>Grad</span>
              <input name="grad" defaultValue={firma.grad ?? ""} />
            </label>
            <label>
              <span>Drzava</span>
              <input name="drzava" defaultValue={firma.drzava ?? "Crna Gora"} />
            </label>
            <label>
              <span>Telefon</span>
              <input name="telefon" defaultValue={firma.telefon ?? ""} />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" defaultValue={firma.email ?? ""} />
            </label>
            <label>
              <span>Web sajt</span>
              <input name="web_sajt" defaultValue={firma.web_sajt ?? ""} />
            </label>
            <label className="single-checkbox form-checkbox">
              <input
                name="pdv_obveznik"
                type="checkbox"
                defaultChecked={firma.pdv_obveznik}
              />
              <span>PDV obveznik</span>
            </label>
            <label className="form-wide">
              <span>Napomena</span>
              <textarea name="napomena" defaultValue={firma.napomena ?? ""} />
            </label>
            <button type="submit">Sacuvaj podatke</button>
          </form>
        ) : (
          <dl className="detail-list">
            <div>
              <dt>Tip subjekta</dt>
              <dd>{firma.tip_subjekta}</dd>
            </div>
            <div>
              <dt>Adresa</dt>
              <dd>{[firma.adresa, firma.grad].filter(Boolean).join(", ") || "-"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{firma.email ?? "-"}</dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>{firma.telefon ?? "-"}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Poslovne godine</h3>
          <span>{firma.poslovne_godine.length} ukupno</span>
        </div>

        {canManage ? (
          <form className="compact-form business-year-form" action={createBusinessYear}>
            <input name="firma_id" type="hidden" value={firma.id} />
            <label>
              <span>Nova poslovna godina</span>
              <input
                defaultValue={currentYear}
                max={currentYear + 5}
                min="2000"
                name="poslovna_godina"
                required
                type="number"
              />
            </label>
            <button type="submit">Otvori godinu</button>
          </form>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Godina</th>
                <th>Period</th>
                <th>Status</th>
                {canManage ? <th>Akcija</th> : null}
              </tr>
            </thead>
            <tbody>
              {firma.poslovne_godine.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 4 : 3}>Nema otvorenih poslovnih godina.</td>
                </tr>
              ) : (
                firma.poslovne_godine.map((godina) => (
                  <tr key={godina.id}>
                    <td>
                      <strong>{godina.godina}</strong>
                    </td>
                    <td>
                      {formatDate(godina.datum_od)} - {formatDate(godina.datum_do)}
                    </td>
                    <td>{godina.zakljucena ? "Zakljucena" : "Otvorena"}</td>
                    {canManage ? (
                      <td>
                        <form action={toggleBusinessYear}>
                          <input name="firma_id" type="hidden" value={firma.id} />
                          <input name="godina_id" type="hidden" value={godina.id} />
                          <input
                            name="zakljucena"
                            type="hidden"
                            value={String(!godina.zakljucena)}
                          />
                          <button className="table-button" type="submit">
                            {godina.zakljucena ? "Otkljucaj" : "Zakljucaj"}
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Korisnici na firmi</h3>
          <span>{firma.korisnici.length} ukupno</span>
        </div>

        {firma.korisnici.length === 0 ? (
          <p className="empty-state">Firma jos nema dodijeljene radnike ili klijente.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Korisnik</th>
                  <th>Tip</th>
                  <th>Uloga na firmi</th>
                </tr>
              </thead>
              <tbody>
                {firma.korisnici.map((dodjela) => (
                  <tr key={dodjela.id}>
                    <td>{dodjela.korisnik.korisnicko_ime}</td>
                    <td>{dodjela.korisnik.rola}</td>
                    <td>{dodjela.glavni_radnik ? "Glavni radnik" : "Pristup"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
