import { Prisma } from "@prisma/client";
import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { fixedAssetCentsMoney, fixedAssetDecimalToCents, fixedAssetPage, fixedAssetStatusLabels, fixedAssetTypeLabels } from "@/lib/fixed-assets";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type RegisterPageProps = {
  searchParams?: Promise<{ kategorija?: string; pretraga?: string; status?: string; strana?: string }>;
};

export default async function OsnovnaSredstvaPage({ searchParams }: RegisterPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const filters = await searchParams;

  if (!user.agencija_id || !workContext.firmaId) {
    return <div className="admin-stack"><section className="admin-panel"><p>Izaberite firmu za rad sa registrom.</p></section></div>;
  }

  const company = await prisma.firma.findFirst({
    where: {
      id: workContext.firmaId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
    },
    select: { id: true, naziv: true }
  });
  if (!company) return null;

  await requirePermissionForUser(user, { firmaId: company.id, modul: "osnovna_sredstva", akcija: "view" });

  const search = filters?.pretraga?.trim() ?? "";
  const status = filters?.status?.trim() ?? "";
  const categoryId = filters?.kategorija?.trim() ?? "";
  const where: Prisma.OsnovnoSredstvoWhereInput = {
    agencija_id: user.agencija_id,
    firma_id: company.id,
    is_deleted: false,
    ...(status ? { status } : {}),
    ...(categoryId ? { kategorija_id: categoryId } : {}),
    ...(search ? { OR: [
      { inventarski_broj: { contains: search, mode: "insensitive" as const } },
      { naziv: { contains: search, mode: "insensitive" as const } },
      { serijski_broj: { contains: search, mode: "insensitive" as const } }
    ] } : {})
  };
  const [{ assets, count, pagination, sums, postedSum }, categories, canCreate] = await Promise.all([
    prisma.$transaction(async (tx) => {
      const count = await tx.osnovnoSredstvo.count({ where });
      const pagination = fixedAssetPage(filters?.strana, count);
      const assets = await tx.osnovnoSredstvo.findMany({
        where, orderBy: [{ inventarski_broj: "asc" }, { id: "asc" }],
        skip: pagination.skip, take: pagination.take,
        include: {
          obracunStavke: { where: { obracun: { status: "POSTED" } }, select: { iznos: true } },
          kategorija: { select: { naziv: true } },
          promjene: { where: { status: "CONFIRMED", is_deleted: false }, select: { delta_nabavna_vrijednost: true, delta_ispravka_vrijednosti: true } }
        }
      });
      const sums = await tx.osPromjena.aggregate({
        where: { agencija_id: user.agencija_id!, firma_id: company.id, status: "CONFIRMED", is_deleted: false, sredstvo: where },
        _sum: { delta_nabavna_vrijednost: true, delta_ispravka_vrijednosti: true }
      });
      const postedSum = await tx.osObracunStavka.aggregate({ where: { firma_id: company.id, agencija_id: user.agencija_id!, sredstvo: where, obracun: { status: "POSTED" } }, _sum: { iznos: true } });
      return { assets, count, pagination, sums, postedSum };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
    prisma.osKategorija.findMany({
      where: { agencija_id: user.agencija_id, firma_id: company.id, aktivna: true, is_deleted: false },
      orderBy: { sifra: "asc" }, select: { id: true, sifra: true, naziv: true }
    }),
    hasPermission(user, { firmaId: company.id, modul: "osnovna_sredstva", akcija: "create" })
  ]);
  const cents = (value: { toString(): string } | null) => {
    const result = value === null ? 0 : fixedAssetDecimalToCents(value);
    if (result === null) throw new Error("FIXED_ASSET_TOTAL_OUT_OF_RANGE");
    return result;
  };
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ strana: String(page), pretraga: search, status, kategorija: categoryId });
    return `/agencija/osnovna-sredstva?${params}`;
  };
  const values = assets.map((asset) => {
    const gross = asset.promjene.reduce((sum, change) => sum + cents(change.delta_nabavna_vrijednost), 0);
    const accumulated = asset.obracunStavke.reduce((sum, s) => sum + cents(s.iznos), 0) + asset.promjene.reduce((sum, change) => sum + cents(change.delta_ispravka_vrijednosti), 0);
    return { asset, gross, accumulated };
  });
  const totals = { gross: cents(sums._sum.delta_nabavna_vrijednost), accumulated: cents(sums._sum.delta_ispravka_vrijednosti) + cents(postedSum._sum.iznos) };

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div><p className="eyebrow">Osnovna sredstva</p><h2>Registar osnovnih sredstava</h2><p className="muted-text">Firma: {company.naziv}</p></div>
        {canCreate ? <Link className="primary-link" href="/agencija/osnovna-sredstva/novo">Novo sredstvo</Link> : null}
      </header>

      <section className="metric-grid">
        <article className="metric"><span>Sredstva</span><strong>{count}</strong></article>
        <article className="metric"><span>Nabavna vrijednost</span><strong>{fixedAssetCentsMoney(totals.gross)}</strong></article>
        <article className="metric"><span>Ispravka vrijednosti</span><strong>{fixedAssetCentsMoney(totals.accumulated)}</strong></article>
        <article className="metric"><span>Neto vrijednost</span><strong>{fixedAssetCentsMoney(totals.gross - totals.accumulated)}</strong></article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Filteri</h3>
            <p className="muted-text">Pretražite registar aktivne firme.</p>
          </div>
        </div>
        <form className="admin-form inline-filter-form inventory-filter-form" method="get">
          <label>
            <span>Pretraga</span>
            <input
              defaultValue={search}
              name="pretraga"
              placeholder="Broj, naziv ili serijski broj"
              type="search"
            />
          </label>
          <label>
            <span>Status</span>
            <select defaultValue={status} name="status">
              <option value="">Svi statusi</option>
              {Object.entries(fixedAssetStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Kategorija</span>
            <select defaultValue={categoryId} name="kategorija">
              <option value="">Sve kategorije</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.sifra} - {category.naziv}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Primijeni</button>
        </form>
      </section>

      <p className="muted-text">Ukupne vrijednosti obuhvataju sva sredstva za izabrane filtere. Prikazano {count ? pagination.skip + 1 : 0}–{pagination.skip + assets.length} od {count}.</p>
      <nav aria-label="Stranice registra" className="inline-filter-form">
        {pagination.page > 1 ? <Link href={pageHref(pagination.page - 1)}>Prethodna</Link> : null}
        <span>Strana {pagination.page} od {pagination.pages}</span>
        {pagination.page < pagination.pages ? <Link href={pageHref(pagination.page + 1)}>Sljedeća</Link> : null}
      </nav>
      <section className="admin-panel"><div className="table-wrap"><table><thead><tr><th>Inventarski broj</th><th>Naziv</th><th>Kategorija</th><th>Vrsta</th><th>Nabavna</th><th>Ispravka</th><th>Neto</th><th>Status</th></tr></thead><tbody>
        {values.map(({ asset, gross, accumulated }) => <tr key={asset.id}><td><Link href={`/agencija/osnovna-sredstva/${asset.id}`}>{asset.inventarski_broj}</Link></td><td>{asset.naziv}</td><td>{asset.kategorija?.naziv ?? "-"}</td><td>{fixedAssetTypeLabels[asset.vrsta_imovine as keyof typeof fixedAssetTypeLabels] ?? asset.vrsta_imovine}</td><td>{fixedAssetCentsMoney(gross)}</td><td>{fixedAssetCentsMoney(accumulated)}</td><td>{fixedAssetCentsMoney(gross - accumulated)}</td><td>{fixedAssetStatusLabels[asset.status] ?? asset.status}</td></tr>)}
        {assets.length === 0 ? <tr><td colSpan={8}>Nema sredstava za izabrane filtere.</td></tr> : null}
      </tbody></table></div></section>
    </div>
  );
}