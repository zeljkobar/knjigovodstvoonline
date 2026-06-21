import Link from "next/link";
import {
  createGlobalAccount,
  toggleGlobalAccount,
  updateGlobalAccount
} from "../../actions";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type GlobalKontniPlanPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    q?: string;
  }>;
};

const poruke: Record<string, string> = {
  konto_kreiran: "Konto je dodato u osnovni kontni plan.",
  konto_sacuvan: "Konto je sacuvano u osnovnom kontnom planu.",
  konto_aktiviran: "Konto je aktivirano u osnovnom kontnom planu.",
  konto_deaktiviran: "Konto je deaktivirano u osnovnom kontnom planu.",
  konto_obavezno: "Sifra i naziv konta su obavezni.",
  konto_postoji: "Konto sa ovom sifrom vec postoji u osnovnom planu.",
  konto_tip_nevalidan: "Tip konta nije validan.",
  konto_greska: "Konto nije sacuvano. Provjerite podatke."
};

function accountTypeLabel(tip: string) {
  return tip === "sinteticko" ? "Sinteticko" : "Analiticko";
}

function balanceLabel(balance: string | null) {
  if (balance === "D") {
    return "Duguje";
  }

  if (balance === "P") {
    return "Potrazuje";
  }

  return "-";
}

export default async function GlobalKontniPlanPage({
  searchParams
}: GlobalKontniPlanPageProps) {
  await requireRole("admin_agencije");
  const params = await searchParams;
  const query = (params?.q ?? "").trim();
  const normalizedQuery = query.toLowerCase();
  const message = params?.poruka ? poruke[params.poruka] : null;

  const accounts = await prisma.konto.findMany({
    where: normalizedQuery
      ? {
          OR: [
            {
              sifra: {
                contains: normalizedQuery
              }
            },
            {
              naziv: {
                contains: normalizedQuery,
                mode: "insensitive"
              }
            }
          ]
        }
      : {},
    orderBy: {
      sifra: "asc"
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      klasa: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true,
      aktivan: true
    }
  });
  const totals = await prisma.konto.groupBy({
    by: ["aktivan"],
    _count: {
      _all: true
    }
  });
  const activeCount = totals.find((item) => item.aktivan)?._count._all ?? 0;
  const inactiveCount = totals.find((item) => !item.aktivan)?._count._all ?? 0;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Osnovni kontni plan</h2>
        </div>
        <Link className="table-link" href="/agencija/firme/kontni-plan">
          Kontni plan firme
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Globalni plan koji firme nasljedjuju</h3>
          <span>
            {activeCount} aktivnih / {inactiveCount} neaktivnih
          </span>
        </div>
        <p className="empty-state">
          Izmjene ovdje mijenjaju osnovni kontni plan za sve firme. Ako treba izmjena
          samo za jednu firmu, koristite ekran Kontni plan firme.
        </p>
        <form className="compact-form account-filter-form" action="/agencija/podesavanja/kontni-plan">
          <label>
            <span>Pretraga</span>
            <input name="q" placeholder="Sifra ili naziv konta" defaultValue={query} />
          </label>
          <button type="submit">Pretrazi</button>
        </form>
      </section>

      <section className="admin-form-section">
        <h3>Dodaj konto u osnovni plan</h3>
        <form className="admin-form" action={createGlobalAccount}>
          <label>
            <span>Sifra konta</span>
            <input name="sifra" placeholder="npr. 2021" required />
          </label>
          <label>
            <span>Naziv konta</span>
            <input name="naziv" required />
          </label>
          <label>
            <span>Tip konta</span>
            <select name="tip_konta" defaultValue="analiticko" required>
              <option value="analiticko">Analiticko</option>
              <option value="sinteticko">Sinteticko</option>
            </select>
          </label>
          <label>
            <span>Sinteticko konto</span>
            <input name="sinteticki_konto" placeholder="opciono" />
          </label>
          <label>
            <span>Normalni saldo</span>
            <select name="normalni_saldo" defaultValue="">
              <option value="">Nije definisano</option>
              <option value="D">Duguje</option>
              <option value="P">Potrazuje</option>
            </select>
          </label>
          <label className="single-checkbox form-checkbox">
            <input name="analitika_obavezna" type="checkbox" />
            <span>Analitika obavezna</span>
          </label>
          <label className="single-checkbox form-checkbox">
            <input name="koristi_radnu_jedinicu" type="checkbox" />
            <span>Radna jedinica</span>
          </label>
          <button type="submit">Dodaj konto</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled osnovnog kontnog plana</h3>
          <span>{accounts.length} prikazano</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sifra</th>
                <th>Naziv i tip</th>
                <th>Saldo</th>
                <th>Analitika</th>
                <th>Status</th>
                <th>Izmjena</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nema konta za prikaz.</td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.sifra}</strong>
                      <small>Klasa {account.klasa ?? account.sifra.slice(0, 1)}</small>
                    </td>
                    <td>
                      {account.naziv}
                      <small>
                        {accountTypeLabel(account.tip_konta)}
                        {account.sinteticki_konto ? ` · roditelj ${account.sinteticki_konto}` : ""}
                      </small>
                    </td>
                    <td>{balanceLabel(account.normalni_saldo)}</td>
                    <td>
                      {account.analitika_obavezna ? "Obavezna" : "-"}
                      {account.koristi_radnu_jedinicu ? <small>Radna jedinica</small> : null}
                    </td>
                    <td>{account.aktivan ? "Aktivno" : "Neaktivno"}</td>
                    <td>
                      <form className="global-account-edit-form" action={updateGlobalAccount}>
                        <input name="konto_id" type="hidden" value={account.id} />
                        <input name="q" type="hidden" value={query} />
                        <label>
                          <span>Naziv</span>
                          <input name="naziv" defaultValue={account.naziv} required />
                        </label>
                        <label>
                          <span>Tip</span>
                          <select name="tip_konta" defaultValue={account.tip_konta}>
                            <option value="analiticko">Analiticko</option>
                            <option value="sinteticko">Sinteticko</option>
                          </select>
                        </label>
                        <label>
                          <span>Roditelj</span>
                          <input
                            name="sinteticki_konto"
                            defaultValue={account.sinteticki_konto ?? ""}
                          />
                        </label>
                        <label>
                          <span>Saldo</span>
                          <select name="normalni_saldo" defaultValue={account.normalni_saldo ?? ""}>
                            <option value="">-</option>
                            <option value="D">Duguje</option>
                            <option value="P">Potrazuje</option>
                          </select>
                        </label>
                        <label className="single-checkbox">
                          <input
                            name="analitika_obavezna"
                            type="checkbox"
                            defaultChecked={account.analitika_obavezna}
                          />
                          <span>Analitika</span>
                        </label>
                        <label className="single-checkbox">
                          <input
                            name="koristi_radnu_jedinicu"
                            type="checkbox"
                            defaultChecked={account.koristi_radnu_jedinicu}
                          />
                          <span>RJ</span>
                        </label>
                        <button className="table-button" type="submit">
                          Sacuvaj
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={toggleGlobalAccount}>
                        <input name="konto_id" type="hidden" value={account.id} />
                        <input name="q" type="hidden" value={query} />
                        <input name="aktivan" type="hidden" value={String(!account.aktivan)} />
                        <button className="table-button" type="submit">
                          {account.aktivan ? "Deaktiviraj" : "Aktiviraj"}
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
