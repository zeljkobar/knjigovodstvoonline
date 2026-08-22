import Link from "next/link";
import {
  createPortalItemGroup,
  togglePortalItemGroup,
  updatePortalItemGroup
} from "../_actions/catalog";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  grupa_kreirana: "Grupa artikala je kreirana.",
  grupa_sacuvana: "Izmjene grupe su sačuvane.",
  grupa_aktivirana: "Grupa je aktivirana.",
  grupa_deaktivirana: "Grupa je deaktivirana.",
  grupa_obavezno: "Šifra i naziv grupe su obavezni.",
  grupa_postoji: "Grupa sa tom šifrom već postoji.",
  grupa_greska: "Grupa nije pronađena.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

export default async function PortalItemGroupsPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    uredi?: string;
    poruka?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    "/portal/grupe"
  );
  const q = params.q?.trim() ?? "";
  const status = ["aktivne", "neaktivne", "sve"].includes(params.status ?? "")
    ? params.status!
    : "aktivne";
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const groups = await prisma.grupaArtikla.findMany({
    where: {
      agencija_id: agencijaId,
      firma_id: firmaId,
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
      _count: { select: { artikli: { where: { is_deleted: false } } } }
    },
    orderBy: [{ aktivna: "desc" }, { sifra: "asc" }]
  });
  const edited = params.uredi
    ? groups.find((group) => group.id === params.uredi) ??
      (await prisma.grupaArtikla.findFirst({
        where: {
          id: params.uredi,
          agencija_id: agencijaId,
          firma_id: firmaId,
          is_deleted: false
        },
        include: {
          _count: { select: { artikli: { where: { is_deleted: false } } } }
        }
      }))
    : null;
  const canCreate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "create"
  });
  const canUpdate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "update"
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodajni šifarnik</p>
          <h2>Grupe artikala</h2>
          <p className="muted-text">Organizacija artikala i filtera prodaje.</p>
        </div>
        <Link className="secondary-button" href="/portal/artikli">Artikli</Link>
      </header>

      {params.poruka ? (
        <p className="admin-message">{messages[params.poruka] ?? "Akcija nije završena."}</p>
      ) : null}

      {(edited ? canUpdate : canCreate) ? (
        <section className="admin-form-section">
          <div className="panel-header">
            <h3>{edited ? "Izmijeni grupu" : "Nova grupa"}</h3>
            {edited ? <Link href={{ pathname: "/portal/grupe", query: { q, status } }}>Otkaži izmjenu</Link> : null}
          </div>
          <form action={edited ? updatePortalItemGroup : createPortalItemGroup} className="admin-form inventory-codebook-form">
            <input name="grupa_id" type="hidden" value={edited?.id ?? ""} />
            <label><span>Šifra</span><input defaultValue={edited?.sifra ?? ""} maxLength={30} name="sifra" required /></label>
            <label><span>Naziv</span><input defaultValue={edited?.naziv ?? ""} maxLength={160} name="naziv" required /></label>
            <label className="form-span-2"><span>Napomena</span><input defaultValue={edited?.napomena ?? ""} name="napomena" /></label>
            <button type="submit">{edited ? "Sačuvaj izmjene" : "Dodaj grupu"}</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <form className="portal-filter-form portal-filter-form--compact" method="get">
          <label><span>Pretraga</span><input defaultValue={q} name="q" placeholder="Šifra ili naziv" /></label>
          <label><span>Status</span><select defaultValue={status} name="status"><option value="aktivne">Aktivne</option><option value="neaktivne">Neaktivne</option><option value="sve">Sve</option></select></label>
          <button className="primary-button" type="submit">Primijeni filtere</button>
        </form>
        <div className="panel-header"><h3>Pregled grupa</h3><span>{groups.length} prikazano</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Šifra</th><th>Naziv</th><th>Artikala</th><th>Status</th><th>Napomena</th>{canUpdate ? <th>Akcije</th> : null}</tr></thead>
            <tbody>
              {groups.length ? groups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.sifra}</strong></td><td>{group.naziv}</td><td>{group._count.artikli}</td><td>{group.aktivna ? "Aktivna" : "Neaktivna"}</td><td>{group.napomena ?? "-"}</td>
                  {canUpdate ? <td><div className="inventory-table-actions">
                    <Link className="table-button" href={{ pathname: "/portal/grupe", query: { q, status, uredi: group.id } }}>Izmijeni</Link>
                    <form action={togglePortalItemGroup}><input name="grupa_id" type="hidden" value={group.id} /><input name="aktivna" type="hidden" value={String(!group.aktivna)} /><button className="table-button" type="submit">{group.aktivna ? "Deaktiviraj" : "Aktiviraj"}</button></form>
                  </div></td> : null}
                </tr>
              )) : <tr><td className="empty-state" colSpan={canUpdate ? 6 : 5}>Nema grupa za izabrane filtere.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
