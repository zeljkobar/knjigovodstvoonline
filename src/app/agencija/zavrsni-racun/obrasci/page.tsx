import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import {
  calculateBalanceSheet,
  calculateIncomeStatement,
  calculateStatisticalAnnex,
  financialReportTypes,
  type BalanceSheetRow,
  type IncomeStatementRow,
  type ReportCorrectionColumn,
  type StatisticalAnnexRow
} from "@/lib/financial-reports";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { saveFinancialReportCorrections } from "../actions";

type PageProps = {
  searchParams?: Promise<{
    obrazac?: string;
    edit?: string;
    poruka?: string;
  }>;
};

const reportTabs = [
  {
    key: "bilans-stanja",
    label: "Bilans stanja",
    printHref: "/stampa/zavrsni-racun/bilans-stanja"
  },
  {
    key: "bilans-uspjeha",
    label: "Bilans uspjeha",
    printHref: "/stampa/zavrsni-racun/bilans-uspjeha"
  },
  {
    key: "statisticki-aneks",
    label: "Statistički aneks",
    printHref: "/stampa/zavrsni-racun/statisticki-aneks"
  }
] as const;

const messages: Record<string, string> = {
  korekcije_sacuvane: "Ručne korekcije su sačuvane.",
  korekcija_resetovana: "Polje je vraćeno na obračunatu vrijednost.",
  godina_zakljucena: "Poslovna godina je zaključana i korekcije nijesu dozvoljene.",
  kontekst: "Izaberite firmu i poslovnu godinu.",
  prava: "Nemate pravo za izmjenu završnog računa.",
  neispravno: "Korekcija nije ispravna."
};

function amount(value: number) {
  if (Math.abs(value) < 0.005) {
    return "0";
  }

  return Math.round(value).toLocaleString("sr-Latn");
}

function inputAmount(value: number) {
  return String(Math.round(value));
}

function reportHref(report: string, editMode = false) {
  const params = new URLSearchParams({ obrazac: report });

  if (editMode) {
    params.set("edit", "1");
  }

  return `/agencija/zavrsni-racun/obrasci?${params.toString()}`;
}

function canEditRow(
  row: IncomeStatementRow | BalanceSheetRow | StatisticalAnnexRow,
  editMode: boolean
) {
  return editMode && Boolean(row.aop) && !row.formula;
}

function correctionCell({
  row,
  column,
  value,
  editMode
}: {
  row: IncomeStatementRow | BalanceSheetRow | StatisticalAnnexRow;
  column: ReportCorrectionColumn;
  value: number;
  editMode: boolean;
}) {
  const correction = row.manualCorrections[column];

  if (!canEditRow(row, editMode)) {
    return (
      <>
        {amount(value)}
        {correction ? <span className="manual-badge">ručno</span> : null}
      </>
    );
  }

  return (
    <div className="manual-correction-cell">
      <input type="hidden" name="aop" value={row.aop ?? ""} />
      <input type="hidden" name="kolona" value={column} />
      <input type="hidden" name="automatska_vrijednost" value={inputAmount(correction?.automaticValue ?? value)} />
      <input
        className="manual-correction-input"
        name="vrijednost"
        inputMode="decimal"
        defaultValue={inputAmount(value)}
        aria-label={`Korekcija ${row.aop ?? ""} ${column}`}
      />
      {correction ? (
        <button
          className="table-button manual-reset-button"
          type="submit"
          name="reset_key"
          value={`${row.aop}:${column}`}
        >
          Vrati
        </button>
      ) : null}
    </div>
  );
}

export default async function ZavrsniRacunObrasciPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeReport = reportTabs.some((tab) => tab.key === params?.obrazac)
    ? params?.obrazac
    : "bilans-stanja";
  const editMode = params?.edit === "1";
  const activePrintHref =
    reportTabs.find((tab) => tab.key === activeReport)?.printHref ??
    "/stampa/zavrsni-racun/bilans-stanja";
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
            Podešavanja
          </Link>
          <Link className="secondary-button" href={reportHref(activeReport ?? "bilans-stanja", !editMode)}>
            {editMode ? "Pregled" : "Ručne korekcije"}
          </Link>
          <Link className="secondary-button" href={activePrintHref} target="_blank">
            Štampa
          </Link>
        </div>
      </header>

      <div className="tabs-row">
        {reportTabs.map((tab) => (
          <Link
            key={tab.key}
            className={activeReport === tab.key ? "tab-link active" : "tab-link"}
            href={reportHref(tab.key, editMode)}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {params?.poruka && messages[params.poruka] ? (
        <p className="admin-message">{messages[params.poruka]}</p>
      ) : null}

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

      {activeReport === "bilans-uspjeha" ? (
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
        <form action={saveFinancialReportCorrections}>
          <input type="hidden" name="obrazac" value="bilans-uspjeha" />
          <input type="hidden" name="tip_sifra" value={financialReportTypes.incomeStatement} />
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
                    <td className="num-cell">
                      {correctionCell({
                        row,
                        column: "tekuca_godina",
                        value: row.tekucaGodina,
                        editMode
                      })}
                    </td>
                    <td className="num-cell">
                      {correctionCell({
                        row,
                        column: "prethodna_godina",
                        value: row.prethodnaGodina,
                        editMode
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editMode ? (
            <div className="form-actions">
              <button className="primary-button" type="submit">
                Sačuvaj korekcije
              </button>
            </div>
          ) : null}
        </form>
      </section>
      ) : null}

      {activeReport === "bilans-stanja" ? (
      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>ISKAZ O FINANSIJSKOJ POZICIJI / BILANS STANJA</h3>
            <span>Na dan {godina.datum_do.toLocaleDateString("sr-Latn-ME")}</span>
          </div>
        </div>
        <form action={saveFinancialReportCorrections}>
          <input type="hidden" name="obrazac" value="bilans-stanja" />
          <input type="hidden" name="tip_sifra" value={financialReportTypes.balanceSheet} />
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
                  <td className="num-cell">
                    {correctionCell({
                      row,
                      column: "tekuca_godina",
                      value: row.tekucaGodina,
                      editMode
                    })}
                  </td>
                  <td className="num-cell">
                    {correctionCell({
                      row,
                      column: "prethodna_godina_kraj",
                      value: row.prethodnaGodinaKraj,
                      editMode
                    })}
                  </td>
                  <td className="num-cell">
                    {correctionCell({
                      row,
                      column: "prethodna_godina_pocetak",
                      value: row.prethodnaGodinaPocetak,
                      editMode
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          {editMode ? (
            <div className="form-actions">
              <button className="primary-button" type="submit">
                Sačuvaj korekcije
              </button>
            </div>
          ) : null}
        </form>
      </section>
      ) : null}

      {activeReport === "statisticki-aneks" ? (
      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>STATISTIČKI ANEKS</h3>
            <span>Na dan {godina.datum_do.toLocaleDateString("sr-Latn-ME")}</span>
          </div>
        </div>
        <form action={saveFinancialReportCorrections}>
          <input type="hidden" name="obrazac" value="statisticki-aneks" />
          <input type="hidden" name="tip_sifra" value={financialReportTypes.statisticalAnnex} />
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
                  <td className="num-cell">
                    {correctionCell({
                      row,
                      column: "tekuca_godina",
                      value: row.tekucaGodina,
                      editMode
                    })}
                  </td>
                  <td className="num-cell">
                    {correctionCell({
                      row,
                      column: "prethodna_godina",
                      value: row.prethodnaGodina,
                      editMode
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          {editMode ? (
            <div className="form-actions">
              <button className="primary-button" type="submit">
                Sačuvaj korekcije
              </button>
            </div>
          ) : null}
        </form>
      </section>
      ) : null}
    </div>
  );
}
