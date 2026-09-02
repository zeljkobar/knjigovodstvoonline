import Link from "next/link";
import {
  createWarehouse,
  toggleWarehouse,
  updateCompanyNegativeStockPolicy,
  updateWarehouse
} from "../actions";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { inventoryModule } from "@/lib/inventory";
import { warehouseSalesTypeLabel } from "@/lib/pos-pricing";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type WarehousesPageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    uredi?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  magacin_kreiran: "Magacin je kreiran.",
  magacin_sacuvan: "Izmjene magacina su sačuvane.",
  magacin_aktiviran: "Magacin je aktiviran.",
  magacin_deaktiviran: "Magacin je deaktiviran.",
  magacin_obavezno: "Šifra i naziv magacina su obavezni.",
  magacin_postoji: "Magacin sa ovom šifrom već postoji.",
  magacin_greska: "Magacin nije pronađen.",
  poslovna_jedinica_greska: "Poslovna jedinica nije dostupna u izabranoj firmi.",
  negativan_lager_sacuvan: "Podrazumijevano pravilo negativnog lagera je sačuvano.",
  kontekst: "Izaberite važeću firmu u gornjoj traci.",
  prava: "Nemate pravo za ovu akciju."
};

function negativeStockLabel(value: boolean | null, companyDefault: boolean) {
  if (value === null) {
    return `Nasljeđuje firmu (${companyDefault ? "dozvoljen" : "blokiran"})`;
  }

  return value ? "Dozvoljen" : "Blokiran";
}

export default async function WarehousesPage({ searchParams }: WarehousesPageProps) {
  const context = await getInventoryContext("view");
  const params = await searchParams;

  if (!context.firma) {
    return <MissingInventoryContext title="Magacini" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Magacini" />;
  }

  const q = params?.q?.trim() ?? "";
  const status = params?.status === "neaktivni" ? "neaktivni" : params?.status === "svi" ? "svi" : "aktivni";
  const [canCreate, canUpdate, canManage, warehouses, businessUnits] = await Promise.all([
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
    hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: inventoryModule,
      akcija: "manage"
    }),
    prisma.magacin.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false,
        ...(status === "aktivni" ? { aktivan: true } : {}),
        ...(status === "neaktivni" ? { aktivan: false } : {}),
        ...(q
          ? {
              OR: [
                { sifra: { contains: q, mode: "insensitive" } },
                { naziv: { contains: q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: { poslovna_jedinica: { select: { id: true, sifra: true, naziv: true } } },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }]
    }),
    prisma.poslovnaJedinica.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivna: true,
        is_deleted: false
      },
      select: { id: true, sifra: true, naziv: true },
      orderBy: [{ sifra: "asc" }]
    })
  ]);
  const editedWarehouse = params?.uredi
    ? warehouses.find((warehouse) => warehouse.id === params.uredi) ??
      (await prisma.magacin.findFirst({
        where: {
          id: params.uredi,
          agencija_id: context.user.agencija_id!,
          firma_id: context.firma.id,
          is_deleted: false
        },
        include: { poslovna_jedinica: { select: { id: true, sifra: true, naziv: true } } }
      }))
    : null;
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>Magacini</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
        <Link className="secondary-button" href="/agencija/robno/sifarnici">
          Nazad na šifarnike
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Negativan lager</h3>
            <p className="muted-text">
              Podrazumijevano pravilo firme važi za svaki magacin koji nema svoje pravilo.
            </p>
          </div>
          <strong>{context.firma.dozvoli_negativan_lager ? "Dozvoljen" : "Blokiran"}</strong>
        </div>
        {canManage ? (
          <form action={updateCompanyNegativeStockPolicy} className="inventory-policy-form">
            <input name="firma_id" type="hidden" value={context.firma.id} />
            <label className="checkbox-card">
              <input
                defaultChecked={context.firma.dozvoli_negativan_lager}
                name="dozvoli_negativan_lager"
                type="checkbox"
              />
              <span>Dozvoli negativan lager kao pravilo firme</span>
            </label>
            <button className="primary-button" type="submit">Sačuvaj pravilo</button>
          </form>
        ) : null}
      </section>

      {(editedWarehouse ? canUpdate : canCreate) ? (
        <section className="admin-form-section">
          <div className="panel-header">
            <h3>{editedWarehouse ? "Izmijeni magacin" : "Novi magacin"}</h3>
            {editedWarehouse ? (
              <Link href={{ pathname: "/agencija/robno/magacini", query: { q, status } }}>
                Otkaži izmjenu
              </Link>
            ) : null}
          </div>
          <form
            action={editedWarehouse ? updateWarehouse : createWarehouse}
            className="admin-form inventory-codebook-form"
          >
            <input name="firma_id" type="hidden" value={context.firma.id} />
            <input name="magacin_id" type="hidden" value={editedWarehouse?.id ?? ""} />
            <input name="q" type="hidden" value={q} />
            <input name="status" type="hidden" value={status} />
            <label>
              <span>Šifra</span>
              <input defaultValue={editedWarehouse?.sifra ?? ""} maxLength={30} name="sifra" required />
            </label>
            <label>
              <span>Naziv</span>
              <input defaultValue={editedWarehouse?.naziv ?? ""} maxLength={160} name="naziv" required />
            </label>
            <label>
              <span>Negativan lager</span>
              <select
                defaultValue={
                  editedWarehouse?.dozvoli_negativan_lager === true
                    ? "ALLOW"
                    : editedWarehouse?.dozvoli_negativan_lager === false
                      ? "BLOCK"
                      : "INHERIT"
                }
                name="negativan_lager"
              >
                <option value="INHERIT">Naslijedi pravilo firme</option>
                <option value="BLOCK">Blokiraj</option>
                <option value="ALLOW">Dozvoli</option>
              </select>
            </label>
            <label>
              <span>Tip prodaje</span>
              <select defaultValue={editedWarehouse?.tip_prodaje ?? "RETAIL"} name="tip_prodaje">
                <option value="RETAIL">Maloprodajni — cijene sa PDV-om</option>
                <option value="WHOLESALE">Veleprodajni — cijene bez PDV-a</option>
              </select>
            </label>
            <label>
              <span>Poslovna jedinica</span>
              <select
                defaultValue={editedWarehouse?.poslovna_jedinica_id ?? ""}
                name="poslovna_jedinica_id"
              >
                <option value="">Bez poslovne jedinice</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.sifra} · {unit.naziv}</option>
                ))}
              </select>
              <small>Magacin nasljeđuje organizacionu pripadnost ove jedinice.</small>
            </label>
            <label className="form-span-2">
              <span>Napomena</span>
              <input defaultValue={editedWarehouse?.napomena ?? ""} name="napomena" />
            </label>
            <button type="submit">{editedWarehouse ? "Sačuvaj izmjene" : "Dodaj magacin"}</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <form className="admin-form inline-filter-form inventory-filter-form" method="get">
          <label>
            <span>Pretraga</span>
            <input defaultValue={q} name="q" placeholder="Šifra ili naziv" />
          </label>
          <label>
            <span>Status</span>
            <select defaultValue={status} name="status">
              <option value="aktivni">Aktivni</option>
              <option value="neaktivni">Neaktivni</option>
              <option value="svi">Svi</option>
            </select>
          </label>
          <button type="submit">Prikaži</button>
        </form>

        <div className="panel-header inventory-list-header">
          <h3>Pregled magacina</h3>
          <span>{warehouses.length} prikazano</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Tip prodaje</th>
                <th>Poslovna jedinica</th>
                <th>Negativan lager</th>
                <th>Status</th>
                <th>Napomena</th>
                {canUpdate ? <th>Akcije</th> : null}
              </tr>
            </thead>
            <tbody>
              {warehouses.length ? warehouses.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td><strong>{warehouse.sifra}</strong></td>
                  <td>{warehouse.naziv}</td>
                  <td>{warehouseSalesTypeLabel(warehouse.tip_prodaje)}</td>
                  <td>{warehouse.poslovna_jedinica ? `${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : "-"}</td>
                  <td>
                    {negativeStockLabel(
                      warehouse.dozvoli_negativan_lager,
                      context.firma!.dozvoli_negativan_lager
                    )}
                  </td>
                  <td>{warehouse.aktivan ? "Aktivan" : "Neaktivan"}</td>
                  <td>{warehouse.napomena ?? "-"}</td>
                  {canUpdate ? (
                    <td>
                      <div className="inventory-table-actions">
                        <Link
                          className="table-button"
                          href={{
                            pathname: "/agencija/robno/magacini",
                            query: { q, status, uredi: warehouse.id }
                          }}
                        >
                          Izmijeni
                        </Link>
                        <form action={toggleWarehouse}>
                          <input name="firma_id" type="hidden" value={context.firma!.id} />
                          <input name="magacin_id" type="hidden" value={warehouse.id} />
                          <input name="q" type="hidden" value={q} />
                          <input name="status" type="hidden" value={status} />
                          <input name="aktivan" type="hidden" value={String(!warehouse.aktivan)} />
                          <button className="table-button" type="submit">
                            {warehouse.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                          </button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan={canUpdate ? 8 : 7}>
                    Nema magacina za izabrane filtere.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
