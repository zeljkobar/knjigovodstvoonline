import { taxClassificationLabel } from "@/lib/fixed-assets-tax-groups";
import { DepreciationFields } from "@/components/fixed-assets/DepreciationFields";
import { fixedAssetMethodLabels, derivedUnitRate } from "@/lib/fixed-assets-rates";
import { createFixedAssetParameter, saveFixedAssetUsage } from "../actions";
import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { fixedAssetChangeLabels, fixedAssetDepreciationEligibility, fixedAssetDecimalToCents, fixedAssetCentsMoney, fixedAssetMoney, fixedAssetStatusLabels, fixedAssetTypeLabels } from "@/lib/fixed-assets";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type AssetPageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ poruka?: string }> };

const messages: Record<string, string> = {
  proknjizena_istorija: "Izmjena bi uticala na proknjiženu amortizaciju. Istorijski podaci su zaštićeni.",
  ucinak_sacuvan: "Učinak je sačuvan.",
  ucinak_neispravan: "Provjerite datume, količinu, razlog i aktivnu godinu. Period mora biti unutar jednog mjeseca i jedne verzije parametara.",
  ucinak_preklapanje: "Period se preklapa sa postojećim unosom učinka.",
  ucinak_kapacitet: "Zbir učinka prelazi procijenjeni kapacitet. Prvo unesite novu procjenu za budući period.",
  ucinak_zavisnost: "Kasnija verzija parametara zavisi od ovog učinka; istorijski unos se ne može mijenjati.",
  istorija_ucinka: "Dopunite raniji učinak do datuma promjene. Uklonite buduće unose učinka prije dodavanja nove verzije.",
  kontekst_promijenjen: "Firma ili godina je promijenjena u drugom tabu. Ponovo otvorite formu za izabrani kontekst.",
  pdv_zakljucan: "Promjena utiče na zaključani PDV period. Izmjena nije dozvoljena.",
  vrsta_nepodrzana: "Ova vrsta imovine ne podržava promjenu parametara amortizacije u trenutnoj fazi.",

  sredstvo_sacuvano: "Sredstvo je sačuvano.",
  parametar_sacuvan: "Nova verzija parametara je sačuvana.",
  parametar_obavezno: "Popunite datum, metodu, stopu ili parametre učinka, ostatak vrijednosti i razlog promjene.",
  parametar_datum_postoji: "Za izabrani datum već postoji verzija parametara.",
  parametar_datum: "Datum važenja mora pripadati aktivnoj godini i ne može biti prije raspoloživosti.",
  parametar_redosljed: "Nova verzija mora važiti poslije posljednje sačuvane verzije parametara.",
  parametar_vrijednost: "Ostatak vrijednosti nije usklađen sa vrijednošću sredstva.",
  parametar_zastario: "Kartica je u međuvremenu izmijenjena. Pregledajte podatke i pokušajte ponovo.",
  parametar_greska: "Nova verzija parametara nije sačuvana.",
  godina_zakljucena: "Poslovna godina je zaključana."
};

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextDateOnly(date: Date) {
  return dateOnly(new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  )));
}

export default async function FixedAssetPage({ params, searchParams }: AssetPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  const { id } = await params;
  const query = await searchParams;
  if (!user.agencija_id || !context.firmaId) notFound();

  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "view" });
  const asset = await prisma.osnovnoSredstvo.findFirst({
    where: { id, agencija_id: user.agencija_id, firma_id: context.firmaId, is_deleted: false },
    include: {
      obracunStavke: { where: { obracun: { status: "POSTED" } }, select: { iznos: true } },
      kategorija: { select: { sifra: true, naziv: true } },
      poslovna_jedinica: { select: { sifra: true, naziv: true } },
      ucinci: { where: { is_deleted: false }, orderBy: { datum_od: "desc" } },
      parametri: { orderBy: { vazi_od: "desc" } },
      promjene: { where: { is_deleted: false }, orderBy: [{ datum: "desc" }, { created_at: "desc" }], include: { poslovna_godina: { select: { godina: true } } } }
    }
  });
  if (!asset) notFound();

  const [canUpdate, canCreate, canDelete, year] = await Promise.all([
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "update" }),
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "create" }),
    hasPermission(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "delete" }),
    context.poslovnaGodinaId
      ? prisma.poslovnaGodina.findFirst({
          where: { id: context.poslovnaGodinaId, firma_id: context.firmaId },
          select: { datum_od: true, datum_do: true, zakljucena: true }
        })
      : null
  ]);
  const latestParameter = asset.parametri[0];
  const earliestParameterDate = latestParameter && year
    ? [nextDateOnly(latestParameter.vazi_od), dateOnly(year.datum_od)].sort().at(-1)!
    : null;

  const confirmed = asset.promjene.filter((change) => change.status === "CONFIRMED");
  const gross = confirmed.reduce((sum, change) => sum + fixedAssetDecimalToCents(change.delta_nabavna_vrijednost)!, 0);
  const postedDepreciation = asset.obracunStavke.reduce((sum, s) => sum + fixedAssetDecimalToCents(s.iznos)!, 0);
  const accumulated = postedDepreciation + confirmed.reduce((sum, change) => sum + fixedAssetDecimalToCents(change.delta_ispravka_vrijednosti)!, 0);

  return (
    <div className="admin-stack">
      <header className="admin-header"><div><p className="eyebrow">{asset.inventarski_broj}</p><h2>{asset.naziv}</h2><p className="muted-text">{fixedAssetStatusLabels[asset.status] ?? asset.status}</p></div></header>
      {query?.poruka && messages[query.poruka] ? <p className="admin-note">{messages[query.poruka]}</p> : null}
      <section className="metric-grid"><article className="metric"><span>Nabavna vrijednost</span><strong>{fixedAssetCentsMoney(gross)}</strong></article><article className="metric"><span>Ispravka vrijednosti</span><strong>{fixedAssetCentsMoney(accumulated)}</strong></article><article className="metric"><span>Neto vrijednost</span><strong>{fixedAssetCentsMoney(gross - accumulated)}</strong></article></section>
      <section className="admin-panel"><div className="panel-header"><div><h3>Podaci kartice</h3><span>Kartica važi kroz sve poslovne godine.</span></div></div><dl className="detail-grid"><div><dt>Vrsta</dt><dd>{fixedAssetTypeLabels[asset.vrsta_imovine as keyof typeof fixedAssetTypeLabels] ?? asset.vrsta_imovine}</dd></div><div><dt>Kategorija</dt><dd>{asset.kategorija ? `${asset.kategorija.sifra} - ${asset.kategorija.naziv}` : "-"}</dd></div><div><dt>Poslovna jedinica</dt><dd>{asset.poslovna_jedinica ? `${asset.poslovna_jedinica.sifra} - ${asset.poslovna_jedinica.naziv}` : "-"}</dd></div><div><dt>Lokacija</dt><dd>{asset.lokacija ?? "-"}</dd></div><div><dt>Zadužena osoba</dt><dd>{asset.zaduzena_osoba ?? "-"}</dd></div><div><dt>Serijski broj</dt><dd>{asset.serijski_broj ?? "-"}</dd></div></dl></section>
      <section className="admin-panel"><div className="panel-header"><div><h3>Parametri</h3><span>Datirane verzije za budući obračun.</span></div></div><div className="table-wrap"><table><thead><tr><th>Važi od</th><th>Metoda</th><th>Vijek</th><th>Stopa amortizacije</th><th>Osnovica</th><th>Učinak: ukupno / prethodno</th><th>Ostatak</th><th>Razlog</th><th>Poreski tretman</th></tr></thead><tbody>{asset.parametri.map((parameter) => <tr key={parameter.id}><td>{parameter.vazi_od.toLocaleDateString("sr-Latn-ME")}</td><td>{asset.vrsta_imovine === "LAND" ? "Bez amortizacije" : fixedAssetMethodLabels[parameter.metoda] ?? parameter.metoda}</td><td>{asset.vrsta_imovine === "LAND" ? "Ne amortizuje se" : parameter.korisni_vijek_mjeseci ? `${parameter.korisni_vijek_mjeseci} mjeseci` : "—"}</td><td>{asset.vrsta_imovine === "LAND" ? "—" : parameter.godisnja_stopa ? `${parameter.godisnja_stopa.toString()}%` : parameter.metoda === "UNITS_OF_PRODUCTION" ? `${parameter.stopa_po_jedinici?.toString() ?? derivedUnitRate(fixedAssetDecimalToCents(parameter.osnovica ?? "0")!,parameter.ocekivani_ucinak?.toString() ?? "")} EUR/${parameter.jedinica_ucinka}` : `Prema vijeku (${parameter.algoritam})`}</td><td>{parameter.osnovica ? fixedAssetMoney(parameter.osnovica) : "—"}</td><td>{parameter.ocekivani_ucinak ? `${parameter.ocekivani_ucinak} / ${parameter.prethodni_ucinak ?? 0} ${parameter.jedinica_ucinka}` : "—"}</td><td>{fixedAssetMoney(parameter.ostatak_vrijednosti)}</td><td>{parameter.razlog_promjene ?? "-"}</td><td>{taxClassificationLabel(parameter.poreski_tretman, parameter.poreska_grupa)}</td></tr>)}</tbody></table></div></section>
      {canUpdate && year && latestParameter && asset.status === "ACTIVE" && fixedAssetDepreciationEligibility(asset.vrsta_imovine) === "SUPPORTED" ? (
        <section className="admin-panel">
          <div className="panel-header"><div><h3>Nova verzija parametara</h3><span>Promjena važi unaprijed; prethodne verzije ostaju sačuvane.</span></div></div>
          <form action={createFixedAssetParameter} className="admin-form inline-filter-form">
            <input type="hidden" name="ocekivana_firma_id" value={context.firmaId ?? ""} />
            <input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId ?? ""} />
            <input name="sredstvo_id" type="hidden" value={asset.id} />
            <input name="ocekivana_verzija" type="hidden" value={asset.verzija} />
            <label><span>Važi od</span><input disabled={year.zakljucena} max={dateOnly(year.datum_do)} min={earliestParameterDate ?? dateOnly(year.datum_od)} name="vazi_od" required type="date" /></label>
            <fieldset disabled={year.zakljucena}><div className="form-grid"><DepreciationFields revision initialMethod={latestParameter.metoda} initialRate={latestParameter.godisnja_stopa?.toString() ?? ""} initialResidual={latestParameter.ostatak_vrijednosti.toString()} initialLife={latestParameter.korisni_vijek_mjeseci?.toString()} initialUnit={latestParameter.jedinica_ucinka ?? ""} initialSource={latestParameter.izvor_stope ?? "DERIVED"} initialUnitRate={latestParameter.stopa_po_jedinici?.toString()} /></div></fieldset>
            <label><span>Razlog promjene</span><input disabled={year.zakljucena} maxLength={300} name="razlog_promjene" required /></label>
            <button disabled={year.zakljucena} type="submit">Sačuvaj novu verziju</button>
          </form>
        </section>
      ) : null}
      {asset.parametri.some(p=>p.metoda==="UNITS_OF_PRODUCTION") && year ? <section className="admin-panel">
        <div className="panel-header"><div><h3>Ostvareni učinak</h3><p className="muted-text">Unesite količinu za svaki mjesec ili njegov segment. Datumi su uključivi; unesite 0 ako nije bilo korišćenja. Za promjenu parametara usred mjeseca razdvojite unose na tom datumu.</p></div></div>
        {canCreate && !year.zakljucena ? <form action={saveFixedAssetUsage} className="admin-form inline-filter-form">
          <input type="hidden" name="ocekivana_firma_id" value={context.firmaId ?? ""}/><input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId ?? ""}/><input type="hidden" name="sredstvo_id" value={asset.id}/><input type="hidden" name="ocekivana_verzija" value={asset.verzija}/>
          <label>Od<input type="date" name="datum_od" min={dateOnly(year.datum_od)} max={dateOnly(year.datum_do)} required/></label><label>Do (uključivo)<input type="date" name="datum_do" min={dateOnly(year.datum_od)} max={dateOnly(year.datum_do)} required/></label>
          <label>Količina učinka<input inputMode="decimal" name="kolicina" required placeholder="0"/></label><label>Izvor / napomena<input name="razlog" maxLength={300} required/></label><button type="submit">Dodaj učinak</button>
        </form> : null}
        <div className="table-wrap"><table><thead><tr><th>Period</th><th>Količina / jedinica</th><th>Napomena</th><th>Ispravka</th></tr></thead><tbody>{asset.ucinci.map(u=><tr key={u.id}>
          <td>{dateOnly(u.datum_od)} – {dateOnly(u.datum_do)}</td><td>{u.kolicina.toString()} {asset.parametri.find(p=>p.id===u.parametar_id)?.jedinica_ucinka}</td><td>{u.razlog}</td><td>{canUpdate && !year.zakljucena && u.poslovna_godina_id===context.poslovnaGodinaId ? <details><summary>Izmijeni / ukloni</summary><form action={saveFixedAssetUsage} className="compact-form">
            <input type="hidden" name="ocekivana_firma_id" value={context.firmaId ?? ""}/><input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId??""}/><input type="hidden" name="sredstvo_id" value={asset.id}/><input type="hidden" name="ocekivana_verzija" value={asset.verzija}/><input type="hidden" name="ucinak_id" value={u.id}/>
            <label>Od<input name="datum_od" type="date" defaultValue={dateOnly(u.datum_od)} required/></label><label>Do<input name="datum_do" type="date" defaultValue={dateOnly(u.datum_do)} required/></label><label>Količina<input name="kolicina" inputMode="decimal" defaultValue={u.kolicina.toString()} required/></label><label>Razlog ispravke<input name="razlog" maxLength={300} required/></label><button type="submit">Sačuvaj ispravku</button>{canDelete ? <button type="submit" name="obrisi" value="1">Ukloni unos</button> : null}
          </form></details>:"—"}</td></tr>)}{asset.ucinci.length===0?<tr><td colSpan={4}>Još nema unosa učinka.</td></tr>:null}</tbody></table></div>
      </section>:null}
      <section className="admin-panel"><div className="panel-header"><div><h3>Istorija promjena</h3><span>Samo potvrđene promjene utiču na vrijednosti registra.</span></div></div><div className="table-wrap"><table><thead><tr><th>Datum</th><th>Godina</th><th>Vrsta</th><th>Status</th><th>Nabavna vrijednost</th><th>Ispravka</th><th>Napomena</th></tr></thead><tbody>{asset.promjene.map((change) => <tr key={change.id}><td>{change.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{change.poslovna_godina.godina}</td><td>{fixedAssetChangeLabels[change.vrsta] ?? change.vrsta}</td><td>{change.status === "CONFIRMED" ? "Potvrđeno" : "Nacrt"}</td><td>{fixedAssetMoney(change.delta_nabavna_vrijednost)}</td><td>{fixedAssetMoney(change.delta_ispravka_vrijednosti)}</td><td>{change.razlog ?? "-"}</td></tr>)}</tbody></table></div></section>
    </div>
  );
}