import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { prisma } from "@/lib/prisma";
import {
  decimalToInventoryScaled,
  formatInventoryMoney,
  formatInventoryQuantity,
  formatInventoryUnitPrice,
  loadInventoryReportContext
} from "./inventory-report-utils";
import {
  InventoryAccessDenied,
  MissingInventoryContext
} from "../robno/_shared";

type LagerListPageProps = {
  basePath: string;
  itemCardPath: string;
  sectionLabel: string;
  searchParams?: Promise<{
    grupa?: string;
    magacin?: string;
    q?: string;
    stanje?: string;
  }>;
};

const stockFilters = new Set(["nenulto", "pozitivno", "negativno", "nulto", "sve"]);

export async function LagerListPage({
  basePath,
  itemCardPath,
  sectionLabel,
  searchParams
}: LagerListPageProps) {
  const [context, params] = await Promise.all([
    loadInventoryReportContext(),
    searchParams
  ]);

  if (!context.firma) {
    return <MissingInventoryContext title="Lager lista" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Lager lista" />;
  }

  if (!context.year) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <p className="eyebrow">{sectionLabel}</p>
            <h2>Lager lista</h2>
          </div>
        </header>
        <section className="admin-panel">
          <p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p>
        </section>
      </div>
    );
  }

  const agencyId = context.user.agencija_id!;
  const query = params?.q?.trim() ?? "";
  const warehouseId = params?.magacin ?? "";
  const groupId = params?.grupa ?? "";
  const stockFilter = stockFilters.has(params?.stanje ?? "")
    ? params!.stanje!
    : "nenulto";
  const quantityFilter: Prisma.DecimalFilter =
    stockFilter === "pozitivno"
      ? { gt: 0 }
      : stockFilter === "negativno"
        ? { lt: 0 }
        : stockFilter === "nulto"
          ? { equals: 0 }
          : stockFilter === "nenulto"
            ? { not: 0 }
            : {};
  const scope = {
    agencija_id: agencyId,
    firma_id: context.firma.id,
    poslovna_godina_id: context.year.id
  };

  const [warehouses, groups, states] = await Promise.all([
    prisma.magacin.findMany({
      where: {
        agencija_id: agencyId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivan: true }
    }),
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: agencyId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivna: true }
    }),
    prisma.stanjeZaliha.findMany({
      where: {
        ...scope,
        ...(warehouseId ? { magacin_id: warehouseId } : {}),
        ...(Object.keys(quantityFilter).length ? { kolicina: quantityFilter } : {}),
        magacin: {
          is_deleted: false
        },
        artikal: {
          is_deleted: false,
          usluga: false,
          prati_zalihe: true,
          ...(groupId ? { grupa_artikla_id: groupId } : {}),
          ...(query
            ? {
                OR: [
                  { sifra: { contains: query, mode: "insensitive" } },
                  { naziv: { contains: query, mode: "insensitive" } },
                  { barkod: { contains: query, mode: "insensitive" } }
                ]
              }
            : {})
        }
      },
      include: {
        magacin: { select: { sifra: true, naziv: true, aktivan: true } },
        artikal: {
          select: {
            id: true,
            sifra: true,
            naziv: true,
            aktivan: true,
            grupa_artikla: { select: { naziv: true } },
            jedinica_mjere: { select: { oznaka: true } }
          }
        }
      },
      orderBy: [
        { magacin: { sifra: "asc" } },
        { artikal: { sifra: "asc" } }
      ]
    })
  ]);

  const rows = states.map((state) => ({
    ...state,
    quantity: decimalToInventoryScaled(state.kolicina, 3),
    averagePrice: decimalToInventoryScaled(state.prosjecna_nabavna_cijena, 4),
    purchaseValue: decimalToInventoryScaled(state.nabavna_vrijednost, 2),
    retailValue: decimalToInventoryScaled(state.maloprodajna_vrijednost, 2),
    priceDifference: decimalToInventoryScaled(state.razlika_u_cijeni, 2),
    includedVat: decimalToInventoryScaled(state.ukalkulisani_pdv, 2)
  }));
  const totals = rows.reduce(
    (sum, row) => ({
      purchaseValue: sum.purchaseValue + row.purchaseValue,
      retailValue: sum.retailValue + row.retailValue,
      priceDifference: sum.priceDifference + row.priceDifference,
      includedVat: sum.includedVat + row.includedVat
    }),
    {
      purchaseValue: BigInt(0),
      retailValue: BigInt(0),
      priceDifference: BigInt(0),
      includedVat: BigInt(0)
    }
  );
  const negativeCount = rows.filter((row) => row.quantity < BigInt(0)).length;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">{sectionLabel}</p>
          <h2>Lager lista</h2>
          <p className="muted-text">
            {context.firma.naziv} · {context.year.godina} · trenutno stanje
          </p>
        </div>
        <Link className="secondary-button" href={itemCardPath}>
          Kartica artikla
        </Link>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Stavki lagera</span>
          <strong>{rows.length}</strong>
        </article>
        <article className="stat-card">
          <span>Nabavna vrijednost</span>
          <strong>{formatInventoryMoney(totals.purchaseValue)}</strong>
        </article>
        <article className="stat-card">
          <span>Maloprodajna vrijednost</span>
          <strong>{formatInventoryMoney(totals.retailValue)}</strong>
        </article>
        <article className="stat-card">
          <span>Negativno stanje</span>
          <strong>{negativeCount}</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Filteri</h3>
            <p className="muted-text">Stanje je vezano za aktivnu firmu i poslovnu godinu.</p>
          </div>
        </div>
        <AutoSubmitFilterForm
          action={basePath}
          className="admin-form inline-filter-form inventory-filter-form inventory-report-filter"
        >
          <label>
            <span>Pretraga</span>
            <input
              defaultValue={query}
              name="q"
              placeholder="Šifra, naziv ili barkod"
              type="search"
            />
          </label>
          <label>
            <span>Magacin</span>
            <select defaultValue={warehouseId || "ALL"} name="magacin">
              <option value="ALL">Svi magacini</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.sifra} · {warehouse.naziv}
                  {warehouse.aktivan ? "" : " (neaktivan)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Grupa</span>
            <select defaultValue={groupId || "ALL"} name="grupa">
              <option value="ALL">Sve grupe</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.sifra} · {group.naziv}
                  {group.aktivna ? "" : " (neaktivna)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Stanje</span>
            <select defaultValue={stockFilter} name="stanje">
              <option value="nenulto">Bez nultih stanja</option>
              <option value="pozitivno">Samo pozitivno</option>
              <option value="negativno">Samo negativno</option>
              <option value="nulto">Samo nulto</option>
              <option value="sve">Sve</option>
            </select>
          </label>
        </AutoSubmitFilterForm>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Stanje artikala po magacinu</h3>
            <span>{rows.length} redova</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="admin-table inventory-report-table">
            <thead>
              <tr>
                <th>Magacin</th>
                <th>Artikal</th>
                <th>Grupa</th>
                <th>JM</th>
                <th>Količina</th>
                <th>Prosj. nabavna cijena</th>
                <th>Nabavna vrijednost</th>
                <th>Maloprodajna vrijednost</th>
                <th>Razlika u cijeni</th>
                <th>Ukalkulisani PDV</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((row) => {
                  const cardQuery = new URLSearchParams({
                    artikal: row.artikal.id,
                    magacin: row.magacin_id
                  });

                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.magacin.sifra}</strong>
                        <small>{row.magacin.naziv}</small>
                      </td>
                      <td>
                        <strong>{row.artikal.sifra}</strong>
                        <small>{row.artikal.naziv}</small>
                      </td>
                      <td>{row.artikal.grupa_artikla?.naziv ?? "-"}</td>
                      <td>{row.artikal.jedinica_mjere.oznaka}</td>
                      <td className={row.quantity < BigInt(0) ? "inventory-negative-value" : undefined}>
                        <strong>{formatInventoryQuantity(row.quantity)}</strong>
                      </td>
                      <td>{formatInventoryUnitPrice(row.averagePrice)}</td>
                      <td>{formatInventoryMoney(row.purchaseValue)}</td>
                      <td>{formatInventoryMoney(row.retailValue)}</td>
                      <td>{formatInventoryMoney(row.priceDifference)}</td>
                      <td>{formatInventoryMoney(row.includedVat)}</td>
                      <td>
                        <Link className="table-link" href={`${itemCardPath}?${cardQuery.toString()}`}>
                          Kartica
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-state" colSpan={11}>
                    Nema stanja zaliha za izabrane filtere.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length ? (
              <tfoot>
                <tr className="balance-total-row">
                  <td colSpan={6}>Ukupna vrijednost</td>
                  <td>{formatInventoryMoney(totals.purchaseValue)}</td>
                  <td>{formatInventoryMoney(totals.retailValue)}</td>
                  <td>{formatInventoryMoney(totals.priceDifference)}</td>
                  <td>{formatInventoryMoney(totals.includedVat)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>
    </div>
  );
}
