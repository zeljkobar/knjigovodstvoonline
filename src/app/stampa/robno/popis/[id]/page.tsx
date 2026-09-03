import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { inventoryCountStatusLabel } from "@/lib/inventory-count";
import { prisma } from "@/lib/prisma";

function number(value: { toString(): string } | null, digits = 2) {
  if (value === null) return "—";
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryCountPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();
  const count = await prisma.popisRobe.findFirst({ where: { id, agencija_id: user.agencija_id, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { firma: { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } }) }, include: { firma: true, poslovna_godina: { select: { godina: true } }, magacin: true, poslovna_jedinica: true, nalog: { select: { sifra: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!count) notFound();
  return <main className="print-page"><div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/robno/popis/${count.id}`}>Nazad</Link><PrintButton label="Štampaj popis" /></div><article className="calculation-print-document">
    <header className="calculation-print-header"><div><strong>{count.firma.naziv}</strong><span>{[count.firma.adresa, count.firma.grad].filter(Boolean).join(", ")}</span><span>PIB: {count.firma.pib ?? "-"}</span></div><div className="calculation-print-title"><p>Robno knjigovodstvo</p><h1>POPIS ROBE</h1><strong>{count.interni_broj}</strong></div><div className="calculation-print-status"><span>Status</span><strong>{inventoryCountStatusLabel(count.status)}</strong><span>Godina {count.poslovna_godina.godina}</span></div></header>
    <section className="calculation-print-meta"><div><span>Magacin</span><strong>{count.magacin.sifra} · {count.magacin.naziv}</strong><small>{count.poslovna_jedinica ? `Poslovna jedinica: ${count.poslovna_jedinica.sifra} · ${count.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</small></div><div><span>Datum popisa</span><strong>{count.datum.toLocaleDateString("sr-Latn-ME")}</strong><small>Nalog: {count.nalog?.sifra ?? "-"}</small></div><div><span>Napomena</span><strong>{count.napomena ?? "-"}</strong></div></section>
    <table className="calculation-print-table"><thead><tr><th>#</th><th>Šifra / naziv artikla</th><th>JM</th><th>Knjigovodstveno</th><th>Stvarno</th><th>Višak</th><th>Manjak</th><th>Nabavna vrijednost razlike</th></tr></thead><tbody>{count.stavke.map((line) => { const difference = Number(line.razlika_kolicina); return <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><span>{line.artikal.naziv}</span></td><td>{line.artikal.jedinica_mjere.oznaka}</td><td>{number(line.knjigovodstvena_kolicina, 3)}</td><td>{number(line.stvarna_kolicina, 3)}</td><td>{difference > 0 ? number(line.razlika_kolicina, 3) : "-"}</td><td>{difference < 0 ? number({ toString: () => String(Math.abs(difference)) }, 3) : "-"}</td><td>{difference === 0 ? "-" : number(line.nabavna_vrijednost_razlike)}</td></tr>; })}</tbody><tfoot><tr><td colSpan={5}>UKUPNO</td><td colSpan={1}>Višak {number(count.ukupna_vrijednost_viska)}</td><td colSpan={2}>Manjak {number(count.ukupna_vrijednost_manjka)}</td></tr></tfoot></table>
    <footer className="calculation-print-footer"><div><span>Popisna komisija</span><strong>________________________</strong></div><div><span>Odgovorno lice</span><strong>________________________</strong></div><div><span>Datum</span><strong>________________________</strong></div></footer>
  </article></main>;
}
