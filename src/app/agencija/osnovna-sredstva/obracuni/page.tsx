import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { fixedAssetMoney } from "@/lib/fixed-assets";
import { assetDate } from "@/lib/fixed-assets-batches";
import { calculateDepreciation } from "./actions";

export default async function CalculationsPage({ searchParams }: { searchParams?: Promise<{ greska?: string; strana?: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext(), query = await searchParams;
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) return <p>Izaberite firmu i poslovnu godinu.</p>;
  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "view" });
  const scope = { agencija_id: user.agencija_id, firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId };
  const year = await prisma.poslovnaGodina.findFirst({ where: { id: context.poslovnaGodinaId, firma_id: context.firmaId, firma: { agencija_id: user.agencija_id, is_deleted: false } }, include: { firma: { select: { naziv: true } } } });
  if (!year) return <p>Godina nije dostupna.</p>;
  const count = await prisma.osObracun.count({ where: scope });
  const page = Math.max(1, Math.min(Math.ceil(count / 50) || 1, Number(query?.strana) || 1));
  const [batches, canCreate] = await Promise.all([
    prisma.osObracun.findMany({ where: scope, orderBy: [{ created_at: "desc" }, { id: "desc" }], skip: (Math.floor(page) - 1) * 50, take: 50, include: { nalog: { select: { sifra: true } } } }),
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "create" })
  ]);
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Osnovna sredstva</p><h2>Obračuni amortizacije</h2><p className="muted-text">{year.firma.naziv} · {year.godina}</p></div></header>
    {query?.greska ? <p className="admin-note" role="alert">{query.greska}</p> : null}
    <section className="admin-panel"><h3>Novi obračun</h3>
      <form action={calculateDepreciation} className="admin-form inline-filter-form">
        <input type="hidden" name="ocekivana_firma_id" value={context.firmaId}/><input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId}/>
        <label>Od<input name="od" type="date" defaultValue={assetDate(year.datum_od)} min={assetDate(year.datum_od)} max={assetDate(year.datum_do)} required/></label>
        <label>Do (uključivo)<input name="do" type="date" defaultValue={assetDate(year.datum_do)} min={assetDate(year.datum_od)} max={assetDate(year.datum_do)} required/></label>
        <button type="submit" disabled={!canCreate || year.zakljucena}>Obračunaj amortizaciju</button>
      </form><p className="muted-text">Kreira sačuvani nacrt za izabrani period. Isti period otvara postojeći obračun. Knjiženje je zaseban korak.</p>
      {year.zakljucena ? <p className="admin-note">Poslovna godina je zaključana.</p> : null}
    </section>
    <section className="admin-panel"><h3>Sačuvani obračuni</h3><div className="table-wrap"><table><thead><tr><th>Period</th><th>Amortizacija</th><th>Status</th><th>Revizija</th><th>Nalog</th><th/></tr></thead><tbody>
      {batches.map(b => <tr key={b.id}><td>{b.period_od.toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" })} – {b.period_do.toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" })}</td><td>{fixedAssetMoney(b.ukupna_amortizacija)}</td><td>{b.status === "POSTED" ? "Proknjižen" : "Nacrt"}</td><td>{b.revizija}</td><td>{b.nalog?.sifra ?? "—"}</td><td><Link href={`/agencija/osnovna-sredstva/obracuni/${b.id}`}>Otvori</Link></td></tr>)}
      {!batches.length ? <tr><td colSpan={6}>Još nema sačuvanih obračuna. Izaberite period i kliknite „Obračunaj amortizaciju“.</td></tr> : null}
    </tbody></table></div>
      {page > 1 ? <Link href={`?strana=${page - 1}`}>Prethodna</Link> : null} <span>{count} obračuna</span> {page * 50 < count ? <Link href={`?strana=${page + 1}`}>Sljedeća</Link> : null}
    </section>
  </div>;
}
