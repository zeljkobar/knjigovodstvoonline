import Link from "next/link";
import { MaprCalculationCreateForm } from "@/components/MaprCalculationCreateForm";
import {
  calculationStatusLabel
} from "@/lib/inventory-calculation";
import { itemPriceTypes } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";

type PageProps = {
  searchParams: Promise<{ poruka?: string; status?: string }>;
};

const messages: Record<string, string> = {
  obavezna_polja: "Popunite sva obavezna polja kalkulacije.",
  neispravne_reference: "Dobavljač ili magacin nije dostupan u izabranoj firmi.",
  dupli_racun: "Za ovaj račun dobavljača već postoji kalkulacija.",
  datum_van_godine: "Datum kalkulacije mora biti unutar izabrane poslovne godine.",
  mapr_pregled: "MAPR pregled je istekao ili nije potpun. Ponovo učitajte fiskalni link.",
  mapr_nedostupan: "MAPR servis trenutno nije dostupan. Pokušajte ponovo.",
  mapr_greska: "MAPR račun nije moguće učitati.",
  mapr_stavke: "Sve MAPR stavke moraju imati artikal i pozitivnu prodajnu cijenu.",
  mapr_povezivanje: "Ista dobavljačeva šifra mora biti povezana sa istim artiklom.",
  mapr_dobavljac_magacin: "MAPR dobavljač ili izabrani magacin nije dostupan.",
  mapr_reference: "Grupa, jedinica mjere ili PDV stopa novog artikla nije dostupna.",
  mapr_sifra: "Jedna od novih šifara artikala već postoji.",
  mapr_pdv_artikal: "PDV stopa izabranog artikla ne odgovara MAPR stavci.",
  iznos_van_opsega:
    "Jedna od unesenih cijena daje iznos ili procenat van dozvoljenog opsega. Provjerite prodajne cijene.",
  obrisana: "Nacrt kalkulacije je obrisan.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju."
};

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export default async function CalculationsPage({ searchParams }: PageProps) {
  const [{ poruka, status }, context, workContext] = await Promise.all([
    searchParams,
    getInventoryContext("view"),
    readWorkContext()
  ]);
  if (!context.firma) return <MissingInventoryContext title="Kalkulacije" />;
  if (!context.allowed) return <InventoryAccessDenied title="Kalkulacije" />;
  if (!workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header"><div><p className="eyebrow">Robno / Nabavka</p><h2>Kalkulacije</h2></div></header>
        <section className="admin-panel"><p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p></section>
      </div>
    );
  }

  const scope = {
    agencija_id: context.user.agencija_id!,
    firma_id: context.firma.id,
    poslovna_godina_id: workContext.poslovnaGodinaId,
    is_deleted: false
  };
  const [year, warehouses, calculations, items, groups, units, vatRates] = await Promise.all([
    prisma.poslovnaGodina.findFirst({
      where: { id: workContext.poslovnaGodinaId, firma_id: context.firma.id },
      select: { godina: true, zakljucena: true }
    }),
    prisma.magacin.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false
      },
      include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.kalkulacija.findMany({
      where: {
        ...scope,
        ...(status ? { status } : {})
      },
      include: {
        magacin: { select: { sifra: true, naziv: true } },
        poslovna_jedinica: { select: { sifra: true, naziv: true } },
        dobavljac: { select: { naziv: true } },
        _count: { select: { stavke: true } }
      },
      orderBy: [{ datum_kalkulacije: "desc" }, { broj: "desc" }]
    }),
    prisma.artikal.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false,
        usluga: false,
        prati_zalihe: true
      },
      include: {
        jedinica_mjere: true,
        pdv_stopa: true,
        cijene: {
          where: { tip: itemPriceTypes.retail, aktivna: true, is_deleted: false },
          orderBy: { vazi_od: "desc" },
          take: 1
        }
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivna: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.jedinicaMjere.findMany({
      where: { aktivna: true },
      orderBy: [{ redosljed: "asc" }, { naziv: "asc" }]
    }),
    prisma.pdvStopa.findMany({
      where: { agencija_id: context.user.agencija_id!, aktivna: true },
      orderBy: [{ redosljed: "asc" }, { procenat: "desc" }]
    })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Nabavka</p>
          <h2>Kalkulacije</h2>
          <p className="muted-text">{context.firma.naziv} · {year?.godina}</p>
        </div>
      </header>

      {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}

      <section className="admin-form-section">
        <div className="panel-header">
          <div><h3>Nova domaća kalkulacija</h3><p className="muted-text">Prvo unesite zaglavlje, zatim artikle i zavisne troškove.</p></div>
          <span>Nacrt ne utiče na lager</span>
        </div>
        {year?.zakljucena ? (
          <p className="admin-message">Poslovna godina je zaključana za unos.</p>
        ) : (
          <MaprCalculationCreateForm
            firmaId={context.firma.id}
            warehouses={warehouses.map((warehouse) => ({
              id: warehouse.id,
              label: `${warehouse.sifra} · ${warehouse.naziv}${warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}`
            }))}
            items={items.map((item) => ({
              id: item.id,
              sifra: item.sifra,
              naziv: item.naziv,
              unitId: item.jedinica_mjere_id,
              unitCode: item.jedinica_mjere.oznaka,
              vatRateId: item.pdv_stopa_id,
              vatPercent: item.pdv_stopa?.procenat.toString() ?? "0",
              saleGrossPrice: item.cijene[0]?.cijena_sa_pdv.toString() ?? ""
            }))}
            groups={groups.map((group) => ({
              id: group.id,
              label: `${group.sifra} · ${group.naziv}`
            }))}
            units={units.map((unit) => ({
              id: unit.id,
              label: `${unit.oznaka} · ${unit.naziv}`
            }))}
            vatRates={vatRates.map((rate) => ({
              id: rate.id,
              label: `${rate.naziv} · ${rate.procenat.toString()}%`
            }))}
          />
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled kalkulacija</h3>
          <div className="table-actions">
            <Link href="/agencija/robno/kalkulacije">Sve</Link>
            <Link href="/agencija/robno/kalkulacije?status=DRAFT">Nacrti</Link>
            <Link href="/agencija/robno/kalkulacije?status=POSTED">Proknjižene</Link>
          </div>
        </div>
        {calculations.length === 0 ? <p className="empty-state">Nema kalkulacija za izabrani filter.</p> : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Broj</th><th>Datum</th><th>Dobavljač / račun</th><th>Magacin</th><th>Poslovna jedinica</th><th>Stavke</th><th>Nabavna vrijednost</th><th>Status</th><th></th></tr></thead>
              <tbody>{calculations.map((calculation) => (
                <tr key={calculation.id}>
                  <td><strong>{calculation.interni_broj}</strong></td>
                  <td>{calculation.datum_kalkulacije.toLocaleDateString("sr-Latn-ME")}</td>
                  <td>{calculation.dobavljac.naziv}<small className="table-secondary">{calculation.broj_racuna_dobavljaca}</small></td>
                  <td>{calculation.magacin.sifra} · {calculation.magacin.naziv}</td>
                  <td>{calculation.poslovna_jedinica ? `${calculation.poslovna_jedinica.sifra} · ${calculation.poslovna_jedinica.naziv}` : "-"}</td>
                  <td>{calculation._count.stavke}</td>
                  <td className="numeric-cell">{money(calculation.ukupno_nabavna_vrijednost)}</td>
                  <td><span className={`status-badge status-${calculation.status.toLowerCase()}`}>{calculationStatusLabel(calculation.status)}</span></td>
                  <td><Link className="secondary-link" href={`/agencija/robno/kalkulacije/${calculation.id}`}>Otvori</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
