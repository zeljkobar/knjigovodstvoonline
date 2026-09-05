import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { inventoryTransferStatusLabel } from "@/lib/inventory-transfer";
import { hasAllPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function number(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryTransferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();
  const transfer = await prisma.prenosRobe.findFirst({
    where: { id, agencija_id: user.agencija_id, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { firma: { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } }) },
    include: { firma: true, poslovna_godina: { select: { godina: true } }, izvorni_magacin: true, odredisni_magacin: true, izvorna_poslovna_jedinica: true, odredisna_poslovna_jedinica: true, nalog: { select: { sifra: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } }
  });
  if (!transfer) notFound();
  if (!(await hasAllPermissions(user, [
    { firmaId: transfer.firma_id, modul: "robno", akcija: "view" },
    { firmaId: transfer.firma_id, modul: "robno", akcija: "export" }
  ]))) notFound();
  return <main className="print-page"><div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/robno/prenos/${transfer.id}`}>Nazad</Link><PrintButton label="Štampaj prenos" /></div><article className="calculation-print-document">
    <header className="calculation-print-header"><div><strong>{transfer.firma.naziv}</strong><span>{[transfer.firma.adresa, transfer.firma.grad].filter(Boolean).join(", ")}</span><span>PIB: {transfer.firma.pib ?? "-"}</span></div><div className="calculation-print-title"><p>Robno knjigovodstvo</p><h1>PRENOS ROBE</h1><strong>{transfer.interni_broj}</strong></div><div className="calculation-print-status"><span>Status</span><strong>{inventoryTransferStatusLabel(transfer.status)}</strong><span>Godina {transfer.poslovna_godina.godina}</span></div></header>
    <section className="calculation-print-meta"><div><span>Iz magacina</span><strong>{transfer.izvorni_magacin.sifra} · {transfer.izvorni_magacin.naziv}</strong><small>{transfer.izvorna_poslovna_jedinica ? `Poslovna jedinica: ${transfer.izvorna_poslovna_jedinica.sifra} · ${transfer.izvorna_poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</small></div><div><span>U magacin</span><strong>{transfer.odredisni_magacin.sifra} · {transfer.odredisni_magacin.naziv}</strong><small>{transfer.odredisna_poslovna_jedinica ? `Poslovna jedinica: ${transfer.odredisna_poslovna_jedinica.sifra} · ${transfer.odredisna_poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</small></div><div><span>Datum prenosa</span><strong>{transfer.datum.toLocaleDateString("sr-Latn-ME")}</strong><small>Nalog: {transfer.nalog?.sifra ?? "-"}</small></div><div><span>Napomena</span><strong>{transfer.napomena ?? "-"}</strong></div></section>
    <table className="calculation-print-table"><thead><tr><th>#</th><th>Šifra / naziv artikla</th><th>JM</th><th>Količina</th><th>Nabavna cijena</th><th>Nabavna vrijednost</th><th>Prodajna vrijednost</th><th>Ukalkulisani PDV</th></tr></thead><tbody>{transfer.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><span>{line.artikal.naziv}</span></td><td>{line.artikal.jedinica_mjere.oznaka}</td><td>{number(line.kolicina, 3)}</td><td>{number(line.jedinicna_nabavna_cijena, 4)}</td><td>{number(line.nabavna_vrijednost)}</td><td>{number(line.prodajna_vrijednost)}</td><td>{number(line.ukalkulisani_pdv)}</td></tr>)}</tbody><tfoot><tr><td colSpan={5}>UKUPNO</td><td>{number(transfer.ukupna_nabavna_vrijednost)}</td><td>{number({ toString: () => transfer.stavke.reduce((sum, line) => sum + Number(line.prodajna_vrijednost), 0).toString() })}</td><td>{number({ toString: () => transfer.stavke.reduce((sum, line) => sum + Number(line.ukalkulisani_pdv), 0).toString() })}</td></tr></tfoot></table>
    <footer className="calculation-print-footer"><div><span>Robu izdao</span><strong>________________________</strong></div><div><span>Robu primio</span><strong>________________________</strong></div><div><span>Odgovorno lice</span><strong>________________________</strong></div></footer>
  </article></main>;
}
