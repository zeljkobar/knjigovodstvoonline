import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import {
  calculateBalanceSheet,
  calculateIncomeStatement,
  calculateStatisticalAnnex
} from "@/lib/financial-reports";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function amount(value: number) {
  if (Math.abs(value) < 0.005) {
    return "0";
  }

  return Math.round(value).toLocaleString("sr-Latn");
}

export default async function ZavrsniRacunObrasciPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Obrasci završnog računa</h2>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "view"
  });

  if (!allowed) {
    return (
      <div className="admin-stack">
        <section className="admin-card">
          <p className="empty-state">Nemate pravo za pregled završnog računa.</p>
        </section>
      </div>
    );
  }

  const [firma, godina, result] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false
      },
      select: {
        naziv: true,
        pib: true,
        maticni_broj: true,
        sifra_djelatnosti: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true,
        datum_od: true,
        datum_do: true
      }
    }),
    Promise.all([
      calculateIncomeStatement({
        agencijaId: user.agencija_id,
        firmaId: workContext.firmaId,
        poslovnaGodinaId: workContext.poslovnaGodinaId
      }),
      calculateBalanceSheet({
        agencijaId: user.agencija_id,
        firmaId: workContext.firmaId,
        poslovnaGodinaId: workContext.poslovnaGodinaId
      }),
      calculateStatisticalAnnex({
        agencijaId: user.agencija_id,
        firmaId: workContext.firmaId,
        poslovnaGodinaId: workContext.poslovnaGodinaId
      })
    ])
  ]);

  if (!firma || !godina) {
    return null;
  }

  const [incomeResult, balanceResult, annexResult] = result;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Obrasci završnog računa</h2>
          <p>
            {firma.naziv} · {godina.godina}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/podesavanja">
            Podešavanja BU
          </Link>
          <Link
            className="secondary-button"
            href="/agencija/zavrsni-racun/podesavanja/bilans-stanja"
          >
            Podešavanja BS
          </Link>
          <Link
            className="secondary-button"
            href="/agencija/zavrsni-racun/podesavanja/statisticki-aneks"
          >
            Podešavanja SA
          </Link>
          <Link className="secondary-button" href="/stampa/zavrsni-racun/bilans-uspjeha" target="_blank">
            Štampa BU
          </Link>
          <Link className="secondary-button" href="/stampa/zavrsni-racun/bilans-stanja" target="_blank">
            Štampa BS
          </Link>
          <Link
            className="secondary-button"
            href="/stampa/zavrsni-racun/statisticki-aneks"
            target="_blank"
          >
            Štampa SA
          </Link>
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Šablon</span>
          <strong>{incomeResult.templateSource === "company" ? "BU firma" : "BU sistemski"}</strong>
        </article>
        <article className="stat-card">
          <span>Bilans stanja</span>
          <strong>{balanceResult.templateSource === "company" ? "Firma" : "Sistemski"}</strong>
        </article>
        <article className="stat-card">
          <span>Rezultat</span>
          <strong>{amount(incomeResult.rows.find((row) => row.aop === "A260")?.tekucaGodina ?? 0)}</strong>
        </article>
        <article className="stat-card">
          <span>Aktiva / Pasiva</span>
          <strong>
            {amount(balanceResult.rows.find((row) => row.aop === "A046")?.tekucaGodina ?? 0)} /{" "}
            {amount(balanceResult.rows.find((row) => row.aop === "A144")?.tekucaGodina ?? 0)}
          </strong>
        </article>
        <article className="stat-card">
          <span>Statistički aneks</span>
          <strong>{annexResult.rows.length} redova</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>ISKAZ O UKUPNOM REZULTATU / BILANS USPJEHA</h3>
            <span>
              Period {godina.datum_od.toLocaleDateString("sr-Latn-ME")} -{" "}
              {godina.datum_do.toLocaleDateString("sr-Latn-ME")}
            </span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="admin-table income-statement-table">
            <thead>
              <tr>
                <th>RBR</th>
                <th>Opis</th>
                <th>Pozicija</th>
                <th>AOP</th>
                <th>Napomena</th>
                <th>Tekuća godina</th>
                <th>Preth. godina</th>
              </tr>
            </thead>
            <tbody>
              {incomeResult.rows.map((row) => (
                <tr key={row.id} className={row.bold ? "income-bold-row" : undefined}>
                  <td>{row.rbr}</td>
                  <td>{row.uslov ?? ""}</td>
                  <td>{row.pozicija}</td>
                  <td>{row.aop?.replace(/^A/, "") ?? ""}</td>
                  <td>{row.aop ?? ""}</td>
                  <td className="num-cell">{amount(row.tekucaGodina)}</td>
                  <td className="num-cell">{amount(row.prethodnaGodina)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>ISKAZ O FINANSIJSKOJ POZICIJI / BILANS STANJA</h3>
            <span>Na dan {godina.datum_do.toLocaleDateString("sr-Latn-ME")}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="admin-table income-statement-table">
            <thead>
              <tr>
                <th>RBR</th>
                <th>Grupa</th>
                <th>Pozicija</th>
                <th>AOP</th>
                <th>Napomena</th>
                <th>Tekuća godina</th>
                <th>Preth. kraj</th>
                <th>Preth. početak</th>
              </tr>
            </thead>
            <tbody>
              {balanceResult.rows.map((row) => (
                <tr key={row.id} className={row.bold ? "income-bold-row" : undefined}>
                  <td>{row.rbr}</td>
                  <td>{row.uslov ?? ""}</td>
                  <td>{row.pozicija}</td>
                  <td>{row.aop?.replace(/^A/, "") ?? ""}</td>
                  <td>{row.aop ?? ""}</td>
                  <td className="num-cell">{amount(row.tekucaGodina)}</td>
                  <td className="num-cell">{amount(row.prethodnaGodinaKraj)}</td>
                  <td className="num-cell">{amount(row.prethodnaGodinaPocetak)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>STATISTIČKI ANEKS</h3>
            <span>Na dan {godina.datum_do.toLocaleDateString("sr-Latn-ME")}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="admin-table income-statement-table">
            <thead>
              <tr>
                <th>RBR</th>
                <th>Grupa</th>
                <th>Pozicija</th>
                <th>AOP</th>
                <th>Napomena</th>
                <th>Tekuća godina</th>
                <th>Preth. godina</th>
              </tr>
            </thead>
            <tbody>
              {annexResult.rows.map((row) => (
                <tr key={row.id} className={row.bold ? "income-bold-row" : undefined}>
                  <td>{row.rbr}</td>
                  <td>{row.uslov ?? ""}</td>
                  <td>{row.pozicija}</td>
                  <td>{row.aop ?? ""}</td>
                  <td>{row.aop ?? ""}</td>
                  <td className="num-cell">{amount(row.tekucaGodina)}</td>
                  <td className="num-cell">{amount(row.prethodnaGodina)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
