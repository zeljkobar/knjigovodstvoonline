import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type AktivnostiPageProps = {
  searchParams?: Promise<{
    akcija?: string;
    firma?: string;
    korisnik?: string;
    modul?: string;
    od?: string;
    do?: string;
  }>;
};

type ActivityCategory = "created" | "updated" | "posted" | "deleted" | "other";

const moduleLabels: Record<string, string> = {
  "agencija.bankovni_racuni": "Bankovni računi",
  "agencija.dodjele": "Dodjele firmi",
  "agencija.firme": "Firme",
  "agencija.izvodi": "Izvodi",
  "agencija.kontni_plan": "Kontni plan",
  "agencija.nalozi": "Nalozi",
  "agencija.partneri": "Partneri",
  "agencija.poslovne_godine": "Poslovne godine",
  "agencija.prava": "Prava korisnika",
  "agencija.racuni.kif": "KIF",
  "agencija.racuni.kuf": "KUF",
  "agencija.racuni.podesavanja": "Podešavanja KIF/KUF",
  "agencija.ugovori": "Ugovori",
  "agencija.vrste_naloga": "Vrste naloga",
  auth: "Prijava",
  izvodi: "Izvodi",
  kalkulacije: "Kalkulacije",
  nalozi: "Nalozi",
  pdv: "PDV",
  plate: "Plate",
  pos: "POS / Kasa",
  racuni: "KIF/KUF",
  robno: "Robno",
  ulazni_racuni: "Ulazni računi",
  izlazni_racuni: "Izlazni računi",
  zavrsni_racun: "Završni račun"
};

const actionLabels: Record<string, string> = {
  create_journal: "Kreiran nalog",
  update_journal: "Izmijenjen nalog",
  post_journal: "Proknjižen nalog",
  delete_journal: "Obrisan nalog",
  create_inventory_calculation: "Kreirana kalkulacija",
  post_inventory_calculation: "Proknjižena kalkulacija",
  import_bank_statement: "Uvezen izvod",
  post_bank_statement: "Proknjižen izvod",
  create_payroll_calculation: "Kreiran obračun plate",
  post_payroll_calculation: "Proknjižen obračun plate",
  prijava_sacuvana: "Sačuvana PDV prijava",
  prijava_proknjizena: "Proknjižena PDV prijava"
};

function businessDateValue(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Podgorica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function validDateValue(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : fallback;
}

function dateFromValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Podgorica"
  });
}

function formatDateTime(value: Date) {
  return value.toLocaleString("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Podgorica"
  });
}

function humanize(value: string) {
  const translated = actionLabels[value];

  if (translated) {
    return translated;
  }

  let words = value.replace(/[._-]+/g, " ").trim().toLowerCase();
  const phrases: Array<[RegExp, string]> = [
    [/inventory price adjustment/g, "nivelacija cijena"],
    [/inventory write off/g, "otpis robe"],
    [/stock count/g, "popis robe"],
    [/outgoing invoice/g, "izlazni račun"],
    [/fiscal invoice/g, "fiskalni račun"],
    [/payroll worker/g, "radnik u obračunu"],
    [/payroll line/g, "stavka obračuna"],
    [/payroll/g, "obračun plate"],
    [/calculation line/g, "stavka kalkulacije"],
    [/calculation/g, "kalkulacija"],
    [/posting settings/g, "podešavanja knjiženja"],
    [/posting scheme/g, "šema knjiženja"],
    [/posting rule/g, "pravilo knjiženja"],
    [/permission matrix/g, "matrica prava"],
    [/bank settings/g, "podešavanja izvoda"],
    [/journal/g, "nalog"],
    [/employee/g, "zaposleni"],
    [/item price/g, "cijena artikla"],
    [/item/g, "artikal"],
    [/warehouse/g, "magacin"],
    [/company/g, "firma"],
    [/book/g, "knjiga"]
  ];

  for (const [pattern, replacement] of phrases) {
    words = words.replace(pattern, replacement);
  }

  const prefixes: Array<[string, string]> = [
    ["quick create ", "Brzo kreirano"],
    ["create ", "Kreirano"],
    ["add ", "Dodato"],
    ["update ", "Izmijenjeno"],
    ["save ", "Sačuvano"],
    ["post ", "Proknjiženo"],
    ["delete ", "Obrisano"],
    ["remove ", "Uklonjeno"],
    ["import ", "Uvezeno"],
    ["set ", "Podešeno"],
    ["activate", "Aktivirano"],
    ["deactivate", "Deaktivirano"],
    ["reopen", "Vraćeno u nacrt"],
    ["finalize ", "Završeno"],
    ["prepare ", "Pripremljeno"]
  ];

  for (const [prefix, label] of prefixes) {
    if (words === prefix.trim()) {
      return label;
    }

    if (words.startsWith(prefix)) {
      return `${label}: ${words.slice(prefix.length)}`;
    }
  }

  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Aktivnost";
}

function moduleLabel(value: string) {
  return moduleLabels[value] ?? humanize(value);
}

function activityCategory(action: string): ActivityCategory {
  const value = action.toLowerCase();

  if (/(delete|remove|obris|uklon|cancel|storn|ponist|reverse)/.test(value)) {
    return "deleted";
  }

  if (/(post|knjiz|fiscaliz|obracunat|calculate_payroll|complete|finalize|zavrsen)/.test(value)) {
    return "posted";
  }

  if (/(create|add|import|upload|generate|kreir|dodat|unesen)/.test(value)) {
    return "created";
  }

  if (/(update|save|edit|change|izmijen|sacuv|refresh|assign|toggle|activate|deactivate|reopen|set_)/.test(value)) {
    return "updated";
  }

  return "other";
}

function workerLabel(user: { korisnicko_ime: string; email: string | null }) {
  return user.email ? `${user.korisnicko_ime} · ${user.email}` : user.korisnicko_ime;
}

function filterLink(
  current: Record<string, string>,
  changes: Record<string, string | null>
) {
  const query = new URLSearchParams(current);

  for (const [key, value] of Object.entries(changes)) {
    if (value) {
      query.set(key, value);
    } else {
      query.delete(key);
    }
  }

  return `/agencija/aktivnosti${query.size ? `?${query.toString()}` : ""}`;
}

export default async function AktivnostiRadnikaPage({
  searchParams
}: AktivnostiPageProps) {
  const admin = await requireRole("admin_agencije");
  const params = (await searchParams) ?? {};

  if (!admin.agencija_id) {
    return null;
  }

  const today = businessDateValue();
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStartDate = dateFromValue(today);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  let fromValue = validDateValue(params.od, monthStart);
  let toValue = validDateValue(params.do, today);

  if (fromValue > toValue) {
    [fromValue, toValue] = [toValue, fromValue];
  }

  const [workers, companies, moduleOptions, actionOptions] = await Promise.all([
    prisma.korisnik.findMany({
      where: {
        agencija_id: admin.agencija_id,
        rola: { in: ["admin_agencije", "korisnik_agencije"] }
      },
      orderBy: [{ rola: "asc" }, { korisnicko_ime: "asc" }],
      select: {
        id: true,
        korisnicko_ime: true,
        email: true,
        rola: true,
        aktivan: true,
        is_deleted: true
      }
    }),
    prisma.firma.findMany({
      where: { agencija_id: admin.agencija_id },
      orderBy: { naziv: "asc" },
      select: { id: true, naziv: true, pib: true, is_deleted: true }
    }),
    prisma.aktivnostDogadjaj.findMany({
      where: { agencija_id: admin.agencija_id },
      distinct: ["modul"],
      orderBy: { modul: "asc" },
      select: { modul: true }
    }),
    prisma.aktivnostDogadjaj.findMany({
      where: { agencija_id: admin.agencija_id },
      distinct: ["akcija"],
      orderBy: { akcija: "asc" },
      select: { akcija: true }
    })
  ]);

  const workerIds = new Set(workers.map((worker) => worker.id));
  const companyIds = new Set(companies.map((company) => company.id));
  const modules = new Set(moduleOptions.map((item) => item.modul));
  const actions = new Set(actionOptions.map((item) => item.akcija));
  const selectedWorkerId = params.korisnik && workerIds.has(params.korisnik) ? params.korisnik : "";
  const selectedCompanyId = params.firma && companyIds.has(params.firma) ? params.firma : "";
  const selectedModule = params.modul && modules.has(params.modul) ? params.modul : "";
  const selectedAction = params.akcija && actions.has(params.akcija) ? params.akcija : "";
  const where: Prisma.AktivnostDogadjajWhereInput = {
    agencija_id: admin.agencija_id,
    korisnik_id: selectedWorkerId || { not: null },
    activity_date: {
      gte: dateFromValue(fromValue),
      lte: dateFromValue(toValue)
    },
    ...(selectedCompanyId ? { firma_id: selectedCompanyId } : {}),
    ...(selectedModule ? { modul: selectedModule } : {}),
    ...(selectedAction ? { akcija: selectedAction } : {})
  };

  const [grouped, companyGroups, lastActivities, dailyGroups, recentActivities] =
    await Promise.all([
      prisma.aktivnostDogadjaj.groupBy({
        by: ["korisnik_id", "modul", "akcija"],
        where,
        _count: { _all: true }
      }),
      prisma.aktivnostDogadjaj.groupBy({
        by: ["korisnik_id", "firma_id"],
        where: { ...where, firma_id: { not: null } },
        _count: { _all: true }
      }),
      prisma.aktivnostDogadjaj.groupBy({
        by: ["korisnik_id"],
        where,
        _max: { created_at: true }
      }),
      prisma.aktivnostDogadjaj.groupBy({
        by: ["activity_date"],
        where,
        orderBy: { activity_date: "asc" },
        _count: { _all: true }
      }),
      prisma.aktivnostDogadjaj.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: 100,
        include: {
          korisnik: {
            select: { korisnicko_ime: true, email: true, rola: true }
          },
          firma: {
            select: { naziv: true, pib: true }
          }
        }
      })
    ]);

  const summaries = new Map<
    string,
    {
      total: number;
      created: number;
      updated: number;
      posted: number;
      deleted: number;
      modules: Map<string, number>;
    }
  >();

  for (const item of grouped) {
    if (!item.korisnik_id) {
      continue;
    }

    const summary = summaries.get(item.korisnik_id) ?? {
      total: 0,
      created: 0,
      updated: 0,
      posted: 0,
      deleted: 0,
      modules: new Map<string, number>()
    };
    const count = item._count._all;
    const category = activityCategory(item.akcija);

    summary.total += count;
    summary.modules.set(item.modul, (summary.modules.get(item.modul) ?? 0) + count);

    if (category !== "other") {
      summary[category] += count;
    }

    summaries.set(item.korisnik_id, summary);
  }

  const firmsByWorker = new Map<string, number>();

  for (const item of companyGroups) {
    if (item.korisnik_id && item.firma_id) {
      firmsByWorker.set(item.korisnik_id, (firmsByWorker.get(item.korisnik_id) ?? 0) + 1);
    }
  }

  const lastByWorker = new Map(
    lastActivities
      .filter((item) => item.korisnik_id)
      .map((item) => [item.korisnik_id!, item._max.created_at])
  );
  const visibleWorkers = workers
    .filter((worker) => !selectedWorkerId || worker.id === selectedWorkerId)
    .sort((left, right) => (summaries.get(right.id)?.total ?? 0) - (summaries.get(left.id)?.total ?? 0));
  const totals = [...summaries.values()].reduce(
    (result, item) => ({
      total: result.total + item.total,
      created: result.created + item.created,
      updated: result.updated + item.updated,
      posted: result.posted + item.posted,
      deleted: result.deleted + item.deleted
    }),
    { total: 0, created: 0, updated: 0, posted: 0, deleted: 0 }
  );
  const distinctCompanies = new Set(
    companyGroups.map((item) => item.firma_id).filter((id): id is string => Boolean(id))
  ).size;
  const modulesSummary = new Map<string, number>();

  for (const summary of summaries.values()) {
    for (const [module, count] of summary.modules) {
      modulesSummary.set(module, (modulesSummary.get(module) ?? 0) + count);
    }
  }

  const topModules = [...modulesSummary.entries()].sort((left, right) => right[1] - left[1]);
  const maxDailyCount = Math.max(1, ...dailyGroups.map((item) => item._count._all));
  const chartDays = dailyGroups.slice(-31);
  const currentFilters = {
    od: fromValue,
    do: toValue,
    ...(selectedCompanyId ? { firma: selectedCompanyId } : {}),
    ...(selectedModule ? { modul: selectedModule } : {}),
    ...(selectedAction ? { akcija: selectedAction } : {})
  };

  return (
    <div className="admin-stack activity-page">
      <header className="admin-header">
        <div>
          <h2>Aktivnosti radnika</h2>
          <p className="muted-text">
            Stvarne poslovne akcije evidentirane u periodu {formatDate(dateFromValue(fromValue))}–{formatDate(dateFromValue(toValue))}
          </p>
        </div>
      </header>

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>Filteri statistike</h3>
          <span>Samo admin agencije</span>
        </div>
        <div className="activity-quick-filters" aria-label="Brzi periodi">
          <Link href={filterLink(currentFilters, { od: today, do: today })}>Danas</Link>
          <Link href={filterLink(currentFilters, { od: weekStart, do: today })}>Posljednjih 7 dana</Link>
          <Link href={filterLink(currentFilters, { od: monthStart, do: today })}>Ovaj mjesec</Link>
        </div>
        <form className="admin-form activity-filter-form" method="get">
          <label>
            <span>Datum od</span>
            <input defaultValue={fromValue} name="od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={toValue} name="do" type="date" />
          </label>
          <label>
            <span>Radnik</span>
            <select defaultValue={selectedWorkerId} name="korisnik">
              <option value="">Svi radnici i admini</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.korisnicko_ime}{worker.rola === "admin_agencije" ? " — admin" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Firma</span>
            <select defaultValue={selectedCompanyId} name="firma">
              <option value="">Sve firme</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.naziv}{company.is_deleted ? " — obrisana" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Modul</span>
            <select defaultValue={selectedModule} name="modul">
              <option value="">Svi moduli</option>
              {moduleOptions.map((item) => (
                <option key={item.modul} value={item.modul}>{moduleLabel(item.modul)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Akcija</span>
            <select defaultValue={selectedAction} name="akcija">
              <option value="">Sve akcije</option>
              {actionOptions.map((item) => (
                <option key={item.akcija} value={item.akcija}>{humanize(item.akcija)}</option>
              ))}
            </select>
          </label>
          <div className="activity-filter-actions">
            <button type="submit">Prikaži</button>
            <Link className="secondary-button" href="/agencija/aktivnosti">Poništi</Link>
          </div>
        </form>
      </section>

      <section className="metric-grid activity-metric-grid" aria-label="Zbir aktivnosti">
        <article className="metric"><span>Ukupno aktivnosti</span><strong>{totals.total}</strong></article>
        <article className="metric"><span>Kreirano / uneseno</span><strong>{totals.created}</strong></article>
        <article className="metric"><span>Izmijenjeno</span><strong>{totals.updated}</strong></article>
        <article className="metric"><span>Proknjiženo / završeno</span><strong>{totals.posted}</strong></article>
        <article className="metric"><span>Obrisano / stornirano</span><strong>{totals.deleted}</strong></article>
        <article className="metric"><span>Obrađivane firme</span><strong>{distinctCompanies}</strong></article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Učinak po radniku</h3>
            <p className="compact-note">Admin agencije je uključen jer se i njegov operativni rad evidentira.</p>
          </div>
          <span>{visibleWorkers.length} korisnika</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Radnik</th><th>Aktivnosti</th><th>Firmi</th><th>Kreirano</th><th>Izmijenjeno</th><th>Knjiženo</th><th>Brisano / storno</th><th>Posljednja aktivnost</th>
              </tr>
            </thead>
            <tbody>
              {visibleWorkers.map((worker) => {
                const summary = summaries.get(worker.id);
                const lastActivity = lastByWorker.get(worker.id);
                return (
                  <tr key={worker.id}>
                    <td>
                      <Link href={filterLink(currentFilters, { korisnik: worker.id })}><strong>{worker.korisnicko_ime}</strong></Link>
                      <small className="activity-table-note">{worker.rola === "admin_agencije" ? "Admin agencije" : "Radnik"}{!worker.aktivan || worker.is_deleted ? " · neaktivan" : ""}</small>
                    </td>
                    <td><strong>{summary?.total ?? 0}</strong></td>
                    <td>{firmsByWorker.get(worker.id) ?? 0}</td>
                    <td>{summary?.created ?? 0}</td>
                    <td>{summary?.updated ?? 0}</td>
                    <td>{summary?.posted ?? 0}</td>
                    <td>{summary?.deleted ?? 0}</td>
                    <td>{lastActivity ? formatDateTime(lastActivity) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="activity-insights-grid">
        <section className="admin-panel">
          <div className="panel-header"><h3>Aktivnosti kroz vrijeme</h3><span>Posljednjih {chartDays.length} aktivnih dana</span></div>
          {chartDays.length ? (
            <div className="activity-bars">
              {chartDays.map((item) => (
                <div className="activity-bar-row" key={item.activity_date.toISOString()}>
                  <time>{formatDate(item.activity_date)}</time>
                  <span className="activity-bar-track"><span style={{ width: `${Math.max(4, (item._count._all / maxDailyCount) * 100)}%` }} /></span>
                  <strong>{item._count._all}</strong>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">Nema evidentiranih aktivnosti za izabrane filtere.</p>}
        </section>

        <section className="admin-panel">
          <div className="panel-header"><h3>Po modulima</h3><span>{topModules.length} modula</span></div>
          {topModules.length ? (
            <div className="activity-module-list">
              {topModules.map(([module, count]) => (
                <Link href={filterLink(currentFilters, { modul: module })} key={module}>
                  <span>{moduleLabel(module)}</span><strong>{count}</strong>
                </Link>
              ))}
            </div>
          ) : <p className="empty-state">Nema aktivnosti po modulima.</p>}
        </section>
      </div>

      <section className="admin-panel">
        <div className="panel-header">
          <div><h3>Hronologija aktivnosti</h3><p className="compact-note">Prikazano je najnovijih 100 poslovnih događaja.</p></div>
          <span>{recentActivities.length} prikazano</span>
        </div>
        {recentActivities.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vrijeme</th><th>Radnik</th><th>Firma</th><th>Modul</th><th>Akcija</th><th>Dokument</th></tr></thead>
              <tbody>
                {recentActivities.map((activity) => (
                  <tr key={activity.id}>
                    <td>{formatDateTime(activity.created_at)}</td>
                    <td>{activity.korisnik ? workerLabel(activity.korisnik) : "Sistemska akcija"}</td>
                    <td>{activity.firma?.naziv ?? "—"}</td>
                    <td>{moduleLabel(activity.modul)}</td>
                    <td>{humanize(activity.akcija)}</td>
                    <td>{humanize(activity.tip_entiteta)}{activity.entitet_id ? <small className="activity-table-note">ID {activity.entitet_id.slice(0, 8)}</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty-state">Nema evidentiranih aktivnosti za izabrane filtere.</p>}
      </section>
    </div>
  );
}
