import { saveIncomeStatementSettings } from "../actions";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getIncomeStatementSettings } from "@/lib/financial-reports";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  sacuvano: "Podešavanja Bilansa uspjeha su sačuvana.",
  kontekst: "Izaberite firmu u gornjoj traci.",
  prava: "Nemate pravo za podešavanje završnog računa.",
  prazno: "Nema redova za čuvanje.",
  neispravno: "Podešavanja nisu sačuvana: neki red nema RBR, AOP ili poziciju."
};

export default async function ZavrsniRacunPodesavanjaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireRole("admin_agencije");
  if (!user.agencija_id) return <p>Agencija nije dostupna.</p>;
  const [agencija, settings] = await Promise.all([
    prisma.agencija.findUnique({ where: { id: user.agencija_id }, select: { naziv: true } }),
    getIncomeStatementSettings(user.agencija_id)
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja Bilansa uspjeha</h2>
          <p>
            {agencija?.naziv ?? "Agencija"} ·{" "}
            Povezivanje konta važi za sve firme agencije.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/obrasci">
            Obrasci
          </Link>
        </div>
      </header>

      <div className="tabs-row">
        <Link className="tab-link active" href="/agencija/zavrsni-racun/podesavanja">
          Bilans uspjeha
        </Link>
        <Link className="tab-link" href="/agencija/zavrsni-racun/podesavanja/bilans-stanja">
          Bilans stanja
        </Link>
        <Link className="tab-link" href="/agencija/zavrsni-racun/podesavanja/statisticki-aneks">
          Statistički aneks
        </Link>
      </div>

      {params?.poruka && messages[params.poruka] ? (
        <p className="admin-message">{messages[params.poruka]}</p>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Pozicije i konta</h3>
            <span>
              KJ: konta se unose kao prefiksi odvojeni zarezom. Polje Preskoči izuzima navedene
              prefikse iz obračuna.
            </span>
          </div>
        </div>
        <form action={saveIncomeStatementSettings}>
          <div className="table-wrap">
            <table className="admin-table income-settings-table">
              <thead>
                <tr>
                  <th>RBR</th>
                  <th>AOP</th>
                  <th>Pozicija</th>
                  <th>Opis konta</th>
                  <th>Konta</th>
                  <th>Preskoči</th>
                  <th>Formula</th>
                  <th>Znak</th>
                </tr>
              </thead>
              <tbody>
                {settings.template.pozicije.map((row) => (
                  <tr key={row.id} className={row.bold ? "income-bold-row" : undefined}>
                    <td>
                      {row.rbr}
                      <input name="rbr" type="hidden" value={row.rbr} />
                      <input name="aop" type="hidden" value={row.aop ?? ""} />
                      <input name="pozicija" type="hidden" value={row.pozicija} />
                      <input name="nivo" type="hidden" value={row.nivo} />
                      <input name="grupa" type="hidden" value={row.grupa} />
                      <input name="bold" type="hidden" value={row.bold ? "1" : "0"} />
                      <input name="prikazi" type="hidden" value={row.prikazi ? "1" : "0"} />
                      <input name="rucni_unos" type="hidden" value={row.rucni_unos ? "1" : "0"} />
                    </td>
                    <td>{row.aop}</td>
                    <td>{row.pozicija}</td>
                    <td>
                      <input name="uslov" defaultValue={row.uslov ?? ""} />
                    </td>
                    <td>
                      <input name="konto" defaultValue={row.konto ?? ""} />
                    </td>
                    <td>
                      <input name="preskoci_konta" defaultValue={row.preskoci_konta ?? ""} />
                    </td>
                    <td>
                      <input name="formula" defaultValue={row.formula ?? ""} />
                    </td>
                    <td>
                      <select name="znak" defaultValue={String(row.znak)}>
                        <option value="1">Duguje (+)</option>
                        <option value="-1">Potražuje (+)</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="submit">Sačuvaj za sve firme agencije</button>
          </div>
        </form>
      </section>
    </div>
  );
}
