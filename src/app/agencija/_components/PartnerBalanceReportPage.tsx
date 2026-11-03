import { effectiveDefaultAccounts } from "@/lib/posting-template";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { decimalToScaled } from "@/lib/inventory-calculation";
import { requireClientContext } from "@/lib/client-portal";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import {
  invoicePostingDefaultScope,
  invoicePostingDocumentTypes,
  partnerReportAccountPurposes
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { journalStatuses } from "@/lib/journals";
import { hasAllPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type ReportKind = "customers" | "suppliers";
type ReportScope = "domaci" | "ino" | "svi";

type SearchParams = {
  datum_do?: string;
  datum_od?: string;
  partner?: string;
  prikaz?: string;
};

type Props = {
  kind: ReportKind;
  print?: boolean;
  clientType?: "kupci" | "ino-kupci" | "dobavljaci" | "ino-dobavljaci";
  searchParams?: Promise<SearchParams>;
};

type ReportRow = {
  accountId: string;
  accountName: string;
  accountCode: string;
  accountScope: "DOMESTIC" | "FOREIGN";
  partnerId: string;
  partnerName: string;
  partnerTaxNumber: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

const reportConfig = {
  customers: {
    title: "Kupci",
    domesticPurpose: partnerReportAccountPurposes.customers,
    foreignPurpose: partnerReportAccountPurposes.foreignCustomers,
    domesticLabel: "Kupci",
    foreignLabel: "Ino kupci",
    allLabel: "Svi kupci",
    empty: "Nema otvorenih stavki kupaca za izabrane uslove.",
    basePath: "/agencija/izvjestaji/kupci"
  },
  suppliers: {
    title: "Dobavljači",
    domesticPurpose: partnerReportAccountPurposes.suppliers,
    foreignPurpose: partnerReportAccountPurposes.foreignSuppliers,
    domesticLabel: "Dobavljači",
    foreignLabel: "Ino dobavljači",
    allLabel: "Svi dobavljači",
    empty: "Nema otvorenih stavki dobavljača za izabrane uslove.",
    basePath: "/agencija/izvjestaji/dobavljaci"
  }
} as const;

function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toCents(value: { toString(): string }) {
  return Number(decimalToScaled(value, 2));
}

function money(cents: number) {
  return (cents / 100).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function cardHref(row: ReportRow, params?: SearchParams, clientType?: string) {
  const query = new URLSearchParams({
    konto: row.accountId,
    partner: row.partnerId
  });

  if (params?.datum_od) query.set("datum_od", params.datum_od);
  if (params?.datum_do) query.set("datum_do", params.datum_do);

  if (clientType) {
    query.delete("konto");
    return `/klijent/izvjestaji/${clientType}/kartica?${query.toString()}`;
  }
  return `/agencija/izvjestaji/kartice-partnera?${query.toString()}`;
}

function reportScopeHref(
  basePath: string,
  scope: ReportScope,
  params?: SearchParams
) {
  const query = new URLSearchParams({ prikaz: scope });

  if (params?.datum_od) query.set("datum_od", params.datum_od);
  if (params?.datum_do) query.set("datum_do", params.datum_do);
  if (params?.partner?.trim()) query.set("partner", params.partner.trim());

  return `${basePath}?${query.toString()}`;
}

export async function PartnerBalanceReportPage({ kind, searchParams, clientType, print = false }: Props) {
  const client = clientType ? await requireClientContext(["izvjestaji", "nalozi"]) : null;
  const user = client?.user ?? await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = client ? { firmaId: client.firma.id, poslovnaGodinaId: client.year.id } : await readWorkContext();
  const params = await searchParams;
  const config = { ...reportConfig[kind], ...(clientType ? { basePath: `/klijent/izvjestaji/${clientType}`, title: clientType.startsWith("ino-") ? reportConfig[kind].foreignLabel : reportConfig[kind].domesticLabel } : {}) };
  const reportScope: ReportScope =
    clientType ? (clientType.startsWith("ino-") ? "ino" : "domaci") : params?.prikaz === "ino" || params?.prikaz === "svi"
      ? params.prikaz
      : "domaci";
  const showDomestic = reportScope !== "ino";
  const showForeign = reportScope !== "domaci";
  const partnerQuery = params?.partner?.trim() ?? "";
  const dateFrom = parseDate(params?.datum_od);
  const dateTo = parseDate(params?.datum_do);

  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header"><div><h1>{config.title}</h1></div></header>
        <p className="admin-message">Izaberite firmu i poslovnu godinu.</p>
      </div>
    );
  }

  const allowed = await hasAllPermissions(user, [
    { firmaId: context.firmaId, modul: "izvjestaji", akcija: "view" },
    { firmaId: context.firmaId, modul: "nalozi", akcija: "view" }
  ]);

  if (!allowed) {
    return <p className="admin-message">Nemate pravo pregleda ovog izvještaja.</p>;
  }

  const canPrint = !clientType && await hasAllPermissions(user, [
    { firmaId: context.firmaId, modul: "izvjestaji", akcija: "export" }
  ]);
  if (print && !canPrint) return <p className="admin-message">Nemate pravo štampe ovog izvještaja.</p>;

  const [company, year, defaults] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: context.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
      },
      select: { naziv: true, pib: true, adresa: true, grad: true }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: context.poslovnaGodinaId, firma_id: context.firmaId },
      select: { godina: true }
    }),
    effectiveDefaultAccounts(prisma, {
      where: {
        firma_id: context.firmaId,
        namjena: { in: [config.domesticPurpose, config.foreignPurpose] },
        dokument_tip: invoicePostingDocumentTypes.general,
        podvrsta: invoicePostingDefaultScope.subtype,
        pdv_stopa_sifra: invoicePostingDefaultScope.vatRate
      },
      select: { namjena: true, sifra_konta: true }
    })
  ]);

  if (!company || !year) {
    return <p className="admin-message">Izabrani kontekst nije dostupan.</p>;
  }

  const accountByPurpose = new Map(
    defaults.map((item) => [item.namjena, item.sifra_konta])
  );
  const domesticCode = accountByPurpose.get(config.domesticPurpose) ?? null;
  const foreignCode = accountByPurpose.get(config.foreignPurpose) ?? null;
  const selectedAccounts = [
    ...(showDomestic && domesticCode
      ? [{ code: domesticCode, scope: "DOMESTIC" as const, label: config.domesticLabel }]
      : []),
    ...(showForeign && foreignCode
      ? [{ code: foreignCode, scope: "FOREIGN" as const, label: config.foreignLabel }]
      : [])
  ];
  const selectedCodes = [...new Set(selectedAccounts.map((account) => account.code))];
  const scopeByCode = new Map(
    selectedAccounts.map((account) => [account.code, account.scope])
  );

  const lines = selectedCodes.length
    ? await prisma.stavkaNaloga.findMany({
        where: {
          komitent_id: { not: null },
          ...(partnerQuery
            ? {
                komitent: {
                  is: {
                    OR: [
                      { naziv: { contains: partnerQuery, mode: "insensitive" } },
                      { pib: { contains: partnerQuery, mode: "insensitive" } },
                      {
                        foreign_tax_number: {
                          contains: partnerQuery,
                          mode: "insensitive"
                        }
                      }
                    ]
                  }
                }
              }
            : {}),
          firma_konto: { sifra: { in: selectedCodes } },
          nalog: {
            agencija_id: user.agencija_id,
            firma_id: context.firmaId,
            poslovna_godina_id: context.poslovnaGodinaId,
            status: journalStatuses.posted,
            is_deleted: false,
            ...(dateFrom || dateTo
              ? {
                  datum: {
                    ...(dateFrom ? { gte: dateFrom } : {}),
                    ...(dateTo ? { lte: dateTo } : {})
                  }
                }
              : {})
          }
        } satisfies Prisma.StavkaNalogaWhereInput,
        select: {
          duguje: true,
          potrazuje: true,
          firma_konto: { select: { id: true, sifra: true, naziv: true } },
          komitent: {
            select: {
              id: true,
              naziv: true,
              pib: true,
              foreign_tax_number: true
            }
          }
        }
      })
    : [];

  const rows = Array.from(
    lines.reduce((map, line) => {
      if (!line.komitent) return map;

      const key = `${line.firma_konto.id}:${line.komitent.id}`;
      const existing = map.get(key) ?? {
        accountId: line.firma_konto.id,
        accountName: line.firma_konto.naziv,
        accountCode: line.firma_konto.sifra,
        accountScope: scopeByCode.get(line.firma_konto.sifra) ?? "DOMESTIC",
        partnerId: line.komitent.id,
        partnerName: line.komitent.naziv,
        partnerTaxNumber: line.komitent.pib ?? line.komitent.foreign_tax_number,
        debitCents: 0,
        creditCents: 0
      };
      existing.debitCents += toCents(line.duguje);
      existing.creditCents += toCents(line.potrazuje);
      map.set(key, existing);
      return map;
    }, new Map<string, Omit<ReportRow, "balanceCents">>()).values()
  )
    .map((row) => ({
      ...row,
      balanceCents: row.debitCents - row.creditCents
    }))
    .filter((row) => row.balanceCents !== 0)
    .sort(
      (first, second) =>
        first.accountScope.localeCompare(second.accountScope) ||
        Math.abs(second.balanceCents) - Math.abs(first.balanceCents) ||
        first.partnerName.localeCompare(second.partnerName, "sr-Latn")
    );
  const totals = rows.reduce(
    (sum, row) => ({
      debit: sum.debit + row.debitCents,
      credit: sum.credit + row.creditCents,
      debitBalance: sum.debitBalance + Math.max(row.balanceCents, 0),
      creditBalance: sum.creditBalance + Math.max(-row.balanceCents, 0)
    }),
    { debit: 0, credit: 0, debitBalance: 0, creditBalance: 0 }
  );

  const printQuery = new URLSearchParams({ vrsta: kind, prikaz: reportScope });
  if (params?.datum_od) printQuery.set("datum_od", params.datum_od);
  if (params?.datum_do) printQuery.set("datum_do", params.datum_do);
  if (partnerQuery) printQuery.set("partner", partnerQuery);
  const printTitle = reportScope === "ino" ? config.foreignLabel : reportScope === "svi" ? config.allLabel : config.domesticLabel;

  if (print) return (
    <main className="print-page partner-summary-print-page">
      <div className="print-toolbar">
        <Link className="print-button print-back-button" href={reportScopeHref(config.basePath, reportScope, params)}>Nazad na pregled</Link>
        <PrintButton label="Štampaj pregled" />
      </div>
      <article className="partner-summary-print">
        <header>
          <div><strong>{company.naziv}</strong><p>{[company.adresa, company.grad].filter(Boolean).join(", ")}</p><p>PIB: {company.pib}</p></div>
          <div><h1>{printTitle}</h1><p>Poslovna godina: {year.godina}</p><p>{dateFrom || dateTo ? `${dateFrom?.toLocaleDateString("sr-Latn-ME") ?? "Početak godine"} — ${dateTo?.toLocaleDateString("sr-Latn-ME") ?? "Kraj godine"}` : "Cijela poslovna godina"}</p></div>
        </header>
        <div className="partner-summary-print-meta"><span>Konta: {selectedCodes.join(", ") || "Nijesu podešena"}{partnerQuery ? ` · Partner: ${partnerQuery}` : ""}</span><span>{rows.length} otvorenih salda</span></div>
        <table>
          <colgroup><col style={{ width: "19%" }} /><col style={{ width: "33%" }} /><col span={4} style={{ width: "12%" }} /></colgroup>
          <thead><tr><th>Konto</th><th>Partner / PIB</th><th>Duguje</th><th>Potražuje</th><th>Saldo duguje</th><th>Saldo potražuje</th></tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.accountId}:${row.partnerId}`}><td><strong>{row.accountCode}</strong><small>{row.accountName}</small></td><td>{row.partnerName}<small>{row.partnerTaxNumber}</small></td><td>{money(row.debitCents)}</td><td>{money(row.creditCents)}</td><td>{money(Math.max(row.balanceCents, 0))}</td><td>{money(Math.max(-row.balanceCents, 0))}</td></tr>)}{!rows.length ? <tr><td colSpan={6}>{config.empty}</td></tr> : null}</tbody>
          <tfoot><tr><td colSpan={2}>UKUPNO</td><td>{money(totals.debit)}</td><td>{money(totals.credit)}</td><td>{money(totals.debitBalance)}</td><td>{money(totals.creditBalance)}</td></tr></tfoot>
        </table>
        <p className="partner-summary-print-note">Prikazani su samo proknjiženi nalozi u izabranom periodu. Iznosi su u EUR.</p>
      </article>
    </main>
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>{config.title}</h1>
          <p className="muted-text">Pregled otvorenih salda po partnerima.</p>
        </div>
        {canPrint ? <Link className="secondary-button" target="_blank" href={`/stampa/partneri-izvjestaj?${printQuery.toString()}`}>Štampaj pregled</Link> : null}
      </header>

      {clientType && ((showDomestic && !domesticCode) || (showForeign && !foreignCode)) ? <p className="admin-message">Agencija još nije podesila ovaj pregled. Obratite se svom knjigovođi.</p> : null}
      {!clientType && showDomestic && !domesticCode ? (
        <p className="admin-message">
          Konto „{config.domesticLabel}“ nije podešeno. Administrator ga može izabrati u{" "}
          <Link href="/agencija/podesavanja/podrazumijevana-konta">
            Podrazumijevanim kontima
          </Link>.
        </p>
      ) : null}
      {!clientType && showForeign && !foreignCode ? (
        <p className="admin-message">
          Konto „{config.foreignLabel}“ nije podešeno, pa ino partneri nijesu prikazani.
        </p>
      ) : null}

      {!clientType ? <nav className="tabs-row" aria-label={`${config.title} prikaz`}>
        <Link
          className={reportScope === "domaci" ? "tab-link active" : "tab-link"}
          href={reportScopeHref(config.basePath, "domaci", params)}
        >
          {config.domesticLabel}
        </Link>
        <Link
          className={reportScope === "ino" ? "tab-link active" : "tab-link"}
          href={reportScopeHref(config.basePath, "ino", params)}
        >
          {config.foreignLabel}
        </Link>
        <Link
          className={reportScope === "svi" ? "tab-link active" : "tab-link"}
          href={reportScopeHref(config.basePath, "svi", params)}
        >
          {config.allLabel}
        </Link>
      </nav> : null}

      <section className="stats-grid">
        <article className="stat-card"><span>Firma</span><strong>{company.naziv}</strong></article>
        <article className="stat-card"><span>Godina</span><strong>{year.godina}</strong></article>
        <article className="stat-card"><span>Saldo duguje</span><strong>{money(totals.debitBalance)}</strong></article>
        <article className="stat-card"><span>Saldo potražuje</span><strong>{money(totals.creditBalance)}</strong></article>
      </section>

      <section className="admin-card">
        <div className="card-header"><h2>Filteri</h2><span>{rows.length} partnera</span></div>
        <AutoSubmitFilterForm
          action={config.basePath}
          className="admin-form journal-filter-form"
        >
          <input name="prikaz" type="hidden" value={reportScope} />
          <label>
            <span>Partner</span>
            <input
              defaultValue={partnerQuery}
              name="partner"
              placeholder="Naziv, PIB ili ino poreski broj"
              type="search"
            />
          </label>
          <label>
            <span>Datum od</span>
            <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
          </label>
        </AutoSubmitFilterForm>
        {!clientType ? <p className="muted-text">
          Aktivna konta: {selectedAccounts.length
            ? selectedAccounts.map((account) => `${account.label} ${account.code}`).join(" · ")
            : "nijedno konto nije podešeno"}
        </p> : null}
      </section>

      <section className="admin-card">
        <div className="card-header"><h2>Pregled po partnerima</h2><span>Neizmireni saldo</span></div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Vrsta</th>{!clientType ? <th>Konto</th> : null}<th>Partner</th><th>Duguje</th><th>Potražuje</th>
                <th>Saldo duguje</th><th>Saldo potražuje</th><th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.accountId}-${row.partnerId}`}>
                  <td>{row.accountScope === "FOREIGN" ? "Ino" : "Domaći"}</td>
                  {!clientType ? <td>{row.accountCode}<small>{row.accountName}</small></td> : null}
                  <td>{row.partnerName}<small>{row.partnerTaxNumber ?? ""}</small></td>
                  <td>{money(row.debitCents)}</td>
                  <td>{money(row.creditCents)}</td>
                  <td><strong>{money(Math.max(row.balanceCents, 0))}</strong></td>
                  <td><strong>{money(Math.max(-row.balanceCents, 0))}</strong></td>
                  <td><Link className="table-link" href={cardHref(row, params, clientType)}>Kartica</Link></td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={clientType ? 7 : 8}>{config.empty}</td></tr> : null}
            </tbody>
            <tfoot>
              <tr className="balance-total-row">
                <td colSpan={clientType ? 2 : 3}>Ukupno</td><td>{money(totals.debit)}</td><td>{money(totals.credit)}</td>
                <td>{money(totals.debitBalance)}</td><td>{money(totals.creditBalance)}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
