import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";

const sections = [
  {
    href: "/agencija/robno/artikli",
    title: "Artikli",
    description: "Roba i usluge, šifre, barkodovi, jedinice mjere i PDV stope.",
    key: "artikli"
  },
  {
    href: "/agencija/robno/grupe",
    title: "Grupe artikala",
    description: "Opcionalno razvrstavanje artikala po jednoj grupi.",
    key: "grupe"
  },
  {
    href: "/agencija/robno/cijene",
    title: "Cijene",
    description: "Veleprodajne i maloprodajne cijene sa istorijom važenja.",
    key: "cijene"
  },
  {
    href: "/agencija/robno/magacini",
    title: "Magacini",
    description: "Mjesta zaliha i pravila za negativan lager.",
    key: "magacini"
  }
] as const;

export default async function InventoryCodebooksPage() {
  const context = await getInventoryContext("view");

  if (!context.firma) {
    return <MissingInventoryContext title="Šifarnici" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Šifarnici" />;
  }

  const [artikli, grupe, cijene, magacini] = await Promise.all([
    prisma.artikal.count({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false
      }
    }),
    prisma.grupaArtikla.count({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false
      }
    }),
    prisma.cijenaArtikla.count({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false
      }
    }),
    prisma.magacin.count({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false
      }
    })
  ]);
  const counts = { artikli, grupe, cijene, magacini };

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno</p>
          <h2>Šifarnici</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
      </header>

      <section className="inventory-codebook-grid">
        {sections.map((section) => (
          <Link className="inventory-codebook-card" href={section.href} key={section.href}>
            <span>{counts[section.key]} zapisa</span>
            <strong>{section.title}</strong>
            <small>{section.description}</small>
          </Link>
        ))}
      </section>
    </div>
  );
}
