import Link from "next/link";
import { createBusinessYear, toggleBusinessYear } from "../../actions";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type PoslovneGodinePageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  godina_kreirana: "Poslovna godina je otvorena.",
  godina_postoji: "Ova poslovna godina vec postoji.",
  godina_greska: "Poslovna godina nije sacuvana.",
  godina_zakljucena: "Poslovna godina je zakljucena.",
  godina_otvorena: "Poslovna godina je ponovo otvorena."
};

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn");
}

export default async function PoslovneGodinePage({
  searchParams
}: PoslovneGodinePageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentYear = new Date().getFullYear();
  const canManage = user.rola === "admin_agencije";

  if (!user.agencija_id) {
    return null;
  }

  const firme = await prisma.firma.findMany({
    where: {
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(user.rola === "admin_agencije"
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
      }
    }
  });

  const godine = firme.flatMap((firma) =>
    firma.poslovne_godine.map((godina) => ({
      ...godina,
      firma
    }))
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Firme</p>
          <h2>Poslovne godine</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {canManage ? (
        <section className="admin-form-section">
          <h3>Otvori poslovnu godinu</h3>
          <form className="admin-form" action={createBusinessYear}>
            <input
              name="return_to"
              type="hidden"
              value="/agencija/firme/poslovne-godine"
            />
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
              <span>Godina</span>
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
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled poslovnih godina</h3>
          <span>{godine.length} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Firma</th>
                <th>Godina</th>
                <th>Period</th>
                <th>Status</th>
                {canManage ? <th>Akcija</th> : null}
              </tr>
            </thead>
            <tbody>
              {godine.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 5 : 4}>Nema otvorenih poslovnih godina.</td>
                </tr>
              ) : (
                godine.map((godina) => (
                  <tr key={godina.id}>
                    <td>
                      <Link className="inline-link" href={`/agencija/firme/${godina.firma.id}`}>
                        {godina.firma.naziv}
                      </Link>
                      <small>{godina.firma.pib ?? "Bez PIB-a"}</small>
                    </td>
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
                          <input name="return_to" type="hidden" value="/agencija/firme/poslovne-godine" />
                          <input name="firma_id" type="hidden" value={godina.firma.id} />
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
    </div>
  );
}
