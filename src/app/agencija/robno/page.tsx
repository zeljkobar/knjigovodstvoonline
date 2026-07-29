import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "./_shared";

const nextSections = [
  {
    href: "/agencija/robno/nabavka",
    title: "Nabavka",
    description: "Kalkulacije, uvozne kalkulacije i povrati dobavljaču."
  },
  {
    href: "/agencija/robno/prodaja",
    title: "Prodaja",
    description: "Izlazne fakture, razduženja lagera i povrati kupca."
  },
  {
    href: "/agencija/robno/promet",
    title: "Promet robe",
    description: "Prenosi, popis, otpis i nivelacija."
  },
  {
    href: "/agencija/robno/zalihe",
    title: "Zalihe",
    description: "Lager lista, kartica artikla, vrijednost i kontrole."
  }
];

export default async function RobnoPage() {
  const context = await getInventoryContext("view");

  if (!context.firma) {
    return <MissingInventoryContext title="Pregled robnog knjigovodstva" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Pregled robnog knjigovodstva" />;
  }

  const scope = {
    agencija_id: context.user.agencija_id!,
    firma_id: context.firma.id,
    is_deleted: false
  };
  const [artikli, usluge, grupe, magacini] = await Promise.all([
    prisma.artikal.count({ where: { ...scope, aktivan: true, usluga: false } }),
    prisma.artikal.count({ where: { ...scope, aktivan: true, usluga: true } }),
    prisma.grupaArtikla.count({ where: { ...scope, aktivna: true } }),
    prisma.magacin.count({ where: { ...scope, aktivan: true } })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno</p>
          <h2>Pregled robnog knjigovodstva</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
        <Link className="primary-link" href="/agencija/robno/artikli">
          Novi artikal
        </Link>
      </header>

      <section className="metric-grid inventory-metric-grid">
        <article className="metric"><span>Aktivni artikli</span><strong>{artikli}</strong></article>
        <article className="metric"><span>Aktivne usluge</span><strong>{usluge}</strong></article>
        <article className="metric"><span>Grupe</span><strong>{grupe}</strong></article>
        <article className="metric"><span>Magacini</span><strong>{magacini}</strong></article>
      </section>

      <section className="inventory-codebook-grid">
        <Link className="inventory-codebook-card" href="/agencija/robno/sifarnici">
          <span>Implementirano</span>
          <strong>Šifarnici</strong>
          <small>Artikli, grupe, cijene i magacini.</small>
        </Link>
        {nextSections.map((section) => (
          <Link className="inventory-codebook-card" href={section.href} key={section.href}>
            <span>Sljedeća faza</span>
            <strong>{section.title}</strong>
            <small>{section.description}</small>
          </Link>
        ))}
      </section>
    </div>
  );
}
