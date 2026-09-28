import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { fixedAssetCentsMoney } from "@/lib/fixed-assets";
import { fixedAssetMethodLabels } from "@/lib/fixed-assets-rates";
import { assetDate, assetDay, type AssetBatchSnapshot } from "@/lib/fixed-assets-batches";
import { calculateDepreciation, postDepreciation } from "../actions";

export default async function BatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ greska?: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext(), { id } = await params, query = await searchParams;
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) notFound();
  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "view" });
  const batch = await prisma.osObracun.findFirst({ where: { id, agencija_id: user.agencija_id, firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId }, include: { poslovna_godina: true, nalog: { select: { id: true, sifra: true } } } });
  if (!batch) notFound();
  const [canPost, canUpdate, accounts] = await Promise.all([
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "post" }),
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "update" }),
    prisma.firmaKonto.findMany({ where: { firma_id: context.firmaId, aktivan: true, tip_konta: "analiticko" }, select: { id: true, sifra: true, naziv: true }, orderBy: { sifra: "asc" } })
  ]);
  const snapshot = batch.snapshot as unknown as AssetBatchSnapshot;
  const inputs = <><input type="hidden" name="obracun_id" value={batch.id}/><input type="hidden" name="revizija" value={batch.revizija}/><input type="hidden" name="ocekivana_firma_id" value={context.firmaId}/><input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId}/></>;
  const editable = batch.status === "DRAFT" && !batch.poslovna_godina.zakljucena;
  const monthly = [...new Set(snapshot.lines.map(l => l.month))].sort().map(month => ({ month, cents: snapshot.lines.filter(l => l.month === month).reduce((sum, l) => sum + l.amountCents, 0) }));
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">{batch.status === "POSTED" ? "Proknjižen" : "Nacrt"} · revizija {batch.revizija}</p><h2>Obračun amortizacije</h2><p>{assetDate(batch.period_od)} – {assetDate(batch.period_do)} (uključivo)</p></div><Link href="/agencija/osnovna-sredstva/obracuni">Svi obračuni</Link></header>
    {query?.greska ? <p className="admin-note" role="alert">{query.greska}</p> : null}
    <section className="metric-grid"><article className="metric"><span>Sredstava</span><strong>{snapshot.coverage.length}</strong></article><article className="metric"><span>Ukupna amortizacija</span><strong>{fixedAssetCentsMoney(snapshot.totalCents)}</strong></article></section>
    {editable && canUpdate ? <section className="admin-panel"><h3>Kontiranje i ponovno računanje</h3><form action={calculateDepreciation} className="admin-form inline-filter-form">{inputs}
      {[["konto_troska_id", "Duguje — trošak amortizacije", snapshot.debitOverride], ["konto_ispravke_id", "Potražuje — ispravka vrijednosti", snapshot.creditOverride]].map(([name, label, current]) => <label key={name!}>{label}<select name={name!} defaultValue={current ?? ""}><option value="">Prema parametrima svakog sredstva</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.sifra} · {a.naziv}</option>)}</select></label>)}
      <button type="submit">Ponovo obračunaj nacrt</button></form><p className="muted-text">Izbor konta ovdje važi za sva sredstva ovog obračuna. Ponovno računanje zamjenjuje nacrt i čuva novu reviziju.</p></section> : null}
    {snapshot.postingErrors.length ? <section className="admin-panel"><h3>Prije knjiženja</h3>{snapshot.postingErrors.map(e => <p key={e} className="admin-note">{e}</p>)}</section> : null}
    {editable && canPost ? <form action={postDepreciation}>{inputs}<button type="submit" disabled={snapshot.postingErrors.length > 0}>{snapshot.totalCents ? "Proknjiži" : "Potvrdi nulti obračun"}</button></form> : null}
    {batch.nalog ? <p><Link href={`/agencija/nalozi/${batch.nalog.id}`}>Nalog {batch.nalog.sifra}</Link></p> : batch.status === "POSTED" ? <p>Nulti obračun je potvrđen bez naloga.</p> : null}
    <section className="admin-panel"><h3>Mjesečni pregled</h3><div className="table-wrap"><table><thead><tr><th>Mjesec</th><th>Amortizacija</th></tr></thead><tbody>{monthly.map(m => <tr key={m.month}><td>{m.month}</td><td>{fixedAssetCentsMoney(m.cents)}</td></tr>)}</tbody><tfoot><tr><th>Ukupno</th><th>{fixedAssetCentsMoney(snapshot.totalCents)}</th></tr></tfoot></table></div></section>
    <section className="admin-panel"><h3>Stavke sačuvanog obračuna</h3><div className="table-wrap"><table><thead><tr><th>Sredstvo</th><th>Period</th><th>Metoda</th><th>Amortizacija</th><th>Neto poslije</th><th>Duguje</th><th>Potražuje</th></tr></thead><tbody>{snapshot.lines.map((l, i) => <tr key={i}><td><Link href={`/agencija/osnovna-sredstva/${l.assetId}`}>{l.name}</Link></td><td>{l.segmentStart} – {assetDate(assetDay(new Date(l.segmentEnd), -1))}</td><td>{fixedAssetMethodLabels[l.method ?? "LINEAR"]}</td><td>{fixedAssetCentsMoney(l.amountCents)}</td><td>{fixedAssetCentsMoney(l.netAfterCents)}</td><td>{l.debitLabel}</td><td>{l.creditLabel}</td></tr>)}</tbody></table></div></section>
    {snapshot.excluded.length ? <section className="admin-panel"><h3>Isključena sredstva</h3>{snapshot.excluded.map((e, i) => <p key={i}>{e.name}: {e.reason}</p>)}</section> : null}
  </div>;
}
