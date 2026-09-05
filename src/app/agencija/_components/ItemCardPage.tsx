import Link from "next/link";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  decimalToInventoryScaled,
  formatInventoryDate,
  formatInventoryMoney,
  formatInventoryQuantity,
  formatInventoryUnitPrice,
  inventoryDocumentLabel,
  inventoryMovementSign,
  loadInventoryReportContext,
  parseInventoryReportDate
} from "./inventory-report-utils";
import {
  InventoryAccessDenied,
  MissingInventoryContext
} from "../robno/_shared";

type ItemCardPageProps = {
  basePath: string;
  lagerPath: string;
  sectionLabel: string;
  requireReportsPermission?: boolean;
  searchParams?: Promise<{
    artikal?: string;
    datum_do?: string;
    datum_od?: string;
    magacin?: string;
  }>;
};

type DocumentMeta = {
  href: string;
  label: string;
};

export async function ItemCardPage({
  basePath,
  lagerPath,
  sectionLabel,
  requireReportsPermission = false,
  searchParams
}: ItemCardPageProps) {
  const [context, params] = await Promise.all([
    loadInventoryReportContext(),
    searchParams
  ]);

  if (!context.firma) {
    return <MissingInventoryContext title="Kartica artikla" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Kartica artikla" />;
  }

  if (
    requireReportsPermission &&
    !(await hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: "izvjestaji",
      akcija: "view"
    }))
  ) {
    return <InventoryAccessDenied title="Kartica artikla" />;
  }

  if (!context.year) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <p className="eyebrow">{sectionLabel}</p>
            <h2>Kartica artikla</h2>
          </div>
        </header>
        <section className="admin-panel">
          <p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p>
        </section>
      </div>
    );
  }

  const agencyId = context.user.agencija_id!;
  const selectedItemId = params?.artikal ?? "";
  const selectedWarehouseId = params?.magacin ?? "";
  const dateFrom = parseInventoryReportDate(params?.datum_od);
  const dateTo = parseInventoryReportDate(params?.datum_do);
  const scope = {
    agencija_id: agencyId,
    firma_id: context.firma.id,
    poslovna_godina_id: context.year.id
  };
  const [items, warehouses] = await Promise.all([
    prisma.artikal.findMany({
      where: {
        agencija_id: agencyId,
        firma_id: context.firma.id,
        is_deleted: false,
        usluga: false,
        prati_zalihe: true
      },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      select: {
        id: true,
        sifra: true,
        naziv: true,
        barkod: true,
        aktivan: true,
        grupa_artikla: { select: { naziv: true } },
        jedinica_mjere: { select: { oznaka: true, naziv: true } }
      }
    }),
    prisma.magacin.findMany({
      where: {
        agencija_id: agencyId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivan: true }
    })
  ]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;

  const movementScope = {
    ...scope,
    artikal_id: selectedItem?.id ?? "",
    ...(selectedWarehouseId ? { magacin_id: selectedWarehouseId } : {})
  };
  const [openingMovements, movements] = selectedItem
    ? await Promise.all([
        dateFrom
          ? prisma.prometZaliha.findMany({
              where: {
                ...movementScope,
                datum_prometa: { lt: dateFrom }
              },
              select: {
                smjer: true,
                kolicina: true,
                nabavna_vrijednost: true
              }
            })
          : Promise.resolve([]),
        prisma.prometZaliha.findMany({
          where: {
            ...movementScope,
            ...(dateFrom || dateTo
              ? {
                  datum_prometa: {
                    ...(dateFrom ? { gte: dateFrom } : {}),
                    ...(dateTo ? { lte: dateTo } : {})
                  }
                }
              : {})
          },
          orderBy: [{ datum_prometa: "asc" }, { created_at: "asc" }, { id: "asc" }],
          include: {
            magacin: { select: { sifra: true, naziv: true } },
            kalkulacija: { select: { interni_broj: true } }
          }
        })
      ])
    : [[], []];
  const invoiceIds = Array.from(
    new Set(
      movements
        .filter((movement) =>
          ["OUTGOING_INVOICE", "POS_SALE", "POS_RETURN"].includes(
            movement.tip_dokumenta
          )
        )
        .map((movement) => movement.dokument_id)
    )
  );
  const invoices = invoiceIds.length
    ? await prisma.fiskalniIzlazniRacun.findMany({
        where: {
          agencija_id: agencyId,
          firma_id: context.firma.id,
          id: { in: invoiceIds },
          is_deleted: false
        },
        select: {
          id: true,
          broj_racuna: true,
          official_invoice_number: true,
          sales_channel: true
        }
      })
    : [];
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const opening = openingMovements.reduce(
    (sum, movement) => {
      const sign = inventoryMovementSign(movement.smjer);
      sum.quantity += sign * decimalToInventoryScaled(movement.kolicina, 3);
      sum.value += sign * decimalToInventoryScaled(movement.nabavna_vrijednost, 2);
      return sum;
    },
    { quantity: BigInt(0), value: BigInt(0) }
  );
  let runningQuantity = opening.quantity;
  let runningValue = opening.value;
  const rows = movements.map((movement) => {
    const sign = inventoryMovementSign(movement.smjer);
    const quantity = decimalToInventoryScaled(movement.kolicina, 3);
    const value = decimalToInventoryScaled(movement.nabavna_vrijednost, 2);
    runningQuantity += sign * quantity;
    runningValue += sign * value;

    return {
      ...movement,
      quantity,
      value,
      unitPrice: decimalToInventoryScaled(movement.jedinicna_nabavna_cijena, 4),
      runningQuantity,
      runningValue
    };
  });
  const totalIn = rows.reduce(
    (sum, row) => sum + (row.smjer === "IN" ? row.quantity : BigInt(0)),
    BigInt(0)
  );
  const totalOut = rows.reduce(
    (sum, row) => sum + (row.smjer === "OUT" ? row.quantity : BigInt(0)),
    BigInt(0)
  );

  function documentMeta(row: (typeof rows)[number]): DocumentMeta | null {
    if (row.tip_dokumenta === "CALCULATION") {
      return {
        href: `/agencija/robno/kalkulacije/${row.dokument_id}`,
        label: row.kalkulacija?.interni_broj ?? "Otvori kalkulaciju"
      };
    }

    if (["WAREHOUSE_TRANSFER_OUT", "WAREHOUSE_TRANSFER_IN"].includes(row.tip_dokumenta)) {
      return {
        href: `/agencija/robno/prenos/${row.dokument_id}`,
        label: "Otvori prenos robe"
      };
    }

    if (["STOCK_COUNT_SURPLUS", "STOCK_COUNT_SHORTAGE"].includes(row.tip_dokumenta)) {
      return {
        href: `/agencija/robno/popis/${row.dokument_id}`,
        label: "Otvori popis robe"
      };
    }

    if (row.tip_dokumenta === "WRITE_OFF") {
      return {
        href: `/agencija/robno/otpis/${row.dokument_id}`,
        label: "Otvori otpis robe"
      };
    }

    if (["PRICE_ADJUSTMENT_UP", "PRICE_ADJUSTMENT_DOWN"].includes(row.tip_dokumenta)) {
      return {
        href: `/agencija/robno/nivelacija/${row.dokument_id}`,
        label: "Otvori nivelaciju"
      };
    }

    const invoice = invoiceMap.get(row.dokument_id);

    if (!invoice) {
      return null;
    }

    const label = invoice.official_invoice_number ?? invoice.broj_racuna;

    if (row.tip_dokumenta === "OUTGOING_INVOICE") {
      return {
        href: `/agencija/robno/izlazne-fakture/${invoice.id}`,
        label
      };
    }
    return {
      href: `/stampa/pos/racuni/${invoice.id}`,
      label
    };
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">{sectionLabel}</p>
          <h2>Kartica artikla</h2>
          <p className="muted-text">
            {context.firma.naziv} · {context.year.godina}
          </p>
        </div>
        <Link className="secondary-button" href={lagerPath}>
          Lager lista
        </Link>
      </header>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Izbor kartice</h3>
            <p className="muted-text">Izaberite artikal, magacin i željeni period.</p>
          </div>
        </div>
        <AutoSubmitFilterForm
          action={basePath}
          className="admin-form inline-filter-form inventory-filter-form inventory-report-filter"
        >
          <label className="form-span-2">
            <span>Artikal</span>
            <select defaultValue={selectedItemId || "ALL"} name="artikal">
              <option value="ALL">Izaberite artikal</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sifra} · {item.naziv}{item.aktivan ? "" : " (neaktivan)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Magacin</span>
            <select defaultValue={selectedWarehouseId || "ALL"} name="magacin">
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
            <span>Datum od</span>
            <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
          </label>
        </AutoSubmitFilterForm>
      </section>

      {!selectedItem ? (
        <section className="admin-panel">
          <p className="empty-state">Izaberite artikal da otvorite njegovu karticu.</p>
        </section>
      ) : (
        <>
          <section className="admin-panel inventory-item-card-heading">
            <div className="panel-header">
              <div>
                <h3>{selectedItem.sifra} · {selectedItem.naziv}</h3>
                <p className="muted-text">
                  {selectedItem.grupa_artikla?.naziv ?? "Bez grupe"} · {selectedItem.jedinica_mjere.naziv}
                  {selectedItem.barkod ? ` · Barkod ${selectedItem.barkod}` : ""}
                </p>
              </div>
              <span>{rows.length} prometa</span>
            </div>
          </section>

          <section className="stats-grid">
            <article className="stat-card">
              <span>Početno stanje perioda</span>
              <strong>{formatInventoryQuantity(opening.quantity)}</strong>
            </article>
            <article className="stat-card">
              <span>Ulaz u periodu</span>
              <strong>{formatInventoryQuantity(totalIn)}</strong>
            </article>
            <article className="stat-card">
              <span>Izlaz u periodu</span>
              <strong>{formatInventoryQuantity(totalOut)}</strong>
            </article>
            <article className="stat-card">
              <span>Završno stanje</span>
              <strong className={runningQuantity < BigInt(0) ? "inventory-negative-value" : undefined}>
                {formatInventoryQuantity(runningQuantity)}
              </strong>
            </article>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <div>
                <h3>Promet artikla</h3>
                <span>Ulazi, izlazi i tekuće stanje nakon svakog dokumenta</span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="admin-table inventory-report-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Magacin</th>
                    <th>Dokument</th>
                    <th>Broj dokumenta</th>
                    <th>Ulaz</th>
                    <th>Izlaz</th>
                    <th>Nabavna cijena</th>
                    <th>Nabavna vrijednost</th>
                    <th>Stanje</th>
                    <th>Vrijednost stanja</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => {
                      const document = documentMeta(row);

                      return (
                        <tr key={row.id}>
                          <td>{formatInventoryDate(row.datum_prometa)}</td>
                          <td>
                            <strong>{row.magacin.sifra}</strong>
                            <small>{row.magacin.naziv}</small>
                          </td>
                          <td>{inventoryDocumentLabel(row.tip_dokumenta)}</td>
                          <td>
                            {document ? (
                              <Link
                                className="table-link"
                                href={document.href}
                                target={row.tip_dokumenta.startsWith("POS_") ? "_blank" : undefined}
                              >
                                {document.label}
                              </Link>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{row.smjer === "IN" ? formatInventoryQuantity(row.quantity) : "-"}</td>
                          <td>{row.smjer === "OUT" ? formatInventoryQuantity(row.quantity) : "-"}</td>
                          <td>{formatInventoryUnitPrice(row.unitPrice)}</td>
                          <td>{formatInventoryMoney(row.value)}</td>
                          <td className={row.runningQuantity < BigInt(0) ? "inventory-negative-value" : undefined}>
                            <strong>{formatInventoryQuantity(row.runningQuantity)}</strong>
                          </td>
                          <td>{formatInventoryMoney(row.runningValue)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="empty-state" colSpan={10}>
                        Nema prometa za izabrani artikal i period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
