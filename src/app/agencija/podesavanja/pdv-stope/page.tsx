import {
  createVatRate,
  toggleVatRate,
  updateVatRate
} from "../../actions";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type VatRatesPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    q?: string;
  }>;
};

const poruke: Record<string, string> = {
  pdv_kreirana: "PDV stopa je dodata.",
  pdv_sacuvana: "PDV stopa je sacuvana.",
  pdv_aktivirana: "PDV stopa je aktivirana.",
  pdv_deaktivirana: "PDV stopa je deaktivirana.",
  pdv_obavezno: "Sifra, naziv i procenat su obavezni.",
  pdv_postoji: "PDV stopa sa ovom sifrom vec postoji.",
  pdv_greska: "PDV stopa nije sacuvana. Provjerite podatke.",
  pdv_agencija_nedostaje: "Agencija nije pronadjena."
};

function formatPercent(value: { toString(): string }) {
  const numericValue = Number(value.toString());

  if (!Number.isFinite(numericValue)) {
    return value.toString();
  }

  return numericValue.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function VatRatesPage({ searchParams }: VatRatesPageProps) {
  const admin = await requireRole("admin_agencije");
  const params = await searchParams;
  const query = (params?.q ?? "").trim();
  const normalizedQuery = query.toLowerCase();
  const message = params?.poruka ? poruke[params.poruka] : null;

  if (!admin.agencija_id) {
    return <p className="admin-message">{poruke.pdv_agencija_nedostaje}</p>;
  }

  const rates = await prisma.pdvStopa.findMany({
    where: {
      agencija_id: admin.agencija_id,
      ...(normalizedQuery
        ? {
            OR: [
              {
                sifra: {
                  contains: normalizedQuery,
                  mode: "insensitive" as const
                }
              },
              {
                naziv: {
                  contains: normalizedQuery,
                  mode: "insensitive" as const
                }
              }
            ]
          }
        : {})
    },
    orderBy: [
      {
        redosljed: "asc"
      },
      {
        procenat: "asc"
      },
      {
        naziv: "asc"
      }
    ],
    select: {
      id: true,
      sifra: true,
      naziv: true,
      procenat: true,
      opis: true,
      redosljed: true,
      aktivna: true,
      vazi_od: true,
      vazi_do: true
    }
  });

  const activeCount = rates.filter((rate) => rate.aktivna).length;
  const inactiveCount = rates.length - activeCount;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>PDV stope</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Aktivne stope za KIF/KUF i racune</h3>
          <span>
            {activeCount} aktivnih / {inactiveCount} neaktivnih
          </span>
        </div>
        <p className="empty-state">
          KIF i KUF ce na unosu prikazivati aktivne PDV stope iz ovog sifarnika. Stari
          zapisi ce kasnije pamtiti procenat koji je vazio u trenutku unosa, zato se
          istorija ne gubi kada se stopa promijeni ili deaktivira.
        </p>
        <form className="compact-form account-filter-form" action="/agencija/podesavanja/pdv-stope">
          <label>
            <span>Pretraga</span>
            <input name="q" placeholder="Sifra ili naziv stope" defaultValue={query} />
          </label>
          <button type="submit">Pretrazi</button>
        </form>
      </section>

      <section className="admin-form-section">
        <h3>Dodaj PDV stopu</h3>
        <form className="admin-form" action={createVatRate}>
          <label>
            <span>Sifra</span>
            <input name="sifra" placeholder="npr. PDV_21" required />
          </label>
          <label>
            <span>Naziv</span>
            <input name="naziv" placeholder="Opsta stopa 21%" required />
          </label>
          <label>
            <span>Procenat</span>
            <input name="procenat" inputMode="decimal" placeholder="21,00" required />
          </label>
          <label>
            <span>Redosljed</span>
            <input name="redosljed" type="number" defaultValue={50} />
          </label>
          <label>
            <span>Vazi od</span>
            <input name="vazi_od" type="date" />
          </label>
          <label>
            <span>Vazi do</span>
            <input name="vazi_do" type="date" />
          </label>
          <label className="form-wide">
            <span>Opis</span>
            <input name="opis" placeholder="Kratka napomena za sta se stopa koristi" />
          </label>
          <button type="submit">Dodaj stopu</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled PDV stopa</h3>
          <span>{rates.length} prikazano</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sifra</th>
                <th>Naziv</th>
                <th>Procenat</th>
                <th>Vazenje</th>
                <th>Status</th>
                <th>Izmjena</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nema PDV stopa za prikaz.</td>
                </tr>
              ) : (
                rates.map((rate) => (
                  <tr key={rate.id}>
                    <td>
                      <strong>{rate.sifra}</strong>
                      <small>Redosljed {rate.redosljed}</small>
                    </td>
                    <td>
                      {rate.naziv}
                      {rate.opis ? <small>{rate.opis}</small> : null}
                    </td>
                    <td>{formatPercent(rate.procenat)}%</td>
                    <td>
                      {rate.vazi_od ? inputDate(rate.vazi_od) : "-"}
                      <small>{rate.vazi_do ? `do ${inputDate(rate.vazi_do)}` : "bez kraja"}</small>
                    </td>
                    <td>{rate.aktivna ? "Aktivna" : "Neaktivna"}</td>
                    <td>
                      <form className="global-account-edit-form" action={updateVatRate}>
                        <input name="stopa_id" type="hidden" value={rate.id} />
                        <input name="q" type="hidden" value={query} />
                        <label>
                          <span>Naziv</span>
                          <input name="naziv" defaultValue={rate.naziv} required />
                        </label>
                        <label>
                          <span>Procenat</span>
                          <input
                            name="procenat"
                            inputMode="decimal"
                            defaultValue={rate.procenat.toString()}
                            required
                          />
                        </label>
                        <label>
                          <span>Redosljed</span>
                          <input name="redosljed" type="number" defaultValue={rate.redosljed} />
                        </label>
                        <label>
                          <span>Od</span>
                          <input name="vazi_od" type="date" defaultValue={inputDate(rate.vazi_od)} />
                        </label>
                        <label>
                          <span>Do</span>
                          <input name="vazi_do" type="date" defaultValue={inputDate(rate.vazi_do)} />
                        </label>
                        <label>
                          <span>Opis</span>
                          <input name="opis" defaultValue={rate.opis ?? ""} />
                        </label>
                        <button className="table-button" type="submit">
                          Sacuvaj
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={toggleVatRate}>
                        <input name="stopa_id" type="hidden" value={rate.id} />
                        <input name="q" type="hidden" value={query} />
                        <input name="aktivna" type="hidden" value={String(!rate.aktivna)} />
                        <button className="table-button" type="submit">
                          {rate.aktivna ? "Deaktiviraj" : "Aktiviraj"}
                        </button>
                      </form>
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
