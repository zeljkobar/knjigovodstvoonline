import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { supplierReturnStatus } from "@/lib/supplier-return";
import { InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { ReturnHeaderForm, returnMoney, returnView } from "./_shared";

export default async function SupplierReturnsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; poruka?: string; greska?: string }> }) {
  const [context, query] = await Promise.all([returnView(), searchParams]);
  if (!context.firma || !context.year) return <MissingInventoryContext title="Povrat dobavljaču — izaberite firmu i godinu" />;
  if (!context.allowed) return <InventoryAccessDenied title="Povrat dobavljaču" />;
  const scope = { firma_id: context.firma.id, agencija_id: context.user.agencija_id!, poslovna_godina_id: context.year.id, is_deleted: false };
  const rows = await prisma.povratDobavljacu.findMany({ where: { ...scope, ...(query.status && ["DRAFT", "POSTED"].includes(query.status) ? { status: query.status } : {}), ...(query.q ? { OR: [{ interni_broj: { contains: query.q, mode: "insensitive" } }, { broj_odobrenja: { contains: query.q, mode: "insensitive" } }, { dobavljac: { naziv: { contains: query.q, mode: "insensitive" } } }] } : {}) }, include: { dobavljac: true, magacin: true }, orderBy: { broj: "desc" } });
  const canCreate = !context.year.zakljucena && await hasPermission(context.user, { firmaId: context.firma.id, modul: "robno", akcija: "create" });
  const now = new Date().toISOString().slice(0, 10);
  const defaultDate = now >= context.year.datum_od.toISOString().slice(0, 10) && now <= context.year.datum_do.toISOString().slice(0, 10) ? now : context.year.datum_od.toISOString().slice(0, 10);
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Nabavka</p><h2>Povrat dobavljaču</h2><p className="muted-text">Poseban dokument za izlaz robe, smanjenje obaveze i korekciju KUF-a.</p></div><Link className="secondary-button" href="/agencija/robno/podesavanja">Šema knjiženja</Link></header>
    {query.greska ? <p role="alert" className="admin-message">{query.greska}</p> : query.poruka ? <p role="status" className="admin-message">{query.poruka}</p> : null}
    {context.year.zakljucena ? <p className="admin-message">Poslovna godina je zaključana.</p> : null}
    {canCreate ? <section className="admin-panel"><h3>Novi povrat</h3><ReturnHeaderForm companyId={context.firma.id} agencyId={scope.agencija_id} yearId={context.year.id} defaultDate={defaultDate} /></section> : null}
    <section className="admin-panel"><form method="get" className="admin-form"><label><span>Pretraga</span><input name="q" defaultValue={query.q} placeholder="Broj ili dobavljač" /></label><label><span>Status</span><select name="status" defaultValue={query.status ?? ""}><option value="">Svi</option><option value="DRAFT">Nacrti</option><option value="POSTED">Proknjiženi</option></select></label><div className="form-actions"><button type="submit" className="secondary-button">Prikaži</button></div></form>
      <div className="table-wrap"><table className="admin-table"><thead><tr><th>Dokument</th><th>Datum</th><th>Dobavljač</th><th>Magacin</th><th>Status</th><th>Odobrenje</th><th></th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.interni_broj}<small className="table-secondary">{r.broj_odobrenja}</small></td><td>{r.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{r.dobavljac.naziv}</td><td>{r.magacin.naziv}</td><td>{supplierReturnStatus(r.status)}</td><td>{r.status === "DRAFT" ? "—" : `${returnMoney(r.ukupno_odobrenje)} €`}</td><td><Link className="table-button" href={`/agencija/robno/povrat-dobavljacu/${r.id}`}>Otvori</Link></td></tr>)}</tbody></table></div>{!rows.length ? <p className="empty-state">Nema povrata za izabrani filter.</p> : null}
    </section>
  </div>;
}
