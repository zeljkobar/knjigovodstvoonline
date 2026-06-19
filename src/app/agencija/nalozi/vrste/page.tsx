import { createJournalType } from "../actions";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type VrsteNalogaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  vrsta_kreirana: "Vrsta naloga je kreirana.",
  vrsta_obavezno: "Šifra, naziv i prefiks su obavezni.",
  vrsta_postoji: "Vrsta naloga sa ovom šifrom već postoji.",
  vrsta_greska: "Vrsta naloga nije sačuvana."
};

export default async function VrsteNalogaPage({ searchParams }: VrsteNalogaPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const canManage = user.rola === "admin_agencije";

  if (!user.agencija_id) {
    return null;
  }

  const firme = await prisma.firma.findMany({
      where: {
        agencija_id: user.agencija_id,
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
    });
  const firmIds = firme.map((firma) => firma.id);
  const vrste = await prisma.vrstaNaloga.findMany({
    where: {
      OR: [
        {
          sistemska: true
        },
        {
          agencija_id: user.agencija_id
        },
        {
          firma_id: {
            in: firmIds
          }
        }
      ]
    },
    orderBy: [
      {
        sistemska: "desc"
      },
      {
        naziv: "asc"
      }
    ],
    select: {
      id: true,
      sifra: true,
      naziv: true,
      opis: true,
      prefiks: true,
      sistemska: true,
      aktivan: true,
      firma_id: true
    }
  });

  const firmById = new Map(firme.map((firma) => [firma.id, firma]));

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Nalozi</p>
          <h2>Vrste naloga</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {canManage ? (
        <section className="admin-form-section">
          <h3>Nova vrsta naloga</h3>
          <form action={createJournalType} className="admin-form journal-type-form">
            <label>
              <span>Šifra</span>
              <input name="sifra" placeholder="npr. IZV_LOVCEN" required />
            </label>
            <label>
              <span>Naziv</span>
              <input name="naziv" placeholder="npr. Izvodi Lovćen banka" required />
            </label>
            <label>
              <span>Prefiks</span>
              <input maxLength={12} name="prefiks" placeholder="npr. IZV-LOV" required />
            </label>
            <label>
              <span>Firma</span>
              <select name="firma_id">
                <option value="">Sve firme agencije</option>
                {firme.map((firma) => (
                  <option key={firma.id} value={firma.id}>
                    {firma.naziv}
                    {firma.pib ? ` (${firma.pib})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-wide">
              <span>Opis</span>
              <input name="opis" />
            </label>
            <button type="submit">Dodaj vrstu</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled vrsta naloga</h3>
          <span>{vrste.length} ukupno</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Prefiks</th>
                <th>Nivo</th>
                <th>Status</th>
                <th>Opis</th>
              </tr>
            </thead>
            <tbody>
              {vrste.map((vrsta) => {
                const firma = vrsta.firma_id ? firmById.get(vrsta.firma_id) : null;

                return (
                  <tr key={vrsta.id}>
                    <td>
                      <strong>{vrsta.sifra}</strong>
                    </td>
                    <td>{vrsta.naziv}</td>
                    <td>{vrsta.prefiks ?? "-"}</td>
                    <td>
                      {vrsta.sistemska
                        ? "Sistemska"
                        : firma
                          ? `Firma: ${firma.naziv}`
                          : "Agencija"}
                    </td>
                    <td>{vrsta.aktivan ? "Aktivna" : "Neaktivna"}</td>
                    <td>{vrsta.opis ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
