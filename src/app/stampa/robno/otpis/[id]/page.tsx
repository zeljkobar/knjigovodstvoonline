import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { inventoryWriteOffReasonLabel, inventoryWriteOffStatusLabel } from "@/lib/inventory-write-off";
import { hasAllPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function number(value: { toString(): string } | null, digits = 2) {
  if (value === null) return "—";
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryWriteOffPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();
  const writeOff = await prisma.otpisRobe.findFirst({ where: { id, agencija_id: user.agencija_id, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { firma: { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } }) }, include: { firma: true, poslovna_godina: { select: { godina: true } }, magacin: true, poslovna_jedinica: true, nalog: { select: { sifra: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!writeOff) notFound();
  if (!(await hasAllPermissions(user, [
    { firmaId: writeOff.firma_id, modul: "robno", akcija: "view" },
    { firmaId: writeOff.firma_id, modul: "robno", akcija: "export" }
  ]))) notFound();
  const draftCost = writeOff.stavke.reduce((sum, line) => sum + Number(line.nabavna_vrijednost), 0);
  const totalCost = writeOff.status === "POSTED" ? number(writeOff.ukupna_nabavna_vrijednost) : draftCost.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return <main className="print-page"><div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/robno/otpis/${writeOff.id}`}>Nazad</Link><PrintButton label="Štampaj otpis" /></div><article className="calculation-print-document">
    <header className="calculation-print-header"><div><strong>{writeOff.firma.naziv}</strong><span>{[writeOff.firma.adresa, writeOff.firma.grad].filter(Boolean).join(", ")}</span><span>PIB: {writeOff.firma.pib ?? "-"}</span></div><div className="calculation-print-title"><p>Robno knjigovodstvo</p><h1>OTPIS ROBE</h1><strong>{writeOff.interni_broj}</strong></div><div className="calculation-print-status"><span>Status</span><strong>{inventoryWriteOffStatusLabel(writeOff.status)}</strong><span>Godina {writeOff.poslovna_godina.godina}</span></div></header>
    <section className="calculation-print-meta"><div><span>Magacin</span><strong>{writeOff.magacin.sifra} · {writeOff.magacin.naziv}</strong><small>{writeOff.poslovna_jedinica ? `Poslovna jedinica: ${writeOff.poslovna_jedinica.sifra} · ${writeOff.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</small></div><div><span>Datum otpisa</span><strong>{writeOff.datum.toLocaleDateString("sr-Latn-ME")}</strong><small>Nalog: {writeOff.nalog?.sifra ?? "-"}</small></div><div><span>Razlog</span><strong>{inventoryWriteOffReasonLabel(writeOff.razlog)}</strong><small>{writeOff.opis_razloga ?? writeOff.napomena ?? "-"}</small></div></section>
    <table className="calculation-print-table"><thead><tr><th>#</th><th>Šifra / naziv artikla</th><th>JM</th><th>Količina</th><th>Nabavna cijena</th><th>Nabavna vrijednost</th><th>Maloprodajna vrijednost</th><th>RUC</th><th>PDV</th></tr></thead><tbody>{writeOff.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><span>{line.artikal.naziv}</span>{line.napomena ? <small>{line.napomena}</small> : null}</td><td>{line.artikal.jedinica_mjere.oznaka}</td><td>{number(line.kolicina, 3)}</td><td>{number(line.jedinicna_nabavna_cijena, 4)}</td><td>{number(line.nabavna_vrijednost)}</td><td>{number(line.maloprodajna_vrijednost)}</td><td>{number(line.razlika_u_cijeni)}</td><td>{number(line.ukalkulisani_pdv)}</td></tr>)}</tbody><tfoot><tr><td colSpan={5}>UKUPNO</td><td>{totalCost}</td><td>{number(writeOff.ukupna_maloprodajna_vrijednost)}</td><td>{number(writeOff.ukupna_razlika_u_cijeni)}</td><td>{number(writeOff.ukupni_ukalkulisani_pdv)}</td></tr></tfoot></table>
    {writeOff.napomena ? <p className="print-note"><strong>Napomena:</strong> {writeOff.napomena}</p> : null}
    <footer className="calculation-print-footer"><div><span>Sastavio</span><strong>________________________</strong></div><div><span>Odgovorno lice</span><strong>________________________</strong></div><div><span>Datum</span><strong>________________________</strong></div></footer>
  </article></main>;
}
