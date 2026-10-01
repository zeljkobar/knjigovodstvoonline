import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const actionLabels: Record<string, string> = {
  create: "Kreiranje", update: "Izmjena", delete: "Brisanje", post: "Knjiženje",
  cancel: "Storniranje", export: "Izvoz", login: "Prijava", logout: "Odjava",
  assign_company: "Dodjela firme", remove_company: "Uklanjanje pristupa firmi",
  set_permission_matrix: "Promjena prava", set_permissions: "Promjena prava",
  activate: "Aktivacija", deactivate: "Deaktivacija"
};
type Filters = { korisnik?: string; firma?: string; od?: string; do?: string; akcija?: string; stranica?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function date(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  // Resolve local midnight, including CET/CEST transitions, without server TZ assumptions.
  let instant = parsed.getTime();
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const part = (key: string) => Number(parts.find((item) => item.type === key)?.value);
    const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant += parsed.getTime() - local;
  }
  return new Date(instant);
}
export default async function ActivityPage({ searchParams }: { searchParams?: Promise<Filters> }) {
  const admin = await requireRole("admin_agencije");
  if (!admin.agencija_id) return null;
  const params = await searchParams ?? {};
  const from = date(params.od), to = date(params.do);
  const end = to && params.do ? date(new Date(new Date(`${params.do}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) : null;
  const invalid = Boolean((params.od && !from) || (params.do && !to) || (from && to && from > to)
    || (params.korisnik && !uuid.test(params.korisnik)) || (params.firma && !uuid.test(params.firma)));
  const scope = { agencija_id: admin.agencija_id };
  const where: Prisma.AuditLogWhereInput = {
    ...scope,
    ...(params.korisnik && uuid.test(params.korisnik) ? { korisnik_id: params.korisnik } : {}),
    ...(params.firma && uuid.test(params.firma) ? { firma_id: params.firma } : {}),
    ...(params.akcija ? { akcija: params.akcija } : {}),
    ...(from || to ? { created_at: { ...(from ? { gte: from } : {}), ...(end ? { lt: end } : {}) } } : {})
  };
  const [users, companies, actions, count] = await Promise.all([
    prisma.korisnik.findMany({ where: scope, select: { id: true, korisnicko_ime: true }, orderBy: { korisnicko_ime: "asc" } }),
    prisma.firma.findMany({ where: scope, select: { id: true, naziv: true }, orderBy: { naziv: "asc" } }),
    prisma.auditLog.groupBy({ where: scope, by: ["akcija"], orderBy: { akcija: "asc" } }),
    invalid ? Promise.resolve(0) : prisma.auditLog.count({ where })
  ]);
  const pages = Math.max(1, Math.ceil(count / 50));
  const requestedPage = Number(params.stranica);
  const page = Math.min(pages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const rows = invalid ? [] : await prisma.auditLog.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50,
    select: { id: true, created_at: true, korisnik_id: true, firma_id: true, modul: true, akcija: true, tip_entiteta: true, entitet_id: true } });
  const userNames = new Map(users.map((u) => [u.id, u.korisnicko_ime]));
  const companyNames = new Map(companies.map((c) => [c.id, c.naziv]));
  const href = (number: number) => {
    const query = new URLSearchParams();
    for (const key of ["korisnik", "firma", "od", "do", "akcija"] as const) if (params[key]) query.set(key, params[key]);
    query.set("stranica", String(number));
    return `/agencija/korisnici/audit-log?${query}`;
  };
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Dnevnik aktivnosti</h2><p>Zabilježene aktivnosti vaše agencije, od najnovijih ka starijim. Vrijeme je prikazano za Crnu Goru.</p></div></header>
    <section className="admin-panel">
      <form className="admin-form" action="/agencija/korisnici/audit-log">
        <label>Korisnik<select name="korisnik" defaultValue={params.korisnik ?? ""}><option value="">Svi korisnici</option>{users.map((u) => <option key={u.id} value={u.id}>{u.korisnicko_ime}</option>)}</select></label>
        <label>Firma<select name="firma" defaultValue={params.firma ?? ""}><option value="">Sve firme agencije</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.naziv}</option>)}</select></label>
        <label>Od datuma<input type="date" name="od" defaultValue={params.od} /></label>
        <label>Do datuma<input type="date" name="do" defaultValue={params.do} /></label>
        <label>Radnja<select name="akcija" defaultValue={params.akcija ?? ""}><option value="">Sve radnje</option>{actions.map(({ akcija }) => <option key={akcija} value={akcija}>{actionLabels[akcija] ?? akcija.replaceAll("_", " ")}</option>)}</select></label>
        <button type="submit">Prikaži</button><Link className="table-link" href="/agencija/korisnici/audit-log">Poništi filtere</Link>
      </form>
    </section>
    <section className="admin-panel">
      <div className="panel-header"><h3>Aktivnosti</h3><span>{count} ukupno</span></div>
      {invalid ? <p className="admin-message">Provjerite filtere i period: početni datum ne smije biti poslije završnog.</p> : rows.length === 0 ? <p className="empty-state">Nema zabilježenih aktivnosti za izabrane filtere.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Vrijeme</th><th>Korisnik</th><th>Firma</th><th>Modul</th><th>Radnja</th><th>Zapis</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td>{row.created_at.toLocaleString("sr-Latn", { timeZone: "Europe/Podgorica" })}</td>
          <td>{row.korisnik_id ? userNames.get(row.korisnik_id) ?? "Nedostupan korisnik" : "Sistem"}</td>
          <td>{row.firma_id ? companyNames.get(row.firma_id) ?? "Nedostupna firma" : "Agencija"}</td>
          <td>{row.modul ?? "—"}</td><td>{actionLabels[row.akcija] ?? row.akcija.replaceAll("_", " ")}</td>
          <td>{row.tip_entiteta}{row.entitet_id ? <small>{row.entitet_id}</small> : null}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="table-actions" style={{ marginTop: 16 }}>
        {page > 1 ? <Link className="table-link" href={href(page - 1)}>Prethodna</Link> : null}
        <span>Stranica {page} od {pages}</span>
        {page < pages ? <Link className="table-link" href={href(page + 1)}>Sljedeća</Link> : null}
      </div>
    </section>
  </div>;
}
