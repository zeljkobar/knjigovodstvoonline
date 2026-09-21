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
} from "../../_components/inventory-report-utils";
import {
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";

type PageProps = {
  searchParams?: Promise<{
    grupa?: string;
    jedinica?: string;
    magacin?: string;
    q?: string;
    stanje?: string;
  }>;
};

type ValueTotals = {
  purchase: bigint;
  retail: bigint;
  difference: bigint;
  vat: bigint;
};

const stockFilters = new Set(["nenulto", "pozitivno", "negativno", "nulto", "sve"]);

function emptyTotals(): ValueTotals {
  return {
    purchase: BigInt(0),
    retail: BigInt(0),
    difference: BigInt(0),
    vat: BigInt(0)
  };
}

function addValues(target: ValueTotals, values: ValueTotals) {
  target.purchase += values.purchase;
  target.retail += values.retail;
  target.difference += values.difference;
  target.vat += values.vat;
}

function warehouseSalesTypeLabel(value: string) {
  return value === "WHOLESALE" ? "Veleprodaja" : "Maloprodaja";
}

export default async function InventoryValuePage({ searchParams }: PageProps) {
  const [context, params] = await Promise.all([
    loadInventoryReportContext(),
    searchParams
  ]);

  if (!context.firma) {
    return <MissingInventoryContext title="Vrijednost zaliha" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Vrijednost zaliha" />;
  }

  if (!context.year) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <p className="eyebrow">Robno / Zalihe</p>
            <h2>Vrijednost zaliha</h2>
          </div>
        </header>
        <section className="admin-panel">
          <p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p>
        </section>
      </div>
    );
  }

  const agencyId = context.user.agencija_id!;
  const scope = {
    agencija_id: agencyId,
    firma_id: context.firma.id
  };
  const [warehouses, groups, businessUnits] = await Promise.all([
    prisma.magacin.findMany({
      where: { ...scope, is_deleted: false },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      select: {
        id: true,
        sifra: true,
        naziv: true,
        aktivan: true,
        tip_prodaje: true,
        poslovna_jedinica_id: true,
        poslovna_jedinica: {
          select: { id: true, sifra: true, naziv: true, aktivna: true }
        }
      }
    }),
    prisma.grupaArtikla.findMany({
      where: { ...scope, is_deleted: false },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivna: true }
    }),
    prisma.poslovnaJedinica.findMany({
      where: { ...scope, is_deleted: false },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivna: true }
    })
  ]);

  const query = params?.q?.trim() ?? "";
  const requestedWarehouse = params?.magacin ?? "";
  const requestedGroup = params?.grupa ?? "";
  const requestedBusinessUnit = params?.jedinica ?? "";
  const warehouseId = warehouses.some((warehouse) => warehouse.id === requestedWarehouse)
    ? requestedWarehouse
    : "";
  const groupId = groups.some((group) => group.id === requestedGroup)
    ? requestedGroup
    : "";
  const businessUnitId =
    (requestedBusinessUnit === "NONE" && businessUnits.length > 0) ||
    businessUnits.some((unit) => unit.id === requestedBusinessUnit)
      ? requestedBusinessUnit
      : "";
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

  const states = await prisma.stanjeZaliha.findMany({
    where: {
      agencija_id: agencyId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.year.id,
      ...(warehouseId ? { magacin_id: warehouseId } : {}),
      ...(Object.keys(quantityFilter).length ? { kolicina: quantityFilter } : {}),
      magacin: {
        is_deleted: false,
        ...(businessUnitId
          ? {
              poslovna_jedinica_id:
                businessUnitId === "NONE" ? null : businessUnitId
            }
          : {})
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
      magacin: {
        select: {
          id: true,
          sifra: true,
          naziv: true,
          tip_prodaje: true,
          aktivan: true,
          poslovna_jedinica: {
            select: { id: true, sifra: true, naziv: true }
          }
        }
      },
      artikal: {
        select: {
          id: true,
          sifra: true,
          naziv: true,
          aktivan: true,
          grupa_artikla: {
            select: { id: true, sifra: true, naziv: true }
          },
          jedinica_mjere: { select: { oznaka: true } }
        }
      }
    },
    orderBy: [
      { magacin: { sifra: "asc" } },
      { artikal: { sifra: "asc" } }
    ]
  });

  const rows = states.map((state) => ({
    ...state,
    quantity: decimalToInventoryScaled(state.kolicina, 3),
    averagePrice: decimalToInventoryScaled(state.prosjecna_nabavna_cijena, 4),
    values: {
      purchase: decimalToInventoryScaled(state.nabavna_vrijednost, 2),
      retail: decimalToInventoryScaled(state.maloprodajna_vrijednost, 2),
      difference: decimalToInventoryScaled(state.razlika_u_cijeni, 2),
      vat: decimalToInventoryScaled(state.ukalkulisani_pdv, 2)
    }
  }));
  const totals = emptyTotals();
  const warehouseSummary = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      salesType: string;
      businessUnit: string;
      positions: number;
      articles: Set<string>;
      values: ValueTotals;
    }
  >();
  const groupSummary = new Map<
    string,
    {
      code: string;
      name: string;
      positions: number;
      articles: Set<string>;
      values: ValueTotals;
    }
  >();

  for (const row of rows) {
    addValues(totals, row.values);

    const warehouse = warehouseSummary.get(row.magacin.id) ?? {
      id: row.magacin.id,
      code: row.magacin.sifra,
      name: row.magacin.naziv,
      salesType: row.magacin.tip_prodaje,
      businessUnit: row.magacin.poslovna_jedinica
        ? `${row.magacin.poslovna_jedinica.sifra} · ${row.magacin.poslovna_jedinica.naziv}`
        : "Bez poslovne jedinice",
      positions: 0,
      articles: new Set<string>(),
      values: emptyTotals()
    };
    warehouse.positions += 1;
    warehouse.articles.add(row.artikal.id);
    addValues(warehouse.values, row.values);
    warehouseSummary.set(row.magacin.id, warehouse);

    const groupKey = row.artikal.grupa_artikla?.id ?? "UNGROUPED";
    const group = groupSummary.get(groupKey) ?? {
      code: row.artikal.grupa_artikla?.sifra ?? "—",
      name: row.artikal.grupa_artikla?.naziv ?? "Bez grupe",
      positions: 0,
      articles: new Set<string>(),
      values: emptyTotals()
    };
    group.positions += 1;
    group.articles.add(row.artikal.id);
    addValues(group.values, row.values);
    groupSummary.set(groupKey, group);
  }

  const warehouseRows = [...warehouseSummary.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "sr-Latn-ME")
  );
  const groupRows = [...groupSummary.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "sr-Latn-ME")
  );
  const uniqueArticleCount = new Set(rows.map((row) => row.artikal.id)).size;

  return (
    <div className="admin-stack inventory-value-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Zalihe</p>
          <h2>Vrijednost zaliha</h2>
          <p className="muted-text">
            {context.firma.naziv} · {context.year.godina} · trenutno knjigovodstveno stanje
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/robno/lager">
            Lager lista
          </Link>
          <Link className="secondary-button" href="/agencija/robno/kartica-artikla">
            Kartica artikla
          </Link>
        </div>
      </header>

      <section className="metric-grid inventory-metric-grid inventory-value-metrics">
        <article className="metric">
          <span>Nabavna vrijednost</span>
          <strong className="metric-text">{formatInventoryMoney(totals.purchase)}</strong>
        </article>
        <article className="metric">
          <span>Maloprodajna vrijednost</span>
          <strong className="metric-text">{formatInventoryMoney(totals.retail)}</strong>
        </article>
        <article className="metric">
          <span>Razlika u cijeni</span>
          <strong className="metric-text">{formatInventoryMoney(totals.difference)}</strong>
        </article>
        <article className="metric">
          <span>Ukalkulisani PDV</span>
          <strong className="metric-text">{formatInventoryMoney(totals.vat)}</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Filteri izvještaja</h3>
            <p className="muted-text">
              {uniqueArticleCount} artikala na {rows.length} magacinskih pozicija. Vrijednosti su u EUR.
            </p>
          </div>
        </div>
        <AutoSubmitFilterForm
          action="/agencija/robno/vrijednost-zaliha"
          className="admin-form inline-filter-form inventory-value-filter"
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
          {businessUnits.length ? (
            <label>
              <span>Poslovna jedinica</span>
              <select defaultValue={businessUnitId || "ALL"} name="jedinica">
                <option value="ALL">Sve jedinice</option>
                <option value="NONE">Bez poslovne jedinice</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.sifra} · {unit.naziv}{unit.aktivna ? "" : " (neaktivna)"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            <span>Grupa artikala</span>
            <select defaultValue={groupId || "ALL"} name="grupa">
              <option value="ALL">Sve grupe</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.sifra} · {group.naziv}{group.aktivna ? "" : " (neaktivna)"}
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
            <h3>Vrijednost po magacinu</h3>
            <p className="muted-text">
              Maloprodajna vrijednost, razlika u cijeni i ukalkulisani PDV primjenjuju se na maloprodajne magacine.
            </p>
          </div>
          <span>{warehouseRows.length} magacina</span>
        </div>
        <div className="table-wrap">
          <table className="admin-table inventory-report-table inventory-value-summary-table">
            <thead>
              <tr>
                <th>Magacin</th>
                <th>Poslovna jedinica</th>
                <th>Tip</th>
                <th>Nabavna vrijednost</th>
                <th>Razlika u cijeni</th>
                <th>Ukalkulisani PDV</th>
                <th>Maloprodajna vrijednost</th>
              </tr>
            </thead>
            <tbody>
              {warehouseRows.length ? warehouseRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.code}</strong>
                    <small>{row.name}</small>
                    <small>{row.articles.size} artikala · {row.positions} pozicija</small>
                  </td>
                  <td>{row.businessUnit}</td>
                  <td>{warehouseSalesTypeLabel(row.salesType)}</td>
                  <td>{formatInventoryMoney(row.values.purchase)}</td>
                  <td>{formatInventoryMoney(row.values.difference)}</td>
                  <td>{formatInventoryMoney(row.values.vat)}</td>
                  <td>{formatInventoryMoney(row.values.retail)}</td>
                </tr>
              )) : (
                <tr><td className="empty-state" colSpan={7}>Nema zaliha za izabrane filtere.</td></tr>
              )}
            </tbody>
            {warehouseRows.length ? (
              <tfoot>
                <tr className="balance-total-row">
                  <td colSpan={3}>Ukupno</td>
                  <td>{formatInventoryMoney(totals.purchase)}</td>
                  <td>{formatInventoryMoney(totals.difference)}</td>
                  <td>{formatInventoryMoney(totals.vat)}</td>
                  <td>{formatInventoryMoney(totals.retail)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div><h3>Vrijednost po grupi artikala</h3></div>
          <span>{groupRows.length} grupa</span>
        </div>
        <div className="table-wrap">
          <table className="admin-table inventory-report-table inventory-value-summary-table">
            <thead>
              <tr>
                <th>Grupa</th>
                <th>Nabavna vrijednost</th>
                <th>Razlika u cijeni</th>
                <th>Ukalkulisani PDV</th>
                <th>Maloprodajna vrijednost</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.length ? groupRows.map((row) => (
                <tr key={`${row.code}-${row.name}`}>
                  <td>
                    <strong>{row.code}</strong>
                    <small>{row.name}</small>
                    <small>{row.articles.size} artikala · {row.positions} pozicija</small>
                  </td>
                  <td>{formatInventoryMoney(row.values.purchase)}</td>
                  <td>{formatInventoryMoney(row.values.difference)}</td>
                  <td>{formatInventoryMoney(row.values.vat)}</td>
                  <td>{formatInventoryMoney(row.values.retail)}</td>
                </tr>
              )) : (
                <tr><td className="empty-state" colSpan={5}>Nema grupa za izabrane filtere.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div><h3>Detaljna vrijednost artikala</h3></div>
          <span>{rows.length} redova</span>
        </div>
        <div className="table-wrap inventory-value-detail-wrap">
          <table className="admin-table inventory-report-table inventory-value-detail-table">
            <thead>
              <tr>
                <th>Magacin</th>
                <th>Artikal</th>
                <th>Grupa</th>
                <th>JM</th>
                <th>Količina</th>
                <th>Prosj. nabavna cijena</th>
                <th>Nabavna vrijednost</th>
                <th>Razlika u cijeni</th>
                <th>Ukalkulisani PDV</th>
                <th>Maloprodajna vrijednost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => {
                const cardQuery = new URLSearchParams({
                  artikal: row.artikal.id,
                  magacin: row.magacin_id
                });

                return (
                  <tr key={row.id}>
                    <td><strong>{row.magacin.sifra}</strong><small>{row.magacin.naziv}</small></td>
                    <td><strong>{row.artikal.sifra}</strong><small>{row.artikal.naziv}</small></td>
                    <td>{row.artikal.grupa_artikla?.naziv ?? "Bez grupe"}</td>
                    <td>{row.artikal.jedinica_mjere.oznaka}</td>
                    <td className={row.quantity < BigInt(0) ? "inventory-negative-value" : undefined}>
                      {formatInventoryQuantity(row.quantity)}
                    </td>
                    <td>{formatInventoryUnitPrice(row.averagePrice)}</td>
                    <td>{formatInventoryMoney(row.values.purchase)}</td>
                    <td>{formatInventoryMoney(row.values.difference)}</td>
                    <td>{formatInventoryMoney(row.values.vat)}</td>
                    <td>{formatInventoryMoney(row.values.retail)}</td>
                    <td>
                      <Link className="table-link" href={`/agencija/robno/kartica-artikla?${cardQuery.toString()}`}>
                        Kartica
                      </Link>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="empty-state" colSpan={11}>Nema artikala za izabrane filtere.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
