import Link from "next/link";
import { togglePortalCustomer } from "../_actions/catalog";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  kupac_aktiviran: "Kupac je aktiviran.",
  kupac_deaktiviran: "Kupac je deaktiviran.",
  kupac_greska: "Kupac nije pronađen.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

export default async function PortalCustomersPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    poruka?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    "/portal/kupci"
  );
  const q = params.q?.trim() ?? "";
  const status = ["aktivni", "neaktivni", "svi"].includes(params.status ?? "")
    ? params.status!
    : "aktivni";
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const pageSize = 50;
  const firmaId = context.firma.id;
  const agencijaId = context.user.agencija_id!;
  const where = {
    firma_id: firmaId,
    tip_komitenta: { in: ["kupac" as const, "kupac_dobavljac" as const] },
    ...(status === "aktivni" ? { aktivan: true } : {}),
    ...(status === "neaktivni" ? { aktivan: false } : {}),
    komitent: {
      OR: [
        { scope: "GLOBAL" as const },
        {
          scope: "COMPANY" as const,
          firma_id: firmaId,
          agencija_id: agencijaId
        }
      ],
      ...(q
        ? {
            OR: [
              { naziv: { contains: q, mode: "insensitive" as const } },
              { pib: { contains: q, mode: "insensitive" as const } },
              { foreign_tax_number: { contains: q, mode: "insensitive" as const } }
            ]
          }
        : {})
    }
  };
  const [count, links] = await Promise.all([
    prisma.firmaKomitent.count({ where }),
    prisma.firmaKomitent.findMany({
      where,
      include: { komitent: true },
      orderBy: { komitent: { naziv: "asc" } },
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

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodajni šifarnik</p>
          <h2>Kupci</h2>
          <p className="muted-text">Prikazuju se samo kupci povezani sa firmom; globalni registar se ne učitava masovno.</p>
        </div>
        {canCreate ? <Link className="primary-button" href="/portal/kupci/novi">Novi kupac</Link> : null}
      </header>

      {params.poruka ? <p className="admin-message">{messages[params.poruka] ?? "Akcija nije završena."}</p> : null}

      <section className="admin-panel">
        <form className="portal-filter-form portal-filter-form--compact" method="get">
          <label><span>Pretraga</span><input defaultValue={q} name="q" placeholder="Naziv, PIB ili strani poreski broj" /></label>
          <label><span>Status</span><select defaultValue={status} name="status"><option value="aktivni">Aktivni</option><option value="neaktivni">Neaktivni</option><option value="svi">Svi</option></select></label>
          <button className="primary-button" type="submit">Primijeni filtere</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header"><h3>Povezani kupci</h3><span>{count} ukupno</span></div>
        <div className="table-wrap"><table><thead><tr><th>Naziv</th><th>PIB / poreski broj</th><th>Adresa</th><th>Kontakt</th><th>Rok</th><th>Status</th><th>Akcije</th></tr></thead><tbody>
          {links.length ? links.map((link) => {
            const customer = link.komitent;
            return <tr key={link.id}>
              <td><strong>{customer.naziv}</strong><small>{customer.scope === "GLOBAL" ? "Globalni registar · samo čitanje" : "Kupac firme"}</small></td>
              <td>{customer.is_foreign ? customer.foreign_tax_number ?? "-" : customer.pib ?? "-"}<small>{customer.is_foreign ? customer.country_code ?? customer.country_name ?? "Inostranstvo" : customer.pdv_broj ?? ""}</small></td>
              <td>{[customer.adresa, customer.grad].filter(Boolean).join(", ") || "-"}<small>{customer.drzava ?? customer.country_name ?? ""}</small></td>
              <td>{customer.email ?? customer.telefon ?? "-"}</td>
              <td>{link.rok_placanja_dana === null ? "-" : `${link.rok_placanja_dana} dana`}</td>
              <td>{link.aktivan && customer.aktivan ? "Aktivan" : "Neaktivan"}</td>
              <td><div className="inventory-table-actions"><Link className="table-button" href={`/portal/kupci/${customer.id}`}>Detalji</Link>{canUpdate ? <form action={togglePortalCustomer}><input name="partner_id" type="hidden" value={customer.id} /><input name="aktivan" type="hidden" value={String(!link.aktivan)} /><button className="table-button" type="submit">{link.aktivan ? "Deaktiviraj" : "Aktiviraj"}</button></form> : null}</div></td>
            </tr>;
          }) : <tr><td className="empty-state" colSpan={7}>Nema kupaca za izabrane filtere.</td></tr>}
        </tbody></table></div>
        {pages > 1 ? <nav className="pagination" aria-label="Stranice kupaca">{page > 1 ? <Link href={{ pathname: "/portal/kupci", query: { q, status, page: page - 1 } }}>Prethodna</Link> : <span />}<span>Stranica {page} od {pages}</span>{page < pages ? <Link href={{ pathname: "/portal/kupci", query: { q, status, page: page + 1 } }}>Sljedeća</Link> : <span />}</nav> : null}
      </section>
    </div>
  );
}
