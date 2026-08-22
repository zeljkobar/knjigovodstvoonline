import Link from "next/link";
import { togglePortalItem } from "../_actions/catalog";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  hasDirectPortalPermission,
  podgoricaBusinessDate
} from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  artikal_aktiviran: "Artikal je aktiviran.",
  artikal_deaktiviran: "Artikal je deaktiviran.",
  artikal_greska: "Artikal nije pronađen.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

export default async function PortalItemsPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    tip?: string;
    grupa?: string;
    page?: string;
    poruka?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    "/portal/artikli"
  );
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const q = params.q?.trim() ?? "";
  const status = ["aktivni", "neaktivni", "svi"].includes(params.status ?? "")
    ? params.status!
    : "aktivni";
  const tip = ["roba", "usluge", "sve"].includes(params.tip ?? "")
    ? params.tip!
    : "sve";
  const groupId = params.grupa?.trim() ?? "";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const pageSize = 50;
  const businessDate = podgoricaBusinessDate();
  const where = {
    agencija_id: agencijaId,
    firma_id: firmaId,
    is_deleted: false,
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
  };
  const [groups, count, items] = await Promise.all([
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        aktivna: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    }),
    prisma.artikal.count({ where }),
    prisma.artikal.findMany({
      where,
      include: {
        grupa_artikla: { select: { naziv: true } },
        jedinica_mjere: { select: { oznaka: true } },
        pdv_stopa: { select: { procenat: true } },
        cijene: {
          where: {
            aktivna: true,
            is_deleted: false,
            OR: [{ vazi_od: null }, { vazi_od: { lte: businessDate } }],
            AND: [{ OR: [{ vazi_do: null }, { vazi_do: { gte: businessDate } }] }]
          },
          orderBy: [
            { tip: "desc" },
            { vazi_od: "desc" },
            { created_at: "desc" }
          ]
        }
      },
      orderBy: [{ aktivan: "desc" }, { sifra: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const canCreate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "create"
  });
  const canUpdate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "update"
  });
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const query = { q, status, tip, grupa: groupId };

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodajni šifarnik</p>
          <h2>Artikli i usluge</h2>
          <p className="muted-text">
            Samo prodajni podaci firme {context.firma.naziv}; računovodstvena konta nijesu dostupna.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/grupe">Grupe</Link>
          <Link className="secondary-button" href="/portal/cijene">Cijene</Link>
          {canCreate ? (
            <Link className="primary-button" href="/portal/artikli/novi">
              Novi artikal
            </Link>
          ) : null}
        </div>
      </header>

      {params.poruka ? (
        <p className="admin-message">
          {messages[params.poruka] ?? "Akcija nije završena."}
        </p>
      ) : null}

      <section className="admin-panel">
        <form className="portal-item-filters" method="get">
          <label className="portal-item-search">
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
            <span>Tip artikla</span>
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
                <option key={group.id} value={group.id}>
                  {group.sifra} — {group.naziv}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit">Primijeni filtere</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled šifarnika</h3>
          <span>{count} ukupno</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Tip / JM</th>
                <th>Grupa</th>
                <th>PDV</th>
                <th>Aktuelna cijena</th>
                <th>Status</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item) => {
                const price = item.cijene.find((entry) => entry.tip === "MALOPRODAJNA") ?? item.cijene[0];

                return (
                  <tr key={item.id}>
                    <td><strong>{item.sifra}</strong><small>{item.barkod ?? "Bez barkoda"}</small></td>
                    <td>{item.naziv}</td>
                    <td>{item.usluga ? "Usluga" : item.prati_zalihe ? "Roba · lager" : "Roba"}<small>{item.jedinica_mjere.oznaka}</small></td>
                    <td>{item.grupa_artikla?.naziv ?? "-"}</td>
                    <td>{item.pdv_stopa ? `${item.pdv_stopa.procenat.toString()}%` : "0%"}</td>
                    <td>{price ? `${price.cijena_sa_pdv.toString()} ${price.valuta}` : "-"}</td>
                    <td>{item.aktivan ? "Aktivan" : "Neaktivan"}</td>
                    <td>
                      <div className="inventory-table-actions">
                        <Link className="table-button" href={`/portal/artikli/${item.id}`}>
                          {canUpdate ? "Uredi" : "Detalji"}
                        </Link>
                        {canUpdate ? (
                          <form action={togglePortalItem}>
                            <input name="artikal_id" type="hidden" value={item.id} />
                            <input name="aktivan" type="hidden" value={String(!item.aktivan)} />
                            <button className="table-button" type="submit">
                              {item.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="empty-state" colSpan={8}>Nema artikala za izabrane filtere.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <nav className="pagination" aria-label="Stranice artikala">
            {page > 1 ? <Link href={{ pathname: "/portal/artikli", query: { ...query, page: page - 1 } }}>Prethodna</Link> : <span />}
            <span>Stranica {page} od {pages}</span>
            {page < pages ? <Link href={{ pathname: "/portal/artikli", query: { ...query, page: page + 1 } }}>Sljedeća</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
