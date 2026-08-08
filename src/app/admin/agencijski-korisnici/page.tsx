import {
  createAgencijskiKorisnik,
  resendAgencijskiPoziv,
  toggleKorisnik
} from "../actions";
import { Pagination } from "@/components/Pagination";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

type AgencijskiKorisniciPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    stranica?: string;
  }>;
};

const poruke: Record<string, string> = {
  pozivnica_poslata: "Pozivnica je poslata korisniku na email.",
  korisnik_obavezno: "Korisnicko ime, email i agencija su obavezni.",
  korisnik_greska: "Korisnik nije sacuvan. Provjerite korisnicko ime ili email.",
  email_greska: "Korisnik je sacuvan, ali email nije poslat. Provjerite SMTP podesavanja.",
  email_nedostaje: "Korisnik nema email adresu za slanje pozivnice."
};

export default async function AgencijskiKorisniciPage({
  searchParams
}: AgencijskiKorisniciPageProps) {
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentPage = Math.max(1, parseInt(params?.stranica ?? "1"));
  const skip = (currentPage - 1) * PAGE_SIZE;

  const [agencije, korisnici, ukupno] = await Promise.all([
    prisma.agencija.findMany({
      where: {
        aktivan: true,
        is_fiscal_direct_container: false
      },
      orderBy: {
        naziv: "asc"
      },
      select: {
        id: true,
        naziv: true
      }
    }),
    prisma.korisnik.findMany({
      where: {
        rola: "admin_agencije",
        agencija: { is_fiscal_direct_container: false }
      },
      orderBy: {
        created_at: "desc"
      },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        korisnicko_ime: true,
        email: true,
        aktivan: true,
        zadnja_prijava_at: true,
        pozivnice: {
          orderBy: {
            created_at: "desc"
          },
          take: 1,
          select: {
            expires_at: true,
            iskorisceno_at: true
          }
        },
        agencija: {
          select: {
            naziv: true
          }
        }
      }
    }),
    prisma.korisnik.count({ where: { rola: "admin_agencije", agencija: { is_fiscal_direct_container: false } } })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Admini agencija</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>Novi admin agencije</h3>
        <form className="admin-form" action={createAgencijskiKorisnik}>
          <label>
            <span>Korisnicko ime</span>
            <input name="korisnicko_ime" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" required type="email" />
          </label>
          <label>
            <span>Agencija</span>
            <select name="agencija_id" required>
              <option value="">Izaberite agenciju</option>
              {agencije.map((agencija) => (
                <option key={agencija.id} value={agencija.id}>
                  {agencija.naziv}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Posalji pozivnicu</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Lista admina agencija</h3>
          <span>{ukupno} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Korisnik</th>
                <th>Email</th>
                <th>Agencija</th>
                <th>Pozivnica</th>
                <th>Zadnja prijava</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {korisnici.map((korisnik) => (
                <tr key={korisnik.id}>
                  <td>{korisnik.korisnicko_ime}</td>
                  <td>{korisnik.email || "-"}</td>
                  <td>{korisnik.agencija?.naziv || "-"}</td>
                  <td>
                    {korisnik.pozivnice[0]?.iskorisceno_at
                      ? "Iskoriscena"
                      : korisnik.pozivnice[0]
                        ? "Poslata"
                        : "Nema"}
                  </td>
                  <td>
                    {korisnik.zadnja_prijava_at
                      ? korisnik.zadnja_prijava_at.toLocaleDateString("sr-Latn")
                      : "-"}
                  </td>
                  <td>{korisnik.aktivan ? "Aktivan" : "Neaktivan"}</td>
                  <td>
                    <div className="table-actions">
                      <form action={toggleKorisnik}>
                        <input name="id" type="hidden" value={korisnik.id} />
                        <input
                          name="aktivan"
                          type="hidden"
                          value={String(!korisnik.aktivan)}
                        />
                        <button className="table-button" type="submit">
                          {korisnik.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                        </button>
                      </form>
                      <form action={resendAgencijskiPoziv}>
                        <input name="id" type="hidden" value={korisnik.id} />
                        <button className="table-button" type="submit">
                          Posalji link
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
          searchParams={params ?? {}}
          total={ukupno}
        />
      </section>
    </div>
  );
}
