import Link from "next/link";
import { createItemPrice, toggleItemPrice, updateItemPrice } from "../actions";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import {
  initialItemPriceTypes,
  inventoryModule,
  itemPriceTypeLabel
} from "@/lib/inventory";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type ItemPricesPageProps = {
  searchParams?: Promise<{
    q?: string;
    artikal_id?: string;
    uredi?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  cijena_kreirana: "Cijena je dodata.",
  cijena_sacuvana: "Cijena je sačuvana.",
  cijena_aktivirana: "Cijena je aktivirana.",
  cijena_deaktivirana: "Cijena je deaktivirana.",
  cijena_obavezno: "Tip cijene i ispravan iznos su obavezni.",
  cijena_period: "Datum završetka važenja ne može biti prije početnog datuma.",
  cijena_greska: "Cijena nije pronađena.",
  kontekst: "Izaberite važeću firmu u gornjoj traci.",
  prava: "Nemate pravo za ovu akciju."
};

function inputDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function ItemPricesPage({ searchParams }: ItemPricesPageProps) {
  const context = await getInventoryContext("view");
  const params = await searchParams;

  if (!context.firma) {
    return <MissingInventoryContext title="Cijene artikala" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Cijene artikala" />;
  }

  const q = params?.q?.trim() ?? "";
  const itemId = params?.artikal_id ?? "";
  const scope = {
    agencija_id: context.user.agencija_id!,
    firma_id: context.firma.id,
    is_deleted: false
  };
  const [canCreate, canUpdate, selectedItem, itemResults] = await Promise.all([
    hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: inventoryModule,
      akcija: "create"
    }),
    hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: inventoryModule,
      akcija: "update"
    }),
    itemId
      ? prisma.artikal.findFirst({
          where: { ...scope, id: itemId },
          include: {
            pdv_stopa: { select: { procenat: true } },
            jedinica_mjere: { select: { oznaka: true } }
          }
        })
      : Promise.resolve(null),
    prisma.artikal.findMany({
      where: {
        ...scope,
        ...(q
          ? {
              OR: [
                { sifra: { contains: q, mode: "insensitive" as const } },
                { naziv: { contains: q, mode: "insensitive" as const } },
                { barkod: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {}),
        aktivan: true
      },
      include: {
        pdv_stopa: { select: { procenat: true } },
        _count: { select: { cijene: true } }
      },
      orderBy: { sifra: "asc" },
      take: q ? 100 : 30
    })
  ]);
  const prices = selectedItem
    ? await prisma.cijenaArtikla.findMany({
        where: { ...scope, artikal_id: selectedItem.id },
        orderBy: [{ aktivna: "desc" }, { vazi_od: "desc" }, { created_at: "desc" }]
      })
    : [];
  const editedPrice = params?.uredi
    ? prices.find((price) => price.id === params.uredi) ?? null
    : null;
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>Cijene artikala</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
        <Link className="secondary-button" href="/agencija/robno/sifarnici">
          Nazad na šifarnike
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <form className="admin-form inventory-price-search" method="get">
          <label className="form-span-2">
            <span>Pronađi artikal</span>
            <input defaultValue={q} name="q" placeholder="Šifra, naziv ili barkod" />
          </label>
          <button type="submit">Pretraži</button>
        </form>
        <div className="panel-header inventory-list-header">
          <h3>Izbor artikla</h3>
          <span>{itemResults.length === 100 ? "Prvih 100 rezultata" : `${itemResults.length} prikazano`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Tip</th>
                <th>PDV</th>
                <th>Broj cijena</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itemResults.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.sifra}</strong></td>
                  <td>{item.naziv}</td>
                  <td>{item.usluga ? "Usluga" : "Roba"}</td>
                  <td>{item.pdv_stopa ? `${item.pdv_stopa.procenat.toString()}%` : "0%"}</td>
                  <td>{item._count.cijene}</td>
                  <td>
                    <Link
                      className="table-button"
                      href={{ pathname: "/agencija/robno/cijene", query: { q, artikal_id: item.id } }}
                    >
                      {selectedItem?.id === item.id ? "Izabran" : "Izaberi"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedItem ? (
        <>
          {(editedPrice ? canUpdate : canCreate) ? (
            <section className="admin-form-section">
              <div className="panel-header">
                <div>
                  <h3>{editedPrice ? "Izmijeni cijenu" : "Nova cijena"}</h3>
                  <p className="muted-text">
                    {selectedItem.sifra} — {selectedItem.naziv}; PDV{" "}
                    {selectedItem.pdv_stopa?.procenat.toString() ?? "0"}%
                  </p>
                </div>
                {editedPrice ? (
                  <Link
                    href={{
                      pathname: "/agencija/robno/cijene",
                      query: { q, artikal_id: selectedItem.id }
                    }}
                  >
                    Otkaži izmjenu
                  </Link>
                ) : null}
              </div>
              <form
                action={editedPrice ? updateItemPrice : createItemPrice}
                className="admin-form inventory-price-form"
              >
                <input name="firma_id" type="hidden" value={context.firma.id} />
                <input name="artikal_id" type="hidden" value={selectedItem.id} />
                <input name="cijena_id" type="hidden" value={editedPrice?.id ?? ""} />
                <label>
                  <span>Tip cijene</span>
                  <select defaultValue={editedPrice?.tip ?? initialItemPriceTypes[0].value} name="tip">
                    {initialItemPriceTypes.map((priceType) => (
                      <option key={priceType.value} value={priceType.value}>
                        {priceType.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Unos iznosa</span>
                  <select defaultValue="BEZ_PDV" name="unos_tip">
                    <option value="BEZ_PDV">Bez PDV-a</option>
                    <option value="SA_PDV">Sa PDV-om</option>
                  </select>
                </label>
                <label>
                  <span>Iznos (EUR)</span>
                  <input
                    defaultValue={editedPrice?.cijena_bez_pdv.toString() ?? ""}
                    inputMode="decimal"
                    min="0"
                    name="iznos"
                    placeholder="0,00"
                    required
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  <span>Važi od</span>
                  <input defaultValue={inputDate(editedPrice?.vazi_od ?? null)} name="vazi_od" type="date" />
                </label>
                <label>
                  <span>Važi do</span>
                  <input defaultValue={inputDate(editedPrice?.vazi_do ?? null)} name="vazi_do" type="date" />
                </label>
                <label className="form-span-2">
                  <span>Napomena</span>
                  <input defaultValue={editedPrice?.napomena ?? ""} name="napomena" />
                </label>
                <button type="submit">{editedPrice ? "Sačuvaj cijenu" : "Dodaj cijenu"}</button>
              </form>
            </section>
          ) : null}

          <section className="admin-panel">
            <div className="panel-header">
              <div>
                <h3>Istorija cijena</h3>
                <p className="muted-text">
                  {selectedItem.sifra} — {selectedItem.naziv}
                </p>
              </div>
              <span>{prices.length} ukupno</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tip</th>
                    <th>Bez PDV-a</th>
                    <th>PDV</th>
                    <th>Sa PDV-om</th>
                    <th>Važenje</th>
                    <th>Status</th>
                    <th>Napomena</th>
                    {canUpdate ? <th>Akcije</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {prices.length ? prices.map((price) => (
                    <tr key={price.id}>
                      <td><strong>{itemPriceTypeLabel(price.tip)}</strong></td>
                      <td>{price.cijena_bez_pdv.toString()} {price.valuta}</td>
                      <td>{price.pdv_stopa_procenat.toString()}%</td>
                      <td>{price.cijena_sa_pdv.toString()} {price.valuta}</td>
                      <td>
                        {price.vazi_od ? price.vazi_od.toLocaleDateString("sr-Latn-ME") : "Odmah"}
                        {" — "}
                        {price.vazi_do ? price.vazi_do.toLocaleDateString("sr-Latn-ME") : "bez kraja"}
                      </td>
                      <td>{price.aktivna ? "Aktivna" : "Neaktivna"}</td>
                      <td>{price.napomena ?? "-"}</td>
                      {canUpdate ? (
                        <td>
                          <div className="inventory-table-actions">
                            <Link
                              className="table-button"
                              href={{
                                pathname: "/agencija/robno/cijene",
                                query: { q, artikal_id: selectedItem.id, uredi: price.id }
                              }}
                            >
                              Izmijeni
                            </Link>
                            <form action={toggleItemPrice}>
                              <input name="firma_id" type="hidden" value={context.firma!.id} />
                              <input name="artikal_id" type="hidden" value={selectedItem.id} />
                              <input name="cijena_id" type="hidden" value={price.id} />
                              <input name="aktivna" type="hidden" value={String(!price.aktivna)} />
                              <button className="table-button" type="submit">
                                {price.aktivna ? "Deaktiviraj" : "Aktiviraj"}
                              </button>
                            </form>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )) : (
                    <tr>
                      <td className="empty-state" colSpan={canUpdate ? 8 : 7}>
                        Artikal još nema definisane cijene.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="admin-panel">
          <p className="empty-state">Izaberite artikal da biste uredili njegove cijene.</p>
        </section>
      )}
    </div>
  );
}
