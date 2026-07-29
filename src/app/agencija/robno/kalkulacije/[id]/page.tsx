import Link from "next/link";
import { notFound } from "next/navigation";
import { CalculationItemPicker } from "@/components/CalculationItemPicker";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import {
  calculationSaleTypes,
  calculationStatusLabel,
  calculationStatuses
} from "@/lib/inventory-calculation";
import { itemPriceTypes } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../../_shared";
import {
  addCalculationLine,
  addDependentCost,
  deleteCalculation,
  deleteCalculationLine,
  deleteDependentCost,
  postCalculation,
  updateCalculationLine,
  updateCalculationHeader
} from "../actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ poruka?: string; nove_sifre?: string }>;
};

const messages: Record<string, string> = {
  kreirana: "Kalkulacija je otvorena. Dodajte artikle.",
  mapr_kreirana: "Kalkulacija i sve MAPR stavke su kreirane. Provjerite prodajne cijene i zbirove.",
  sacuvana: "Zaglavlje kalkulacije je sačuvano.",
  stavka_dodata: "Stavka je dodata i kalkulacija je preračunata.",
  stavka_sacuvana: "Stavka je sačuvana i kalkulacija je preračunata.",
  stavka_obrisana: "Stavka je obrisana.",
  trosak_dodat: "Zavisni trošak je dodat i raspoređen po vrijednosti robe.",
  trosak_obrisan: "Zavisni trošak je obrisan i raspodjela je preračunata.",
  stavka_iznosi: "Provjerite količinu, fakturnu cijenu, rabat i obaveznu prodajnu cijenu sa PDV-om.",
  stavka_artikal: "Izabrani artikal ne može zaduživati lager.",
  trosak_iznos: "Unesite vrstu i pozitivan iznos zavisnog troška.",
  nije_nacrt: "Mijenjati se može samo nacrt kalkulacije.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju.",
  knjizenje_stavke: "Kalkulacija mora imati najmanje jednu stavku.",
  knjizenje_podesavanja: "Podesite konta u Robno → Podešavanja.",
  knjizenje_vrsta_naloga: "Nije podešena vrsta naloga Kalkulacije.",
  knjizenje_konto: "Konto iz šeme knjiženja nije dostupan.",
  knjizenje_sema: "Šema knjiženja kalkulacije nije kompletna.",
  knjizenje_nije_balansiran: "Nalog kalkulacije nije balansiran. Provjerite Robno → Podešavanja.",
  knjizenje_pdv: "PDV stopa sa stavke nije dostupna u aktivnim PDV stopama.",
  pdv_period: "PDV period za datum računa je zaključan.",
  dupli_racun: "Ovaj račun dobavljača već postoji u KUF-u."
};

function inputDate(date: Date | null) {
  return date?.toISOString().slice(0, 10) ?? "";
}

function decimal(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export default async function CalculationDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, { poruka, nove_sifre: newCodes }, context, workContext] = await Promise.all([
    params,
    searchParams,
    getInventoryContext("view"),
    readWorkContext()
  ]);
  if (!context.firma) return <MissingInventoryContext title="Kalkulacija" />;
  if (!context.allowed) return <InventoryAccessDenied title="Kalkulacija" />;
  if (!workContext.poslovnaGodinaId) return <MissingInventoryContext title="Kalkulacija" />;
  const firmaId = context.firma.id;

  const [calculation, warehouses, items, groups, units, vatRates] = await Promise.all([
    prisma.kalkulacija.findFirst({
      where: {
        id,
        agencija_id: context.user.agencija_id!,
        firma_id: firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false
      },
      include: {
        dobavljac: true,
        magacin: true,
        poslovna_godina: { select: { zakljucena: true } },
        stavke: {
          include: {
            artikal: {
              include: {
                jedinica_mjere: true
              }
            }
          },
          orderBy: { redni_broj: "asc" }
        },
        zavisniTroskovi: { orderBy: { created_at: "asc" } }
      }
    }),
    prisma.magacin.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.artikal.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false,
        usluga: false,
        prati_zalihe: true
      },
      include: {
        jedinica_mjere: true,
        pdv_stopa: true,
        cijene: {
          where: { tip: itemPriceTypes.retail, aktivna: true, is_deleted: false },
          orderBy: { vazi_od: "desc" },
          take: 1
        }
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: firmaId,
        aktivna: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
    }),
    prisma.jedinicaMjere.findMany({
      where: { aktivna: true },
      orderBy: [{ redosljed: "asc" }, { naziv: "asc" }]
    }),
    prisma.pdvStopa.findMany({
      where: { agencija_id: context.user.agencija_id!, aktivna: true },
      orderBy: [{ redosljed: "asc" }, { procenat: "desc" }]
    })
  ]);
  if (!calculation) notFound();

  const editable =
    calculation.status === calculationStatuses.draft && !calculation.poslovna_godina.zakljucena;
  const supplier = {
    id: calculation.dobavljac.id,
    label: `${calculation.dobavljac.naziv}${calculation.dobavljac.pib ? ` · PIB ${calculation.dobavljac.pib}` : ""}`,
    naziv: calculation.dobavljac.naziv,
    pib: calculation.dobavljac.pib,
    scope: calculation.dobavljac.scope
  };
  const totals = [
    ["Fakturno bez PDV", calculation.ukupno_fakturno_bez_pdv],
    ["Rabat", calculation.ukupno_rabat],
    ["Neto faktura", calculation.ukupno_neto_fakturno],
    ["Ulazni PDV", calculation.ukupno_ulazni_pdv],
    ["Zavisni troškovi", calculation.ukupno_zavisni_troskovi],
    ["Nabavna vrijednost", calculation.ukupno_nabavna_vrijednost],
    ["Prodajna vrijednost sa PDV", calculation.ukupno_prodajna_vrijednost_sa_pdv],
    ["Razlika u cijeni", calculation.ukupno_razlika_u_cijeni]
  ] as const;

  return (
    <div className="admin-stack calculation-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Nabavka / Kalkulacije</p>
          <h2>{calculation.interni_broj}</h2>
          <p className="muted-text">{calculation.dobavljac.naziv} · račun {calculation.broj_racuna_dobavljaca}</p>
        </div>
        <div className="header-actions">
          <span className={`status-badge status-${calculation.status.toLowerCase()}`}>{calculationStatusLabel(calculation.status)}</span>
          <Link className="secondary-link" href={`/stampa/robno/kalkulacije/${id}`} target="_blank">Štampa</Link>
          <Link className="secondary-link" href="/agencija/robno/kalkulacije">Nazad</Link>
        </div>
      </header>

      {poruka ? (
        <p className="admin-message">
          {poruka.startsWith("zavrsena:")
            ? `Kalkulacija je završena, lager je zadužen i kreiran je nalog ${poruka.split(":")[1] || ""}. Sada čeka preuzimanje u odgovarajuću KUF knjigu.`
            : `${messages[poruka] ?? poruka}${
                poruka === "mapr_kreirana" && newCodes
                  ? ` Nove šifre artikala: ${newCodes.split(",").join(", ")}.`
                  : ""
              }`}
        </p>
      ) : null}

      <section className="metric-grid calculation-metrics">
        {totals.map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{decimal(value)}</strong></article>)}
      </section>

      <section className="admin-form-section">
        <div className="panel-header"><h3>Zaglavlje</h3><span>{editable ? "Polja se mogu mijenjati" : "Dokument je zaključan"}</span></div>
        <form action={updateCalculationHeader} className="admin-form calculation-header-form">
          <input type="hidden" name="firma_id" value={firmaId} />
          <input type="hidden" name="kalkulacija_id" value={id} />
          <PartnerSearchInput disabled={!editable} initialPartner={supplier} label="Dobavljač" name="dobavljac_id" required />
          <label><span>Magacin</span><select name="magacin_id" defaultValue={calculation.magacin_id} disabled={!editable}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}</option>)}</select></label>
          <label><span>Broj računa dobavljača</span><input name="broj_racuna_dobavljaca" defaultValue={calculation.broj_racuna_dobavljaca} disabled={!editable} required /></label>
          <label><span>Datum računa</span><input type="date" name="datum_racuna_dobavljaca" defaultValue={inputDate(calculation.datum_racuna_dobavljaca)} disabled={!editable} required /></label>
          <label><span>Datum kalkulacije</span><input type="date" name="datum_kalkulacije" defaultValue={inputDate(calculation.datum_kalkulacije)} disabled={!editable} required /></label>
          <label><span>Datum valute</span><input type="date" name="datum_valute" defaultValue={inputDate(calculation.datum_valute)} disabled={!editable} /></label>
          <label><span>Tip prodaje</span><select name="tip_prodaje" defaultValue={calculation.tip_prodaje} disabled={!editable}><option value={calculationSaleTypes.wholesale}>Veleprodaja</option><option value={calculationSaleTypes.retail}>Maloprodaja</option></select></label>
          <label className="form-wide"><span>Napomena</span><input name="napomena" defaultValue={calculation.napomena ?? ""} disabled={!editable} /></label>
          {editable ? <div className="form-actions form-wide"><button className="secondary-button" type="submit">Sačuvaj zaglavlje</button></div> : null}
        </form>
      </section>

      {editable ? (
        <section className="admin-form-section calculation-posting-panel">
          <div className="panel-header">
            <div>
              <h3>Završavanje kalkulacije</h3>
              <p className="muted-text">
                Jedna transakcija kreira nacrt naloga kalkulacije i ulaz na lager.
              </p>
            </div>
            <span>Operacija se ne može ponoviti</span>
          </div>
          <p className="admin-hint">
            Poslije završavanja kalkulacija se preuzima iz odgovarajuće KUF knjige. Taj KUF
            zapis se neće ponovo knjižiti po redovnim pravilima KUF-a.
          </p>
          <form action={postCalculation} className="form-actions">
            <input type="hidden" name="firma_id" value={firmaId} />
            <input type="hidden" name="kalkulacija_id" value={id} />
            <button
              className="primary-button"
              type="submit"
              disabled={calculation.stavke.length === 0}
            >
              Završi kalkulaciju
            </button>
          </form>
        </section>
      ) : null}

      {calculation.status === calculationStatuses.waitingKuf ? (
        <section className="admin-panel calculation-posting-panel">
          <div className="panel-header">
            <div>
              <h3>Čeka prenos u KUF</h3>
              <p className="muted-text">
                Otvorite KUF knjigu za mjesec računa i izaberite „Preuzmi kalkulacije“.
              </p>
            </div>
            {calculation.nalog_id ? (
              <Link className="secondary-button" href={`/agencija/nalozi/${calculation.nalog_id}`}>
                Vidi nalog kalkulacije
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {calculation.status === calculationStatuses.posted && calculation.kuf_book_id ? (
        <section className="admin-panel calculation-posting-panel">
          <div className="panel-header">
            <div>
              <h3>Prenesena u KUF</h3>
              <p className="muted-text">
                KUF zapis je označen kao knjižen kroz kalkulaciju i neće ući u redovno
                knjiženje KUF knjige.
              </p>
            </div>
            <div className="button-row">
              {calculation.nalog_id ? (
                <Link className="secondary-button" href={`/agencija/nalozi/${calculation.nalog_id}`}>
                  Vidi nalog
                </Link>
              ) : null}
              <Link className="secondary-button" href={`/agencija/racuni/kuf/${calculation.kuf_book_id}`}>
                Vidi KUF
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {editable ? (
        <section className="admin-form-section calculation-line-entry">
          <div className="panel-header"><div><h3>Brzi unos stavke</h3><p className="muted-text">Prodajna cijena sa PDV-om je obavezna; marža i RUC se računaju automatski.</p></div><span>{items.length} artikala</span></div>
          <form action={addCalculationLine} className="admin-form calculation-item-form">
            <input type="hidden" name="firma_id" value={firmaId} />
            <input type="hidden" name="kalkulacija_id" value={id} />
            <CalculationItemPicker
              groups={groups.map((group) => ({ id: group.id, label: `${group.sifra} · ${group.naziv}` }))}
              units={units.map((unit) => ({ id: unit.id, label: `${unit.oznaka} · ${unit.naziv}` }))}
              vatRates={vatRates.map((rate) => ({ id: rate.id, label: `${rate.naziv} · ${rate.procenat.toString()}%` }))}
              items={items.map((item) => ({
                id: item.id,
                sifra: item.sifra,
                naziv: item.naziv,
                unitCode: item.jedinica_mjere.oznaka,
                vatPercent: item.pdv_stopa?.procenat.toString() ?? "0",
                saleGrossPrice: item.cijene[0]?.cijena_sa_pdv.toString() ?? ""
              }))}
            />
            <label><span>Količina</span><input name="kolicina" inputMode="decimal" placeholder="1,000" required /></label>
            <label><span>Fakturna cijena bez PDV</span><input name="fakturna_cijena" inputMode="decimal" placeholder="0,0000" required /></label>
            <label><span>Rabat %</span><input name="rabat_procenat" inputMode="decimal" defaultValue="0" /></label>
            <label><span>Prodajna cijena sa PDV *</span><input id="calculation-sale-price" name="prodajna_cijena_sa_pdv" inputMode="decimal" placeholder="0,00" required /></label>
            <div className="form-actions"><button className="primary-button" type="submit">Dodaj stavku</button></div>
          </form>
        </section>
      ) : null}

      <section className="admin-panel calculation-lines-panel">
        <div className="panel-header"><h3>Stavke kalkulacije</h3><span>{calculation.stavke.length} stavki</span></div>
        {calculation.stavke.length === 0 ? <p className="empty-state">Dodajte najmanje jednu robnu stavku.</p> : (
          <div className="table-wrap calculation-table-wrap">
            <table className="admin-table calculation-table">
              <thead><tr><th>#</th><th>Artikal</th><th>Količina / JM</th><th>Fakturna cijena</th><th>Rabat</th><th>Nabavna cijena</th><th>Ulazni PDV</th><th>Prodajna sa PDV</th><th>Marža / RUC</th>{editable ? <th></th> : null}</tr></thead>
              <tbody>{calculation.stavke.map((line) => (
                <tr key={line.id}>
                  <td>{line.redni_broj}</td>
                  <td><strong>{line.artikal.sifra}</strong><small className="table-secondary">{line.artikal.naziv}</small></td>
                  <td className="numeric-cell">{editable ? <input className="calculation-table-input" form={`line-${line.id}`} name="kolicina" defaultValue={line.kolicina.toString()} inputMode="decimal" required /> : decimal(line.kolicina, 3)}<small className="table-secondary">{line.artikal.jedinica_mjere.oznaka}</small></td>
                  <td className="numeric-cell">{editable ? <input className="calculation-table-input" form={`line-${line.id}`} name="fakturna_cijena" defaultValue={line.fakturna_cijena.toString()} inputMode="decimal" required /> : decimal(line.fakturna_cijena, 4)}<small className="table-secondary">Neto {decimal(line.neto_fakturna_vrijednost)}</small></td>
                  <td className="numeric-cell">{editable ? <input className="calculation-table-input compact" form={`line-${line.id}`} name="rabat_procenat" defaultValue={line.rabat_procenat.toString()} inputMode="decimal" /> : decimal(line.rabat_procenat, 2)}%<small className="table-secondary">{decimal(line.rabat_iznos)}</small></td>
                  <td className="numeric-cell">{decimal(line.jedinicna_nabavna_cijena, 4)}<small className="table-secondary">Zav. trošak {decimal(line.zavisni_trosak)}</small></td>
                  <td className="numeric-cell">{decimal(line.ulazni_pdv_stopa, 2)}%<small className="table-secondary">{decimal(line.ulazni_pdv_iznos)}</small></td>
                  <td className="numeric-cell">{editable ? <input className="calculation-table-input" form={`line-${line.id}`} name="prodajna_cijena_sa_pdv" defaultValue={line.prodajna_cijena_sa_pdv.toString()} inputMode="decimal" required /> : decimal(line.prodajna_cijena_sa_pdv, 4)}<small className="table-secondary">Vrijednost {decimal(line.prodajna_vrijednost_sa_pdv)}</small></td>
                  <td className="numeric-cell">{decimal(line.marza_procenat, 2)}%<small className="table-secondary">RUC {decimal(line.ruc_procenat, 2)}%</small></td>
                  {editable ? <td><form action={updateCalculationLine} id={`line-${line.id}`}><input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="kalkulacija_id" value={id} /><input type="hidden" name="stavka_id" value={line.id} /><button className="table-action" type="submit">Sačuvaj</button></form><form action={deleteCalculationLine}><input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="kalkulacija_id" value={id} /><input type="hidden" name="stavka_id" value={line.id} /><button className="table-action danger-action" type="submit">Obriši</button></form></td> : null}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-form-section">
        <div className="panel-header"><div><h3>Zavisni troškovi</h3><p className="muted-text">Prevoz, špedicija i drugi troškovi raspoređuju se po neto vrijednosti robe.</p></div><strong>{decimal(calculation.ukupno_zavisni_troskovi)}</strong></div>
        {editable ? (
          <form action={addDependentCost} className="admin-form dependent-cost-form">
            <input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="kalkulacija_id" value={id} />
            <label><span>Vrsta</span><select name="vrsta" defaultValue="PREVOZ"><option value="PREVOZ">Prevoz</option><option value="SPEDICIJA">Špedicija</option><option value="OSIGURANJE">Osiguranje</option><option value="OSTALO">Ostalo</option></select></label>
            <label><span>Iznos</span><input name="iznos" inputMode="decimal" required /></label>
            <label><span>Opis</span><input name="opis" /></label>
            <div className="form-actions"><button className="secondary-button" type="submit">Dodaj trošak</button></div>
          </form>
        ) : null}
        {calculation.zavisniTroskovi.length ? <div className="compact-list">{calculation.zavisniTroskovi.map((cost) => <div className="compact-list-row" key={cost.id}><span><strong>{cost.vrsta}</strong>{cost.opis ? ` · ${cost.opis}` : ""}</span><span>{decimal(cost.iznos)} EUR</span>{editable ? <form action={deleteDependentCost}><input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="kalkulacija_id" value={id} /><input type="hidden" name="trosak_id" value={cost.id} /><button className="table-action danger-action" type="submit">Obriši</button></form> : null}</div>)}</div> : <p className="empty-state">Nema zavisnih troškova.</p>}
      </section>

      {editable ? (
        <section className="danger-zone">
          <div><h3>Brisanje nacrta</h3><p>Brisanje je soft delete i ostaje evidentirano u audit logu.</p></div>
          <form action={deleteCalculation}><input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="kalkulacija_id" value={id} /><input name="delete_reason" placeholder="Razlog brisanja" /><button className="danger-button" type="submit">Obriši nacrt</button></form>
        </section>
      ) : null}
    </div>
  );
}
