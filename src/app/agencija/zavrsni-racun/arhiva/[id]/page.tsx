import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    obrazac?: string;
    poruka?: string;
  }>;
};

type ArchivedRow = {
  id?: string;
  rbr?: number;
  uslov?: string | null;
  grupa?: number;
  pozicija?: string;
  aop?: string | null;
  bold?: boolean;
  tekucaGodina?: number;
  prethodnaGodina?: number;
  prethodnaGodinaKraj?: number;
  prethodnaGodinaPocetak?: number;
};

type ArchivedReport = {
  templateSource?: "company" | "system";
  rows?: ArchivedRow[];
};

type FinalAccountSnapshot = {
  generatedAt?: string;
  firma?: {
    naziv?: string;
    pib?: string | null;
  };
  godina?: {
    godina?: number;
    datumOd?: string;
    datumDo?: string;
  };
  reports?: {
    incomeStatement?: ArchivedReport;
    balanceSheet?: ArchivedReport;
    statisticalAnnex?: ArchivedReport;
  };
};

const reportTabs = [
  {
    key: "bilans-stanja",
    label: "Bilans stanja"
  },
  {
    key: "bilans-uspjeha",
    label: "Bilans uspjeha"
  },
  {
    key: "statisticki-aneks",
    label: "Statistički aneks"
  }
] as const;

const messages: Record<string, string> = {
  snimljeno: "Završni račun je snimljen u arhivu."
};

function isObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function snapshotValue(value: Prisma.JsonValue): FinalAccountSnapshot {
  return isObject(value) ? (value as FinalAccountSnapshot) : {};
}

function amount(value: number | undefined) {
  const numberValue = Number(value ?? 0);

  if (Math.abs(numberValue) < 0.005) {
    return "0";
  }

  return Math.round(numberValue).toLocaleString("sr-Latn");
}

function formatDate(value: string | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("sr-Latn-ME");
}

function formatDateTime(value: Date) {
  return value.toLocaleString("sr-Latn-ME", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function rowKey(row: ArchivedRow, index: number) {
  return row.id ?? `${row.aop ?? "row"}-${row.rbr ?? index}-${index}`;
}

function sourceLabel(source: ArchivedReport["templateSource"]) {
  if (source === "company") {
    return "Firma";
  }

  if (source === "system") {
    return "Sistemski";
  }

  return "-";
}

function renderIncomeStatement(rows: ArchivedRow[]) {
  return (
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
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} className={row.bold ? "income-bold-row" : undefined}>
            <td>{row.rbr ?? ""}</td>
            <td>{row.uslov ?? ""}</td>
            <td>{row.pozicija ?? ""}</td>
            <td>{row.aop?.replace(/^A/, "") ?? ""}</td>
            <td>{row.aop ?? ""}</td>
            <td className="num-cell">{amount(row.tekucaGodina)}</td>
            <td className="num-cell">{amount(row.prethodnaGodina)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderBalanceSheet(rows: ArchivedRow[]) {
  return (
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
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} className={row.bold ? "income-bold-row" : undefined}>
            <td>{row.rbr ?? ""}</td>
            <td>{row.uslov ?? ""}</td>
            <td>{row.pozicija ?? ""}</td>
            <td>{row.aop?.replace(/^A/, "") ?? ""}</td>
            <td>{row.aop ?? ""}</td>
            <td className="num-cell">{amount(row.tekucaGodina)}</td>
            <td className="num-cell">{amount(row.prethodnaGodinaKraj)}</td>
            <td className="num-cell">{amount(row.prethodnaGodinaPocetak)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderStatisticalAnnex(rows: ArchivedRow[]) {
  return (
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
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)} className={row.bold ? "income-bold-row" : undefined}>
            <td>{row.rbr ?? ""}</td>
            <td>{row.uslov ?? ""}</td>
            <td>{row.pozicija ?? ""}</td>
            <td>{row.aop ?? ""}</td>
            <td>{row.aop ?? ""}</td>
            <td className="num-cell">{amount(row.tekucaGodina)}</td>
            <td className="num-cell">{amount(row.prethodnaGodina)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ZavrsniRacunArhivaDetaljPage({
  params,
  searchParams
}: PageProps) {
  const routeParams = await params;
  const query = await searchParams;
  const activeReport = reportTabs.some((tab) => tab.key === query?.obrazac)
    ? query?.obrazac
    : "bilans-stanja";
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    notFound();
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "view"
  });

  if (!allowed) {
    notFound();
  }

  const archive = await prisma.finansijskiIzvjestajArhiva.findFirst({
    where: {
      id: routeParams.id,
      agencija_id: user.agencija_id,
      firma_id: workContext.firmaId,
      poslovna_godina_id: workContext.poslovnaGodinaId
    },
    select: {
      id: true,
      naziv: true,
      status: true,
      snapshot: true,
      created_at: true,
      firma: {
        select: {
          naziv: true
        }
      },
      poslovna_godina: {
        select: {
          godina: true
        }
      }
    }
  });

  if (!archive) {
    notFound();
  }

  const snapshot = snapshotValue(archive.snapshot);
  const balanceSheet = snapshot.reports?.balanceSheet ?? {};
  const incomeStatement = snapshot.reports?.incomeStatement ?? {};
  const statisticalAnnex = snapshot.reports?.statisticalAnnex ?? {};
  const activeRows =
    activeReport === "bilans-uspjeha"
      ? incomeStatement.rows ?? []
      : activeReport === "statisticki-aneks"
        ? statisticalAnnex.rows ?? []
        : balanceSheet.rows ?? [];
  const activeSource =
    activeReport === "bilans-uspjeha"
      ? incomeStatement.templateSource
      : activeReport === "statisticki-aneks"
        ? statisticalAnnex.templateSource
        : balanceSheet.templateSource;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{archive.naziv}</h2>
          <p>
            {snapshot.firma?.naziv ?? archive.firma.naziv} ·{" "}
            {snapshot.godina?.godina ?? archive.poslovna_godina.godina} · snimljeno{" "}
            {formatDateTime(archive.created_at)}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/arhiva">
            Arhiva
          </Link>
          <Link className="secondary-button" href="/agencija/zavrsni-racun/obrasci">
            Live obrasci
          </Link>
        </div>
      </header>

      {query?.poruka && messages[query.poruka] ? (
        <p className="admin-message">{messages[query.poruka]}</p>
      ) : null}

      <section className="stats-grid">
        <article className="stat-card">
          <span>Status</span>
          <strong>{archive.status}</strong>
        </article>
        <article className="stat-card">
          <span>Period</span>
          <strong>
            {formatDate(snapshot.godina?.datumOd)} - {formatDate(snapshot.godina?.datumDo)}
          </strong>
        </article>
        <article className="stat-card">
          <span>Šablon</span>
          <strong>{sourceLabel(activeSource)}</strong>
        </article>
        <article className="stat-card">
          <span>Redova</span>
          <strong>{activeRows.length}</strong>
        </article>
      </section>

      <div className="tabs-row">
        {reportTabs.map((tab) => (
          <Link
            key={tab.key}
            className={activeReport === tab.key ? "tab-link active" : "tab-link"}
            href={`/agencija/zavrsni-racun/arhiva/${archive.id}?obrazac=${tab.key}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>
              {activeReport === "bilans-uspjeha"
                ? "ISKAZ O UKUPNOM REZULTATU / BILANS USPJEHA"
                : activeReport === "statisticki-aneks"
                  ? "STATISTIČKI ANEKS"
                  : "ISKAZ O FINANSIJSKOJ POZICIJI / BILANS STANJA"}
            </h3>
            <span>Arhivirani snapshot, bez ponovnog preračuna.</span>
          </div>
        </div>
        <div className="table-wrap">
          {activeReport === "bilans-uspjeha"
            ? renderIncomeStatement(activeRows)
            : activeReport === "statisticki-aneks"
              ? renderStatisticalAnnex(activeRows)
              : renderBalanceSheet(activeRows)}
        </div>
      </section>
    </div>
  );
}
