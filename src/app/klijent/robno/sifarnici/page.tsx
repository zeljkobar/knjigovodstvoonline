import Link from "next/link";
import { requireClientContext } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { itemPriceTypeLabel } from "@/lib/inventory";
import { decimalToInventoryScaled, formatInventoryMoney } from "@/app/agencija/_components/inventory-report-utils";

export default async function ClientCatalog({ searchParams }: { searchParams: Promise<{ q?: string; strana?: string }> }) {
  const context = await requireClientContext(["robno"]);
  const query = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.strana) || 1)));
  const scope = { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, is_deleted: false };
  const where = { ...scope, ...(query.q?.trim() ? { OR: [
    { sifra: { contains: query.q.trim(), mode: "insensitive" as const } },
    { naziv: { contains: query.q.trim(), mode: "insensitive" as const } }
  ] } : {}) };
  const [items, count, warehouses, groups] = await Promise.all([
    prisma.artikal.findMany({ where, orderBy: { sifra: "asc" }, skip: (page - 1) * 50, take: 50,
      include: { jedinica_mjere: true, grupa_artikla: true, cijene: {
        where: { ...scope, aktivna: true }, orderBy: [{ tip: "asc" }, { vazi_od: "desc" }],
        include: { magacin: { select: { naziv: true } }, komitent: { select: { naziv: true } } }
      } } }),
    prisma.artikal.count({ where }),
    prisma.magacin.findMany({ where: scope, orderBy: { sifra: "asc" }, select: { id: true, sifra: true, naziv: true, aktivan: true } }),
    prisma.grupaArtikla.findMany({ where: scope, orderBy: { sifra: "asc" }, select: { id: true, sifra: true, naziv: true, aktivna: true } })
  ]);
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno</p><h1>Artikli i cjenovnik</h1><p>Šifarnici firme i aktivni zapisi cjenovnika, sa periodom važenja. Ne zavise od izabrane poslovne godine.</p></div></header>
    <section className="admin-panel"><form className="admin-form"><label>Artikal<input name="q" type="search" placeholder="Šifra ili naziv" defaultValue={query.q} /></label><button className="secondary-button" type="submit">Prikaži</button></form></section>
    <section className="admin-panel"><div className="table-wrap"><table className="admin-table"><thead><tr><th>Šifra</th><th>Artikal / grupa</th><th>Jedinica</th><th>Cijene sa PDV</th><th></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.sifra}</td><td>{item.naziv}<small>{item.grupa_artikla?.naziv}{!item.aktivan ? " · Neaktivan" : ""}</small></td><td>{item.jedinica_mjere.oznaka}</td><td>{item.cijene.map((price) => <p key={price.id}>{itemPriceTypeLabel(price.tip)}: <strong>{formatInventoryMoney(decimalToInventoryScaled(price.cijena_sa_pdv, 2))} {price.valuta}</strong><small>{price.magacin?.naziv ?? price.komitent?.naziv ?? "Opšta cijena"} · {price.vazi_od?.toLocaleDateString("sr-Latn-ME") ?? "Bez početnog datuma"} – {price.vazi_do?.toLocaleDateString("sr-Latn-ME") ?? "bez krajnjeg datuma"}</small></p>)}</td><td>{!item.usluga && item.prati_zalihe ? <Link href={`/klijent/robno/kartica-artikla?artikal=${item.id}`}>Kartica</Link> : null}</td></tr>)}{!items.length ? <tr><td colSpan={5}>Nema artikala za izabranu pretragu.</td></tr> : null}</tbody></table></div><div className="table-actions"><span>{count} artikala · Strana {page}</span>{page > 1 ? <Link href={`?strana=${page - 1}&q=${encodeURIComponent(query.q ?? "")}`}>Prethodna</Link> : null}{page * 50 < count ? <Link href={`?strana=${page + 1}&q=${encodeURIComponent(query.q ?? "")}`}>Sljedeća</Link> : null}</div></section>
    <section className="admin-panel"><h2>Magacini</h2>{warehouses.map((item) => <p key={item.id}>{item.sifra} · {item.naziv}{!item.aktivan ? " · Neaktivan" : ""}</p>)}{!warehouses.length ? <p>Nema magacina.</p> : null}</section>
    <section className="admin-panel"><h2>Grupe artikala</h2>{groups.map((item) => <p key={item.id}>{item.sifra} · {item.naziv}{!item.aktivna ? " · Neaktivna" : ""}</p>)}{!groups.length ? <p>Nema grupa artikala.</p> : null}</section>
  </div>;
}
