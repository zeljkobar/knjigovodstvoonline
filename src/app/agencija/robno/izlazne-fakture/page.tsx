import Link from "next/link";
import { outgoingInvoiceStatusLabel } from "@/lib/outgoing-invoice";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";

function money(value: { toString(): string }) { return Number(value.toString()).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export default async function OutgoingInvoicesPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const [{ poruka }, context, work] = await Promise.all([searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!context.firma || !work.poslovnaGodinaId) return <MissingInventoryContext title="Izlazne fakture" />;
  if (!context.allowed) return <InventoryAccessDenied title="Izlazne fakture" />;
  const invoices = await prisma.fiskalniIzlazniRacun.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, sales_channel: { not: "POS" }, is_deleted: false }, include: { kupac: { select: { naziv: true, pib: true } }, _count: { select: { stavke: true } } }, orderBy: [{ datum_racuna: "desc" }, { broj: "desc" }] });
  return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Prodaja</p><h2>Izlazne fakture</h2><p className="muted-text">Nacrti, završene i fiskalizovane fakture aktivne firme.</p></div><Link className="primary-button" href="/agencija/robno/nova-izlazna-faktura">Nova faktura</Link></header>
    {poruka ? <p className="admin-message">{poruka}</p> : null}<section className="admin-panel"><div className="panel-header"><h3>Fakture</h3><span>{invoices.length} ukupno</span></div><div className="table-wrap"><table><thead><tr><th>Broj</th><th>Datum</th><th>Kupac</th><th>Stavke</th><th>Ukupno</th><th>Fiskalizacija</th><th>Status</th><th></th></tr></thead><tbody>{invoices.length ? invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.interni_broj}</strong></td><td>{invoice.datum_racuna.toLocaleDateString("sr-Latn-ME")}</td><td>{invoice.kupac.naziv}<small>{invoice.kupac.pib ?? ""}</small></td><td>{invoice._count.stavke}</td><td>{money(invoice.ukupno_sa_pdv)} €</td><td>{invoice.fiskalizacija_rezim === "SUMMA" ? invoice.fiscal_status : "Drugi sistem / nije potrebna"}</td><td><span className={`status-pill${invoice.status === "DRAFT" ? " status-pill--muted" : " status-pill--success"}`}>{outgoingInvoiceStatusLabel(invoice.status)}</span></td><td><Link className="table-button" href={`/agencija/robno/izlazne-fakture/${invoice.id}`}>Otvori</Link></td></tr>) : <tr><td colSpan={8} className="empty-state">Još nema izlaznih faktura.</td></tr>}</tbody></table></div></section></div>;
}
