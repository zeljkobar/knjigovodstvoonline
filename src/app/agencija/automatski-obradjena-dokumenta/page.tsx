import Link from "next/link";
import { getSepAdmin } from "@/lib/sep-context";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { canAccessAgencyImap } from "@/lib/imap-access-policy";
import { hasPermission } from "@/lib/permissions";
import { sepAutomationDay } from "@/lib/sep-automation-policy";
import { retrySepAutomation } from "@/app/agencija/podesavanja/sep-automatika/actions";

const path = "/agencija/automatski-obradjena-dokumenta";
const statuses: Record<string, string> = { PENDING: "Čeka obradu", RUNNING: "U toku", DONE: "Završeno", REVIEW: "Potrebna provjera" };
const messages: Record<string, string> = {
  zakazano: "Firma je dodata u red. Obrada počinje nakon 04:00, kada dođe na red.",
  iskljuceno: "Prvo uključite SEP automatiku za ovu firmu u podešavanjima.",
  u_toku: "Obrada firme je već u toku.", podaci: "Nije moguće ponoviti izabranu obradu. Osvježite pregled."
};
function object(value: unknown) { return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>; }
function count(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function errors(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function validDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
type Query = { firma?: string; izvor?: string; status?: string; od?: string; do?: string; poruka?: string };
export default async function AutomaticDocumentsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { user, agencyId } = await getSepAdmin();
  const [query, work, firms] = await Promise.all([
    searchParams, readWorkContext(),
    prisma.firma.findMany({ where: { agencija_id: agencyId, is_deleted: false }, select: { id: true, naziv: true, aktivan: true, poslovne_godine: { select: { id: true, godina: true } } }, orderBy: { naziv: "asc" } })
  ]);
  const activeFirm = firms.find(firm => firm.id === work.firmaId);
  const selected = query.firma === "sve" ? null : firms.find(firm => firm.id === query.firma) ?? activeFirm;
  const selectedYear = activeFirm?.poslovne_godine.find(year => year.id === work.poslovnaGodinaId)?.godina ?? Number(sepAutomationDay().day.slice(0, 4));
  const from = validDay(query.od) ?? `${selectedYear}-01-01`, to = validDay(query.do) ?? `${selectedYear}-12-31`;
  const source = query.izvor === "SEP" || query.izvor === "BANK" ? query.izvor : "";
  const status = Object.hasOwn(statuses, query.status ?? "") ? query.status! : "";
  const bankAccess = canAccessAgencyImap(user, user.agencija_id ?? undefined) && await hasPermission(user, { modul: "izvodi", akcija: "manage" });
  const scope = { agencija_id: agencyId, ...(selected ? { firma_id: selected.id } : {}), firma: { is_deleted: false } };
  const [sepRuns, bankRuns, configs] = await Promise.all([
    source === "BANK" || from > to ? [] : prisma.sepAutomatikaObrada.findMany({ where: { ...scope, dan: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, ...(status ? { status } : {}) }, include: { firma: { select: { naziv: true } } }, orderBy: { dan: "desc" }, take: 200 }),
    source === "SEP" || !bankAccess || from > to || status === "PENDING" || status === "RUNNING" ? [] : prisma.auditLog.findMany({ where: { ...scope, akcija: "AUTO_BANK_RUN", created_at: { gte: new Date(new Date(`${from}T00:00:00Z`).getTime() - 86400000), lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 172800000) }, ...(status ? { nova_vrijednost: { path: ["status"], equals: status } } : {}) }, include: { firma: { select: { naziv: true } } }, orderBy: { created_at: "desc" }, take: 200 }),
    prisma.sepAutomatikaPodesavanje.findMany({ where: { ...scope, aktivna: true }, select: { firma_id: true } })
  ]);
  const enabled = new Set(configs.map(config => config.firma_id));
  const rows = [
    ...sepRuns.map(run => {
      const result = object(run.rezultat);
      return { id: run.id, source: "SEP", firmId: run.firma_id, firmName: run.firma.naziv, day: run.dan.toISOString().slice(0, 10), time: run.pocetak ?? run.created_at, status: run.status, imported: count(result.uvezeno), posted: count(result.proknjizeno), downloaded: count(result.preuzeto), duplicates: count(result.duplikati), skipped: count(result.preskoceno), review: 0, errors: errors(result.greske), attempts: run.pokusaji, periods: errors(result.periodi) };
    }),
    ...bankRuns.map(run => {
      const result = object(run.nova_vrijednost), review = count(result.review), notes = errors(result.errors);
      return { id: run.id, source: "BANK", firmId: run.firma_id, firmName: run.firma?.naziv ?? "Firma", day: validDay(result.day) ?? sepAutomationDay(run.created_at).day, time: run.created_at, status: review || notes.length ? "REVIEW" : "DONE", imported: count(result.imported), posted: count(result.posted), downloaded: null, duplicates: null, skipped: null, review, errors: notes, attempts: null, periods: [] as string[] };
    })
  ].filter(row => row.day >= from && row.day <= to && (!status || row.status === status))
    .sort((a, b) => b.day.localeCompare(a.day) || b.time.getTime() - a.time.getTime()).slice(0, 100);
  function contextLink(firmId: string, day: string, returnTo: string) {
    const firm = firms.find(item => item.id === firmId);
    const year = firm?.poslovne_godine.find(item => item.godina === Number(day.slice(0, 4)));
    return `/agencija/kontekst?${new URLSearchParams({ firma_id: firmId, ...(year ? { poslovna_godina_id: year.id } : {}), returnTo })}`;
  }
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Dashboard</p><h1>Automatski obrađena dokumenta</h1><p>Rezultati automatskog uvoza i knjiženja SEP računa i izvoda.</p></div><Link className="secondary-button" href="/agencija/podesavanja/sep-automatika">SEP podešavanja</Link></header>
    {query.poruka && messages[query.poruka] ? <p role="status" className="admin-message">{messages[query.poruka]}</p> : null}
    <section className="admin-panel"><form key={`${selected?.id ?? "sve"}:${source}:${status}:${from}:${to}`} className="admin-form" method="get">
      <label><span>Firma</span><select name="firma" defaultValue={selected?.id ?? "sve"}><option value="sve">Sve firme agencije</option>{firms.map(firm => <option key={firm.id} value={firm.id}>{firm.naziv}</option>)}</select></label>
      <label><span>Izvor</span><select name="izvor" defaultValue={source}><option value="">Svi izvori</option><option value="SEP">SEP računi</option>{bankAccess ? <option value="BANK">Email / izvodi</option> : null}</select></label>
      <label><span>Status</span><select name="status" defaultValue={status}><option value="">Svi statusi</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label><span>Datum od</span><input type="date" name="od" defaultValue={from}/></label><label><span>Datum do</span><input type="date" name="do" defaultValue={to}/></label>
      <div className="form-actions"><button type="submit">Prikaži</button><Link className="secondary-button" href={path}>Poništi filtere</Link></div>
    </form>{from > to ? <p role="alert">Datum od mora biti prije datuma do.</p> : null}</section>
    <section className="admin-panel"><div className="panel-header"><h2>Pregled obrada</h2><span>{rows.length} obrada · {rows.filter(row => row.status === "REVIEW").length} za provjeru · {rows.reduce((sum, row) => sum + row.posted, 0)} proknjiženih dokumenata</span></div>
      <p className="muted-text">Prikazano je do 100 posljednjih obrada u izabranom periodu. Za SEP je dan datum zakazane obrade. Crtica znači da izvor ne vodi taj podatak.</p>
      <div className="table-wrap"><table className="admin-table"><thead><tr><th>Dan / firma</th><th>Izvor</th><th>Status</th><th>Preuzeto</th><th>Uvezeno</th><th>Duplikati</th><th>Preskočeno</th><th>Proknjiženo</th><th>Detalji / akcije</th></tr></thead><tbody>{rows.length ? rows.map(row => {
        const firm = firms.find(item => item.id === row.firmId);
        const bookDay = validDay(row.periods[0]?.slice(0, 10)) ?? row.day;
        return <tr key={`${row.source}:${row.id}`}><td>{new Date(`${row.day}T00:00:00Z`).toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" })}<br/><strong>{row.firmName}</strong></td><td>{row.source === "SEP" ? "SEP računi" : "Email / izvodi"}</td><td><span className={`status-pill ${row.status === "REVIEW" ? "status-pill--warning" : "status-pill--info"}`}>{statuses[row.status] ?? row.status}</span>{row.attempts !== null ? <p className="muted-text">Pokušaji: {row.attempts}</p> : null}</td><td>{row.downloaded ?? "—"}</td><td>{row.imported}</td><td>{row.duplicates ?? "—"}</td><td>{row.skipped ?? "—"}</td><td>{row.posted}</td><td>
          {row.periods.map(period => <p key={period}>{period}</p>)}{row.review ? <p>{row.review} dokumenata zahtijeva provjeru.</p> : null}{row.errors.map((error, index) => <p key={index}>{error}</p>)}
          {firm?.aktivan && row.firmId ? <div className="form-actions"><Link className="table-button" href={contextLink(row.firmId, bookDay, row.source === "SEP" ? "/agencija/racuni/pregled-kif" : "/agencija/izvodi")}>{row.source === "SEP" ? "KIF knjige" : "Izvodi"}</Link>{row.source === "BANK" && row.status === "REVIEW" ? <Link className="table-button" href={contextLink(row.firmId, row.day, "/agencija/izvodi/imap")}>Provjeri mailove</Link> : null}</div> : null}
          {row.source === "SEP" && row.status === "REVIEW" && row.firmId && enabled.has(row.firmId) ? row.firmId === work.firmaId ? <form action={retrySepAutomation}><input type="hidden" name="firma_id" value={row.firmId}/><input type="hidden" name="dan" value={row.day}/><button className="secondary-button" type="submit">Ponovi obradu</button></form> : <Link className="table-button" href={contextLink(row.firmId, row.day, `${path}?firma=${row.firmId}`)}>Izaberi firmu za ponavljanje</Link> : null}
        </td></tr>;
      }) : <tr><td colSpan={9}>Nema automatskih obrada za izabrane filtere.</td></tr>}</tbody></table></div>
    </section>
    {activeFirm && enabled.has(activeFirm.id) ? <section className="admin-panel"><h2>SEP — {activeFirm.naziv}</h2><p>Ponovno preuzimanje preskače već uvezene IKOF-e i dodaje firmu u red nakon 04:00.</p><form action={retrySepAutomation}><input type="hidden" name="firma_id" value={activeFirm.id}/><button type="submit" className="secondary-button">Ponovi današnju SEP obradu</button></form></section> : null}
  </div>;
}
