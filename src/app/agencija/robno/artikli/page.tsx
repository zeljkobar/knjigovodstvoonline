import Link from "next/link";
import { createItem, toggleItem, updateItem } from "../actions";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { inventoryModule } from "@/lib/inventory";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type ItemsPageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    tip?: string;
    grupa?: string;
    uredi?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  artikal_kreiran: "Artikal je kreiran.",
  artikal_sacuvan: "Izmjene artikla su sačuvane.",
  artikal_aktiviran: "Artikal je aktiviran.",
  artikal_deaktiviran: "Artikal je deaktiviran.",
  artikal_obavezno: "Naziv, jedinica mjere i ispravna cijena su obavezni.",
  artikal_cijena: "Početna veleprodajna ili maloprodajna cijena nije ispravna.",
  artikal_sifra_postoji: "Artikal sa ovom šifrom već postoji.",
  artikal_barkod_postoji: "Artikal sa ovim barkodom već postoji.",
  artikal_reference: "Izabrana grupa, jedinica mjere ili PDV stopa nije važeća.",
  artikal_greska: "Artikal nije pronađen.",
  kontekst: "Izaberite važeću firmu u gornjoj traci.",
  prava: "Nemate pravo za ovu akciju."
};

export default async function ItemsPage({ searchParams }: ItemsPageProps) {
  const context = await getInventoryContext("view");
  const params = await searchParams;

  if (!context.firma) {
    return <MissingInventoryContext title="Artikli" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Artikli" />;
  }

  const q = params?.q?.trim() ?? "";
  const status = params?.status === "neaktivni" ? "neaktivni" : params?.status === "svi" ? "svi" : "aktivni";
  const tip = params?.tip === "roba" ? "roba" : params?.tip === "usluge" ? "usluge" : "sve";
  const groupId = params?.grupa ?? "";
  const scope = {
    agencija_id: context.user.agencija_id!,
    firma_id: context.firma.id,
    is_deleted: false
  };
  const [canCreate, canUpdate, groups, units, vatRates, items] = await Promise.all([
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
    prisma.grupaArtikla.findMany({
      where: { ...scope, aktivna: true },
      orderBy: { naziv: "asc" },
      select: { id: true, sifra: true, naziv: true }
    }),
    prisma.jedinicaMjere.findMany({
      where: { aktivna: true },
      orderBy: [{ redosljed: "asc" }, { naziv: "asc" }]
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        aktivna: true
      },
      orderBy: [{ redosljed: "asc" }, { procenat: "asc" }]
    }),
    prisma.artikal.findMany({
      where: {
        ...scope,
        ...(status === "aktivni" ? { aktivan: true } : {}),
        ...(status === "neaktivni" ? { aktivan: false } : {}),
        ...(tip === "roba" ? { usluga: false } : {}),
        ...(tip === "usluge" ? { usluga: true } : {}),
        ...(groupId ? { grupa_artikla_id: groupId } : {}),
        ...(q
          ? {
              OR: [
                { sifra: { contains: q, mode: "insensitive" as const } },
                { naziv: { contains: q, mode: "insensitive" as const } },
                { barkod: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      },
      include: {
        grupa_artikla: { select: { naziv: true } },
        jedinica_mjere: { select: { oznaka: true } },
        pdv_stopa: { select: { procenat: true } },
        _count: { select: { cijene: true } }
      },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      take: 200
    })
  ]);
  const editedItem = params?.uredi
    ? items.find((item) => item.id === params.uredi) ??
      (await prisma.artikal.findFirst({
        where: { ...scope, id: params.uredi },
        include: {
          grupa_artikla: { select: { naziv: true } },
          jedinica_mjere: { select: { oznaka: true } },
          pdv_stopa: { select: { procenat: true } },
          _count: { select: { cijene: true } }
        }
      }))
    : null;
  const message = params?.poruka ? messages[params.poruka] : null;
  const preservedQuery = { q, status, tip, grupa: groupId };

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>Artikli</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
        <Link className="secondary-button" href="/agencija/robno/sifarnici">
          Nazad na šifarnike
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {(editedItem ? canUpdate : canCreate) ? (
        <section className="admin-form-section">
          <div className="panel-header">
            <div>
              <h3>{editedItem ? "Izmijeni artikal" : "Novi artikal"}</h3>
              {!editedItem ? (
                <p className="muted-text">Ako šifra ostane prazna, biće dodijeljena automatski.</p>
              ) : null}
            </div>
            {editedItem ? (
              <Link href={{ pathname: "/agencija/robno/artikli", query: preservedQuery }}>
                Otkaži izmjenu
              </Link>
            ) : null}
          </div>
          <form
            action={editedItem ? updateItem : createItem}
            className="admin-form inventory-item-form"
          >
            <input name="firma_id" type="hidden" value={context.firma.id} />
            <input name="artikal_id" type="hidden" value={editedItem?.id ?? ""} />
            {Object.entries(preservedQuery).map(([name, value]) => (
              <input key={name} name={name} type="hidden" value={value} />
            ))}
            <label>
              <span>Šifra</span>
              <input
                defaultValue={editedItem?.sifra ?? ""}
                maxLength={40}
                name="sifra"
                placeholder="Automatska ili ručna"
                required={Boolean(editedItem)}
              />
            </label>
            <label className="form-span-2">
              <span>Naziv</span>
              <input defaultValue={editedItem?.naziv ?? ""} maxLength={200} name="naziv" required />
            </label>
            <label>
              <span>Barkod</span>
              <input defaultValue={editedItem?.barkod ?? ""} maxLength={80} name="barkod" />
            </label>
            <label>
              <span>Grupa</span>
              <select defaultValue={editedItem?.grupa_artikla_id ?? ""} name="grupa_artikla_id">
                <option value="">Bez grupe</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.sifra} — {group.naziv}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Jedinica mjere</span>
              <select defaultValue={editedItem?.jedinica_mjere_id ?? units[0]?.id} name="jedinica_mjere_id" required>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.sifra} — {unit.naziv}</option>
                ))}
              </select>
            </label>
            <label>
              <span>PDV stopa</span>
              <select defaultValue={editedItem?.pdv_stopa_id ?? ""} name="pdv_stopa_id">
                <option value="">Bez PDV stope</option>
                {vatRates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.naziv} ({rate.procenat.toString()}%)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Posljednja nabavna cijena</span>
              <input
                defaultValue={editedItem?.posljednja_nabavna_cijena?.toString() ?? ""}
                inputMode="decimal"
                min="0"
                name="posljednja_nabavna_cijena"
                placeholder="0,00"
                step="0.01"
                type="number"
              />
            </label>
            {!editedItem ? (
              <>
                <label>
                  <span>Veleprodajna cijena bez PDV-a</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    name="veleprodajna_cijena"
                    placeholder="Opciono"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  <span>Maloprodajna cijena sa PDV-om</span>
                  <input
                    inputMode="decimal"
                    min="0"
                    name="maloprodajna_cijena"
                    placeholder="Opciono"
                    step="0.01"
                    type="number"
                  />
                </label>
              </>
            ) : null}
            <label className="checkbox-card">
              <input defaultChecked={editedItem?.usluga ?? false} name="usluga" type="checkbox" />
              <span>Usluga (ne prati zalihe)</span>
            </label>
            <label className="form-span-2">
              <span>Napomena</span>
              <input defaultValue={editedItem?.napomena ?? ""} name="napomena" />
            </label>
            <button type="submit">{editedItem ? "Sačuvaj izmjene" : "Dodaj artikal"}</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <form className="admin-form inline-filter-form inventory-filter-form" method="get">
          <label>
            <span>Pretraga</span>
            <input defaultValue={q} name="q" placeholder="Šifra, naziv ili barkod" />
          </label>
          <label>
            <span>Status</span>
            <select defaultValue={status} name="status">
              <option value="aktivni">Aktivni</option>
              <option value="neaktivni">Neaktivni</option>
              <option value="svi">Svi</option>
            </select>
          </label>
          <label>
            <span>Tip</span>
            <select defaultValue={tip} name="tip">
              <option value="sve">Roba i usluge</option>
              <option value="roba">Roba</option>
              <option value="usluge">Usluge</option>
            </select>
          </label>
          <label>
            <span>Grupa</span>
            <select defaultValue={groupId} name="grupa">
              <option value="">Sve grupe</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.naziv}</option>
              ))}
            </select>
          </label>
          <button type="submit">Prikaži</button>
        </form>

        <div className="panel-header inventory-list-header">
          <h3>Pregled artikala</h3>
          <span>{items.length === 200 ? "Prvih 200 rezultata" : `${items.length} prikazano`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra / barkod</th>
                <th>Naziv</th>
                <th>Tip</th>
                <th>Grupa</th>
                <th>JM</th>
                <th>PDV</th>
                <th>Cijene</th>
                <th>Status</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.sifra}</strong>
                    <small>{item.barkod ?? "Bez barkoda"}</small>
                  </td>
                  <td>
                    {item.naziv}
                    {item.posljednja_nabavna_cijena ? (
                      <small>Nabavna: {item.posljednja_nabavna_cijena.toString()} EUR</small>
                    ) : null}
                  </td>
                  <td>{item.usluga ? "Usluga" : "Roba"}</td>
                  <td>{item.grupa_artikla?.naziv ?? "-"}</td>
                  <td>{item.jedinica_mjere.oznaka}</td>
                  <td>{item.pdv_stopa ? `${item.pdv_stopa.procenat.toString()}%` : "-"}</td>
                  <td>{item._count.cijene}</td>
                  <td>{item.aktivan ? "Aktivan" : "Neaktivan"}</td>
                  <td>
                    <div className="inventory-table-actions">
                      <Link
                        className="table-button"
                        href={{ pathname: "/agencija/robno/cijene", query: { artikal_id: item.id } }}
                      >
                        Cijene
                      </Link>
                      {canUpdate ? (
                        <>
                          <Link
                            className="table-button"
                            href={{
                              pathname: "/agencija/robno/artikli",
                              query: { ...preservedQuery, uredi: item.id }
                            }}
                          >
                            Izmijeni
                          </Link>
                          <form action={toggleItem}>
                            <input name="firma_id" type="hidden" value={context.firma!.id} />
                            <input name="artikal_id" type="hidden" value={item.id} />
                            {Object.entries(preservedQuery).map(([name, value]) => (
                              <input key={name} name={name} type="hidden" value={value} />
                            ))}
                            <input name="aktivan" type="hidden" value={String(!item.aktivan)} />
                            <button className="table-button" type="submit">
                              {item.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                            </button>
                          </form>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan={9}>Nema artikala za izabrane filtere.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
