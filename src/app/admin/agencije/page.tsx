import { createAgencija, toggleAgencija } from "../actions";
import { Pagination } from "@/components/Pagination";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

type AgencijePageProps = {
  searchParams?: Promise<{
    poruka?: string;
    stranica?: string;
  }>;
};

const poruke: Record<string, string> = {
  agencija_kreirana: "Agencija je kreirana.",
  naziv_obavezan: "Naziv agencije je obavezan.",
  agencija_greska: "Agencija nije sacuvana. Provjerite PIB ili podatke."
};

export default async function AgencijePage({ searchParams }: AgencijePageProps) {
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentPage = Math.max(1, parseInt(params?.stranica ?? "1"));
  const skip = (currentPage - 1) * PAGE_SIZE;

  const [agencije, ukupno] = await Promise.all([
    prisma.agencija.findMany({
      orderBy: {
        naziv: "asc"
      },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        naziv: true,
        pib: true,
        grad: true,
        telefon: true,
        email: true,
        aktivan: true,
        _count: {
          select: {
            firme: true,
            korisnici: true
          }
        }
      }
    }),
    prisma.agencija.count()
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Agencije</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>Nova agencija</h3>
        <form className="admin-form" action={createAgencija}>
          <label>
            <span>Naziv</span>
            <input name="naziv" required />
          </label>
          <label>
            <span>PIB</span>
            <input name="pib" />
          </label>
          <label>
            <span>Grad</span>
            <input name="grad" />
          </label>
          <label>
            <span>Adresa</span>
            <input name="adresa" />
          </label>
          <label>
            <span>Telefon</span>
            <input name="telefon" />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" />
          </label>
          <button type="submit">Sacuvaj agenciju</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Lista agencija</h3>
          <span>{ukupno} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Naziv</th>
                <th>PIB</th>
                <th>Kontakt</th>
                <th>Firmi</th>
                <th>Korisnika</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {agencije.map((agencija) => (
                <tr key={agencija.id}>
                  <td>
                    <strong>{agencija.naziv}</strong>
                    <small>{agencija.grad || "Bez grada"}</small>
                  </td>
                  <td>{agencija.pib || "-"}</td>
                  <td>
                    {agencija.email || agencija.telefon || "-"}
                  </td>
                  <td>{agencija._count.firme}</td>
                  <td>{agencija._count.korisnici}</td>
                  <td>{agencija.aktivan ? "Aktivna" : "Neaktivna"}</td>
                  <td>
                    <form action={toggleAgencija}>
                      <input name="id" type="hidden" value={agencija.id} />
                      <input
                        name="aktivan"
                        type="hidden"
                        value={String(!agencija.aktivan)}
                      />
                      <button className="table-button" type="submit">
                        {agencija.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                      </button>
                    </form>
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
