import Link from "next/link";
import { createItemGroup, toggleItemGroup, updateItemGroup } from "../actions";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { inventoryModule } from "@/lib/inventory";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type ItemGroupsPageProps = {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    uredi?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  grupa_kreirana: "Grupa artikala je kreirana.",
  grupa_sacuvana: "Izmjene grupe su sačuvane.",
  grupa_aktivirana: "Grupa je aktivirana.",
  grupa_deaktivirana: "Grupa je deaktivirana.",
  grupa_obavezno: "Šifra i naziv grupe su obavezni.",
  grupa_postoji: "Grupa sa ovom šifrom već postoji.",
  grupa_greska: "Grupa nije pronađena.",
  kontekst: "Izaberite važeću firmu u gornjoj traci.",
  prava: "Nemate pravo za ovu akciju."
};

export default async function ItemGroupsPage({ searchParams }: ItemGroupsPageProps) {
  const context = await getInventoryContext("view");
  const params = await searchParams;

  if (!context.firma) {
    return <MissingInventoryContext title="Grupe artikala" />;
  }

  if (!context.allowed) {
    return <InventoryAccessDenied title="Grupe artikala" />;
  }

  const q = params?.q?.trim() ?? "";
  const status = params?.status === "neaktivne" ? "neaktivne" : params?.status === "sve" ? "sve" : "aktivne";
  const [canCreate, canUpdate, groups] = await Promise.all([
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
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false,
        ...(status === "aktivne" ? { aktivna: true } : {}),
        ...(status === "neaktivne" ? { aktivna: false } : {}),
        ...(q
          ? {
              OR: [
                { sifra: { contains: q, mode: "insensitive" } },
                { naziv: { contains: q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: {
        _count: {
          select: {
            artikli: {
              where: {
                is_deleted: false
              }
            }
          }
        }
      },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }]
    })
  ]);
  const editedGroup = params?.uredi
    ? groups.find((group) => group.id === params.uredi) ??
      (await prisma.grupaArtikla.findFirst({
        where: {
          id: params.uredi,
          agencija_id: context.user.agencija_id!,
          firma_id: context.firma.id,
          is_deleted: false
        }
      }))
    : null;
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>Grupe artikala</h2>
          <p className="muted-text">Firma: {context.firma.naziv}</p>
        </div>
        <Link className="secondary-button" href="/agencija/robno/sifarnici">
          Nazad na šifarnike
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {(editedGroup ? canUpdate : canCreate) ? (
        <section className="admin-form-section">
          <div className="panel-header">
            <h3>{editedGroup ? "Izmijeni grupu" : "Nova grupa"}</h3>
            {editedGroup ? (
              <Link href={{ pathname: "/agencija/robno/grupe", query: { q, status } }}>
                Otkaži izmjenu
              </Link>
            ) : null}
          </div>
          <form
            action={editedGroup ? updateItemGroup : createItemGroup}
            className="admin-form inventory-codebook-form"
          >
            <input name="firma_id" type="hidden" value={context.firma.id} />
            <input name="grupa_id" type="hidden" value={editedGroup?.id ?? ""} />
            <input name="q" type="hidden" value={q} />
            <input name="status" type="hidden" value={status} />
            <label>
              <span>Šifra</span>
              <input
                defaultValue={editedGroup?.sifra ?? ""}
                maxLength={30}
                name="sifra"
                placeholder="npr. HRANA"
                required
              />
            </label>
            <label>
              <span>Naziv</span>
              <input
                defaultValue={editedGroup?.naziv ?? ""}
                maxLength={160}
                name="naziv"
                placeholder="npr. Prehrambeni proizvodi"
                required
              />
            </label>
            <label className="form-span-2">
              <span>Napomena</span>
              <input defaultValue={editedGroup?.napomena ?? ""} name="napomena" />
            </label>
            <button type="submit">{editedGroup ? "Sačuvaj izmjene" : "Dodaj grupu"}</button>
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
              <option value="aktivne">Aktivne</option>
              <option value="neaktivne">Neaktivne</option>
              <option value="sve">Sve</option>
            </select>
          </label>
          <button type="submit">Prikaži</button>
        </form>

        <div className="panel-header inventory-list-header">
          <h3>Pregled grupa</h3>
          <span>{groups.length} prikazano</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Artikala</th>
                <th>Status</th>
                <th>Napomena</th>
                {canUpdate ? <th>Akcije</th> : null}
              </tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.sifra}</strong></td>
                  <td>{group.naziv}</td>
                  <td>{group._count.artikli}</td>
                  <td>{group.aktivna ? "Aktivna" : "Neaktivna"}</td>
                  <td>{group.napomena ?? "-"}</td>
                  {canUpdate ? (
                    <td>
                      <div className="inventory-table-actions">
                        <Link
                          className="table-button"
                          href={{
                            pathname: "/agencija/robno/grupe",
                            query: { q, status, uredi: group.id }
                          }}
                        >
                          Izmijeni
                        </Link>
                        <form action={toggleItemGroup}>
                          <input name="firma_id" type="hidden" value={context.firma!.id} />
                          <input name="grupa_id" type="hidden" value={group.id} />
                          <input name="q" type="hidden" value={q} />
                          <input name="status" type="hidden" value={status} />
                          <input name="aktivna" type="hidden" value={String(!group.aktivna)} />
                          <button className="table-button" type="submit">
                            {group.aktivna ? "Deaktiviraj" : "Aktiviraj"}
                          </button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan={canUpdate ? 6 : 5}>
                    Nema grupa za izabrane filtere.
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
