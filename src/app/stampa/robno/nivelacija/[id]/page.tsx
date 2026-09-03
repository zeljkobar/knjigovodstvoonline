import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { inventoryPriceAdjustmentStatusLabel } from "@/lib/inventory-price-adjustment";
import { prisma } from "@/lib/prisma";

function number(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(value: { toString(): string }) {
  const amount = Number(value.toString());
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function InventoryPriceAdjustmentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();
  const adjustment = await prisma.nivelacijaCijena.findFirst({ where: { id, agencija_id: user.agencija_id, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { firma: { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } }) }, include: { firma: true, poslovna_godina: { select: { godina: true } }, magacin: true, poslovna_jedinica: true, nalog: { select: { sifra: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!adjustment) notFound();
  const draftRetail = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_maloprodajne_vrijednosti), 0);
  const draftMargin = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_razlike_u_cijeni), 0);
  const draftVat = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_ukalkulisanog_pdv), 0);
  const totals = adjustment.status === "POSTED" ? { retail: adjustment.ukupna_promjena_maloprodajne_vrijednosti, margin: adjustment.ukupna_promjena_razlike_u_cijeni, vat: adjustment.ukupna_promjena_ukalkulisanog_pdv } : { retail: { toString: () => String(draftRetail) }, margin: { toString: () => String(draftMargin) }, vat: { toString: () => String(draftVat) } };

  return <main className="print-page"><div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/robno/nivelacija/${adjustment.id}`}>Nazad</Link><PrintButton label="Štampaj nivelaciju" /></div><article className="calculation-print-document">
    <header className="calculation-print-header"><div><strong>{adjustment.firma.naziv}</strong><span>{[adjustment.firma.adresa, adjustment.firma.grad].filter(Boolean).join(", ")}</span><span>PIB: {adjustment.firma.pib ?? "-"}</span></div><div className="calculation-print-title"><p>Robno knjigovodstvo</p><h1>NIVELACIJA CIJENA</h1><strong>{adjustment.interni_broj}</strong></div><div className="calculation-print-status"><span>Status</span><strong>{inventoryPriceAdjustmentStatusLabel(adjustment.status)}</strong><span>Godina {adjustment.poslovna_godina.godina}</span></div></header>
    <section className="calculation-print-meta"><div><span>Magacin</span><strong>{adjustment.magacin.sifra} · {adjustment.magacin.naziv}</strong><small>{adjustment.poslovna_jedinica ? `Poslovna jedinica: ${adjustment.poslovna_jedinica.sifra} · ${adjustment.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</small></div><div><span>Datum nivelacije</span><strong>{adjustment.datum.toLocaleDateString("sr-Latn-ME")}</strong><small>Nalog: {adjustment.nalog?.sifra ?? "-"}</small></div><div><span>Napomena</span><strong>{adjustment.napomena ?? "-"}</strong></div></section>
    <table className="calculation-print-table"><thead><tr><th>#</th><th>Šifra / naziv artikla</th><th>JM</th><th>Stanje</th><th>Stara MPC</th><th>Nova MPC</th><th>Stara MPV</th><th>Nova MPV</th><th>Promjena MPV</th><th>Promjena RUC</th><th>Promjena PDV</th></tr></thead><tbody>{adjustment.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><span>{line.artikal.naziv}</span></td><td>{line.artikal.jedinica_mjere.oznaka}</td><td>{number(line.knjigovodstvena_kolicina, 3)}</td><td>{number(line.stara_prodajna_cijena_sa_pdv)}</td><td>{number(line.nova_prodajna_cijena_sa_pdv)}</td><td>{number(line.stara_maloprodajna_vrijednost)}</td><td>{number(line.nova_maloprodajna_vrijednost)}</td><td>{signed(line.promjena_maloprodajne_vrijednosti)}</td><td>{signed(line.promjena_razlike_u_cijeni)}</td><td>{signed(line.promjena_ukalkulisanog_pdv)}</td></tr>)}</tbody><tfoot><tr><td colSpan={8}>UKUPNA PROMJENA</td><td>{signed(totals.retail)}</td><td>{signed(totals.margin)}</td><td>{signed(totals.vat)}</td></tr></tfoot></table>
    <footer className="calculation-print-footer"><div><span>Sastavio</span><strong>________________________</strong></div><div><span>Odgovorno lice</span><strong>________________________</strong></div><div><span>Datum</span><strong>________________________</strong></div></footer>
  </article></main>;
}
