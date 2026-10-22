import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { prisma } from "@/lib/prisma";
import { hasAllPermissions } from "@/lib/permissions";
import { supplierReturnStatus } from "@/lib/supplier-return";
import { returnMoney, returnView } from "@/app/agencija/robno/povrat-dobavljacu/_shared";

export default async function SupplierReturnPrint({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, returnView()]);
  if (!ctx.firma || !ctx.year || !ctx.allowed || !await hasAllPermissions(ctx.user, [{ firmaId: ctx.firma.id, modul: "robno", akcija: "export" }])) notFound();
  const doc = await prisma.povratDobavljacu.findFirst({ where: { id, firma_id: ctx.firma.id, agencija_id: ctx.user.agencija_id!, poslovna_godina_id: ctx.year.id, is_deleted: false }, include: { firma: true, dobavljac: true, magacin: true, kalkulacija: true, nalog: true, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!doc) notFound();
  return <main className="print-page"><div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/robno/povrat-dobavljacu/${id}`}>Nazad</Link><PrintButton label="Štampaj povrat" /></div><article className="calculation-print-document">
    <header className="calculation-print-header"><div><strong>{doc.firma.naziv}</strong><span>{doc.firma.adresa}</span><span>PIB: {doc.firma.pib ?? "—"}</span></div><div className="calculation-print-title"><p>Robno knjigovodstvo</p><h1>POVRAT DOBAVLJAČU</h1><strong>{doc.interni_broj}</strong></div><div className="calculation-print-status"><strong>{supplierReturnStatus(doc.status)}</strong><span>Godina {ctx.year.godina}</span></div></header>
    <section className="calculation-print-meta"><div><span>Dobavljač</span><strong>{doc.dobavljac.naziv}</strong><small>PIB: {doc.dobavljac.pib ?? "—"}</small></div><div><span>Magacin</span><strong>{doc.magacin.sifra} · {doc.magacin.naziv}</strong><small>{doc.datum.toLocaleDateString("sr-Latn-ME")}</small></div><div><span>Broj odobrenja / povrata</span><strong>{doc.broj_odobrenja}</strong><small>Izvor: {doc.kalkulacija?.interni_broj ?? "Samostalan povrat"}</small></div></section>
    <table><thead><tr><th>#</th><th>Šifra / artikal</th><th>JM</th><th>Količina</th><th>Cijena odobrenja bez PDV</th><th>PDV %</th><th>Nabavna vrijednost</th><th>MP vrijednost</th></tr></thead><tbody>{doc.stavke.map(l => <tr key={l.id}><td>{l.redni_broj}</td><td>{l.artikal.sifra} · {l.artikal.naziv}</td><td>{l.artikal.jedinica_mjere.oznaka}</td><td>{l.kolicina.toString()}</td><td>{l.cijena_odobrenja.toString()}</td><td>{l.pdv_procenat.toString()}</td><td>{doc.status === "DRAFT" ? "—" : returnMoney(l.nabavna_vrijednost)}</td><td>{doc.status === "DRAFT" ? "—" : returnMoney(l.maloprodajna_vrijednost)}</td></tr>)}</tbody></table>
    {doc.status === "DRAFT" ? <p>NACRT — ne mijenja lager, obaveze niti KUF.</p> : <p>Osnovica: {returnMoney(doc.ukupna_osnovica)} € · Ulazni PDV: {returnMoney(doc.ukupni_ulazni_pdv)} € · Ukupno odobrenje: <strong>{returnMoney(doc.ukupno_odobrenje)} €</strong><br />Nalog: {doc.nalog?.sifra} · RUC: {returnMoney(doc.ukupna_razlika_u_cijeni)} € · Ukalkulisani PDV: {returnMoney(doc.ukupni_ukalkulisani_pdv)} €</p>}
    <p>{doc.napomena}</p><section className="calculation-print-signatures"><div>Predao: ____________________</div><div>Primio: ____________________</div></section>
  </article></main>;
}
