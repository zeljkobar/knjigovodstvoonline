import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { createBusinessUnit, toggleBusinessUnit, updateBusinessUnit } from "./actions";

type PageProps = {
  searchParams?: Promise<{ poruka?: string; q?: string; status?: string; uredi?: string }>;
};

const messages: Record<string, string> = {
  kreirana: "Poslovna jedinica je kreirana.",
  sacuvana: "Izmjene poslovne jedinice su sačuvane.",
  aktivirana: "Poslovna jedinica je aktivirana.",
  deaktivirana: "Poslovna jedinica je deaktivirana.",
  obavezno: "Šifra i naziv su obavezni.",
  postoji: "Poslovna jedinica sa ovom šifrom već postoji.",
  nije_pronadjena: "Poslovna jedinica nije pronađena.",
  kontekst: "Izaberite važeću firmu u gornjoj traci.",
  prava: "Nemate pravo za ovu akciju."
};

const typeLabels: Record<string, string> = {
  HEADQUARTERS: "Sjedište",
  STORE: "Prodavnica",
  WAREHOUSE: "Skladište",
  SERVICE: "Uslužna jedinica",
  OTHER: "Ostalo"
};

export default async function BusinessUnitsPage({ searchParams }: PageProps) {
  const [user, workContext, params] = await Promise.all([
    requireRole("admin_agencije"),
    readWorkContext(),
    searchParams
  ]);

  if (!user.agencija_id || !workContext.firmaId) {
    return <section className="admin-panel"><p className="empty-state">Izaberite firmu u gornjoj traci.</p></section>;
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: workContext.firmaId,
      agencija_id: user.agencija_id,
      aktivan: true,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
    },
    select: { id: true, naziv: true }
  });
  if (!firma) return null;

  const q = params?.q?.trim() ?? "";
  const status = params?.status === "neaktivne" ? "neaktivne" : params?.status === "sve" ? "sve" : "aktivne";
  const [canView, canCreate, canUpdate, units] = await Promise.all([
    hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "view" }),
    hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "create" }),
    hasPermission(user, { firmaId: firma.id, modul: "nalozi", akcija: "update" }),
    prisma.poslovnaJedinica.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        is_deleted: false,
        ...(status === "aktivne" ? { aktivna: true } : {}),
        ...(status === "neaktivne" ? { aktivna: false } : {}),
        ...(q ? { OR: [{ sifra: { contains: q, mode: "insensitive" } }, { naziv: { contains: q, mode: "insensitive" } }] } : {})
      },
      include: { _count: { select: { magacini: true, kalkulacije: true, nalozi: true } } },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }]
    })
  ]);
  if (!canView) {
    return <section className="admin-panel"><p className="empty-state">Nemate pravo za pregled poslovnih jedinica.</p></section>;
  }
  const edited = params?.uredi ? units.find((unit) => unit.id === params.uredi) ?? null : null;

  return (
    <div className="admin-stack">
      <header className="admin-header"><div><p className="eyebrow">Podešavanja</p><h1>Poslovne jedinice</h1><p className="muted-text">Firma: {firma.naziv}</p></div></header>
      {params?.poruka ? <p className="admin-message">{messages[params.poruka] ?? params.poruka}</p> : null}

      {(edited ? canUpdate : canCreate) ? (
        <section className="admin-form-section">
          <div className="panel-header"><div><h3>{edited ? "Izmijeni poslovnu jedinicu" : "Nova poslovna jedinica"}</h3><p className="muted-text">Jedna poslovna jedinica može biti povezana sa više magacina.</p></div>{edited ? <Link href={{ pathname: "/agencija/podesavanja/poslovne-jedinice", query: { q, status } }}>Otkaži izmjenu</Link> : null}</div>
          <form action={edited ? updateBusinessUnit : createBusinessUnit} className="admin-form inventory-codebook-form">
            <input type="hidden" name="firma_id" value={firma.id} />
            <input type="hidden" name="poslovna_jedinica_id" value={edited?.id ?? ""} />
            <label><span>Šifra</span><input name="sifra" maxLength={30} required defaultValue={edited?.sifra ?? ""} /></label>
            <label><span>Naziv</span><input name="naziv" maxLength={160} required defaultValue={edited?.naziv ?? ""} /></label>
            <label><span>Tip</span><select name="tip" defaultValue={edited?.tip ?? "OTHER"}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Grad</span><input name="grad" defaultValue={edited?.grad ?? ""} /></label>
            <label className="form-span-2"><span>Adresa</span><input name="adresa" defaultValue={edited?.adresa ?? ""} /></label>
            <label className="form-span-2"><span>Napomena</span><input name="napomena" defaultValue={edited?.napomena ?? ""} /></label>
            <button type="submit">{edited ? "Sačuvaj izmjene" : "Dodaj poslovnu jedinicu"}</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <form className="admin-form inline-filter-form inventory-filter-form" method="get">
          <label><span>Pretraga</span><input name="q" defaultValue={q} placeholder="Šifra ili naziv" /></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="aktivne">Aktivne</option><option value="neaktivne">Neaktivne</option><option value="sve">Sve</option></select></label>
          <button type="submit">Prikaži</button>
        </form>
        <div className="table-wrap"><table><thead><tr><th>Šifra</th><th>Naziv</th><th>Tip</th><th>Lokacija</th><th>Povezano</th><th>Status</th>{canUpdate ? <th>Akcije</th> : null}</tr></thead><tbody>
          {units.length ? units.map((unit) => <tr key={unit.id}><td><strong>{unit.sifra}</strong></td><td>{unit.naziv}</td><td>{typeLabels[unit.tip] ?? unit.tip}</td><td>{[unit.adresa, unit.grad].filter(Boolean).join(", ") || "-"}</td><td>{unit._count.magacini} mag. / {unit._count.kalkulacije} kalk. / {unit._count.nalozi} nal.</td><td>{unit.aktivna ? "Aktivna" : "Neaktivna"}</td>{canUpdate ? <td><div className="inventory-table-actions"><Link className="table-button" href={{ pathname: "/agencija/podesavanja/poslovne-jedinice", query: { q, status, uredi: unit.id } }}>Izmijeni</Link><form action={toggleBusinessUnit}><input type="hidden" name="firma_id" value={firma.id} /><input type="hidden" name="poslovna_jedinica_id" value={unit.id} /><input type="hidden" name="aktivna" value={String(!unit.aktivna)} /><button className="table-button" type="submit">{unit.aktivna ? "Deaktiviraj" : "Aktiviraj"}</button></form></div></td> : null}</tr>) : <tr><td className="empty-state" colSpan={canUpdate ? 7 : 6}>Nema poslovnih jedinica za izabrane filtere.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  );
}
