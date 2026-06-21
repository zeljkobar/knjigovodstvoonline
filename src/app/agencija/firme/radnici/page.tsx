import Link from "next/link";
import { assignCompanyAccess, removeCompanyAccess } from "../../actions";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RadniciNaFirmamaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  firma_dodijeljena: "Radnik je dodijeljen firmi.",
  firma_uklonjena: "Radnik je uklonjen sa firme.",
  dodjela_obavezna: "Radnik i firma su obavezni.",
  dodjela_greska: "Dodjela nije uspjela.",
  rola_nevalidna: "Izabrani korisnik nije radnik agencije."
};

export default async function RadniciNaFirmamaPage({
  searchParams
}: RadniciNaFirmamaPageProps) {
  const admin = await requireRole("admin_agencije");
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;

  if (!admin.agencija_id) {
    return null;
  }

  const [firme, radnici, dodjele] = await Promise.all([
    prisma.firma.findMany({
      where: {
        agencija_id: admin.agencija_id,
        is_deleted: false,
        aktivan: true
      },
      orderBy: {
        naziv: "asc"
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    }),
    prisma.korisnik.findMany({
      where: {
        agencija_id: admin.agencija_id,
        rola: "korisnik_agencije",
        is_deleted: false,
        aktivan: true
      },
      orderBy: {
        korisnicko_ime: "asc"
      },
      select: {
        id: true,
        korisnicko_ime: true,
        email: true
      }
    }),
    prisma.korisnikFirma.findMany({
      where: {
        is_deleted: false,
        korisnik: {
          agencija_id: admin.agencija_id,
          rola: "korisnik_agencije",
          is_deleted: false
        },
        firma: {
          agencija_id: admin.agencija_id,
          is_deleted: false
        }
      },
      orderBy: {
        created_at: "desc"
      },
      select: {
        id: true,
        glavni_radnik: true,
        access_type: true,
        firma: {
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        },
        korisnik: {
          select: {
            id: true,
            korisnicko_ime: true,
            email: true,
            prava: {
              select: {
                id: true,
                firma_id: true
              }
            }
          }
        }
      }
    })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Radnici na firmama</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>Dodijeli radnika firmi</h3>
        <form className="admin-form" action={assignCompanyAccess}>
          <input name="return_to" type="hidden" value="/agencija/firme/radnici" />
          <input name="rola" type="hidden" value="korisnik_agencije" />
          <label>
            <span>Firma</span>
            <select name="firma_id" required>
              <option value="">Izaberite firmu</option>
              {firme.map((firma) => (
                <option key={firma.id} value={firma.id}>
                  {firma.naziv}
                  {firma.pib ? ` (${firma.pib})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Radnik</span>
            <select name="korisnik_id" required>
              <option value="">Izaberite radnika</option>
              {radnici.map((radnik) => (
                <option key={radnik.id} value={radnik.id}>
                  {radnik.korisnicko_ime}
                  {radnik.email ? ` (${radnik.email})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="single-checkbox form-checkbox">
            <input name="glavni_radnik" type="checkbox" />
            <span>Glavni radnik</span>
          </label>
          <button type="submit">Dodijeli radnika</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled dodjela</h3>
          <span>{dodjele.length} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Firma</th>
                <th>Radnik</th>
                <th>Uloga</th>
                <th>Prava</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {dodjele.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nema dodijeljenih radnika.</td>
                </tr>
              ) : (
                dodjele.map((dodjela) => {
                  const pravaCount = dodjela.korisnik.prava.filter(
                    (pravo) => pravo.firma_id === dodjela.firma.id
                  ).length;

                  return (
                    <tr key={dodjela.id}>
                      <td>
                        <Link className="inline-link" href={`/agencija/firme/${dodjela.firma.id}`}>
                          {dodjela.firma.naziv}
                        </Link>
                        <small>{dodjela.firma.pib ?? "Bez PIB-a"}</small>
                      </td>
                      <td>
                        <strong>{dodjela.korisnik.korisnicko_ime}</strong>
                        <small>{dodjela.korisnik.email ?? "-"}</small>
                      </td>
                      <td>{dodjela.glavni_radnik ? "Glavni radnik" : "Radnik"}</td>
                      <td>{pravaCount}</td>
                      <td>
                        <div className="table-actions">
                          <Link
                            className="table-link"
                            href={`/agencija/korisnici?korisnik=${dodjela.korisnik.id}&firma=${dodjela.firma.id}`}
                          >
                            Prava
                          </Link>
                          <form action={removeCompanyAccess}>
                            <input name="return_to" type="hidden" value="/agencija/firme/radnici" />
                            <input name="id" type="hidden" value={dodjela.id} />
                            <button className="table-button" type="submit">
                              Ukloni
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
