import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";

const sections = [
  { href: "/agencija/robno/prenos", title: "Prenos robe", description: "Premještanje robe između magacina uz automatsko ažuriranje oba lagera.", ready: true },
  { href: "/agencija/robno/popis", title: "Popis", description: "Popisno stanje i knjiženje viška ili manjka.", ready: true },
  { href: "/agencija/robno/otpis", title: "Otpis", description: "Dokumentovani izlaz oštećene, zastarjele ili manjkave robe.", ready: true },
  { href: "/agencija/robno/nivelacija", title: "Nivelacija", description: "Promjena prodajnih cijena i vrijednosti zaliha.", ready: true }
];

export default async function InventoryMovementPage() {
  const [context, work] = await Promise.all([getInventoryContext("view"), readWorkContext()]);
  if (!context.firma) return <MissingInventoryContext title="Promet robe" />;
  if (!context.allowed) return <InventoryAccessDenied title="Promet robe" />;
  const [counts, stockCountGroups, writeOffGroups, adjustmentGroups] = work.poslovnaGodinaId
    ? await Promise.all([prisma.prenosRobe.groupBy({
        by: ["status"],
        where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false },
        _count: { _all: true }
      }), prisma.popisRobe.groupBy({ by: ["status"], where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, _count: { _all: true } }), prisma.otpisRobe.groupBy({ by: ["status"], where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, _count: { _all: true } }), prisma.nivelacijaCijena.groupBy({ by: ["status"], where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, _count: { _all: true } })])
    : [[], [], [], []];
  const count = (status: string) => counts.find((item) => item.status === status)?._count._all ?? 0;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Promet robe</h2><p className="muted-text">Dokumenti koji mijenjaju količinu ili vrijednost robe van redovne nabavke i prodaje.</p></div></header>
    <section className="metric-grid"><article className="metric"><span>Nacrti prenosa</span><strong>{count("DRAFT")}</strong></article><article className="metric"><span>Proknjiženi prenosi</span><strong>{count("POSTED")}</strong></article><article className="metric"><span>Otvoreni popisi</span><strong>{stockCountGroups.find((item) => item.status === "DRAFT")?._count._all ?? 0}</strong></article><article className="metric"><span>Završeni popisi</span><strong>{stockCountGroups.filter((item) => ["POSTED", "COMPLETED"].includes(item.status)).reduce((sum, item) => sum + item._count._all, 0)}</strong></article><article className="metric"><span>Nacrti otpisa</span><strong>{writeOffGroups.find((item) => item.status === "DRAFT")?._count._all ?? 0}</strong></article><article className="metric"><span>Proknjiženi otpisi</span><strong>{writeOffGroups.find((item) => item.status === "POSTED")?._count._all ?? 0}</strong></article><article className="metric"><span>Nacrti nivelacija</span><strong>{adjustmentGroups.find((item) => item.status === "DRAFT")?._count._all ?? 0}</strong></article><article className="metric"><span>Proknjižene nivelacije</span><strong>{adjustmentGroups.find((item) => item.status === "POSTED")?._count._all ?? 0}</strong></article></section>
    <section className="inventory-codebook-grid">{sections.map((section) => <Link className="inventory-codebook-card" href={section.href} key={section.href}><span>{section.ready ? "Dostupno" : "Sljedeća faza"}</span><strong>{section.title}</strong><small>{section.description}</small></Link>)}</section>
  </div>;
}
