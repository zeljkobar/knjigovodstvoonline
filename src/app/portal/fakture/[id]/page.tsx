import Link from "next/link";
import { notFound } from "next/navigation";
import { OutgoingInvoiceLinesEditor } from "@/components/OutgoingInvoiceLinesEditor";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  findDirectPortalInvoice,
  formatPortalDecimal,
  portalFiscalStatusFilterLabels,
  portalFiscalStatusTone
} from "@/lib/direct-portal-invoices";
import {
  hasDirectPortalPermission,
  podgoricaBusinessDate
} from "@/lib/direct-portal-policy";
import { decimalToScaled } from "@/lib/inventory-calculation";
import { itemPriceTypes } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";
import {
  fiscalizePortalOutgoingInvoice,
  savePortalOutgoingInvoiceDraft,
  updatePortalOutgoingInvoiceHeader
} from "../actions";

const viewPermissions = [
  { modul: "robno", akcija: "view" },
  { modul: "fiskalizacija", akcija: "view" }
];

const messages: Record<string, string> = {
  kreirana: "Nacrt je otvoren. Dodajte i sačuvajte stavke računa.",
  sacuvana: "Stavke i serverski obračun fakture su sačuvani.",
  zaglavlje: "Podaci fakture su sačuvani.",
  stavke: "Dodajte najmanje jednu ispravnu stavku.",
  artikal: "Izabrani artikal nije dostupan ovoj firmi.",
  pdv: "Artikal mora imati aktivnu PDV stopu.",
  iznosi: "Provjerite količine, cijene i rabate.",
  nije_nacrt: "Mijenjati se može samo nefiskalizovani nacrt.",
  magacin: "Izabrani magacin nije dostupan.",
  magacin_obavezan: "Za robu koja prati zalihe izaberite magacin.",
  lager: "Nema dovoljno robe na stanju za izdavanje fakture.",
  datum: "Datumi moraju pripadati aktivnoj poslovnoj godini.",
  pdv_period: "PDV period za datum fakture je zaključan.",
  potvrda: "Pregledajte konačni nacrt i ponovite eksplicitnu potvrdu.",
  izmijenjena: "Nacrt je u međuvremenu izmijenjen. Pregledajte ga ponovo.",
  fiskalizacija_u_toku:
    "Fiskalizacija je već pokrenuta. Ne pravite novi dokument.",
  fiskalizovana: "Faktura je uspješno fiskalizovana i završena bez KIF-a i naloga.",
  podesavanje: "Fiskalna konfiguracija trenutno nije spremna. Kontaktirajte podršku."
};

function date(value: Date | null | undefined) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function moneyFromCents(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)},${String(
    absolute % BigInt(100)
  ).padStart(2, "0")}`;
}

export default async function PortalInvoiceEditorPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ poruka?: string }>;
}) {
  const [{ id }, { poruka }] = await Promise.all([params, searchParams]);
  const context = await requireDirectPortalContext(
    viewPermissions,
    `/portal/fakture/${id}`,
    "all"
  );
  const priceDate = podgoricaBusinessDate();
  const [invoice, items, warehouses, groups, units, vatRates] =
    await Promise.all([
      findDirectPortalInvoice(context, id),
      prisma.artikal.findMany({
        where: {
          agencija_id: context.user.agencija_id!,
          firma_id: context.firma.id,
          aktivan: true,
          is_deleted: false
        },
        include: {
          jedinica_mjere: true,
          pdv_stopa: true,
          cijene: {
            where: {
              aktivna: true,
              is_deleted: false,
              OR: [{ vazi_od: null }, { vazi_od: { lte: priceDate } }],
              AND: [
                { OR: [{ vazi_do: null }, { vazi_do: { gte: priceDate } }] }
              ]
            },
            orderBy: [{ created_at: "desc" }]
          }
        },
        orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
      }),
      prisma.magacin.findMany({
        where: {
          agencija_id: context.user.agencija_id!,
          firma_id: context.firma.id,
          aktivan: true,
          is_deleted: false
        },
        orderBy: [{ sifra: "asc" }, { naziv: "asc" }]
      }),
      prisma.grupaArtikla.findMany({
        where: {
          agencija_id: context.user.agencija_id!,
          firma_id: context.firma.id,
          aktivna: true,
          is_deleted: false
        },
        orderBy: { naziv: "asc" },
        select: { id: true, sifra: true, naziv: true }
      }),
      prisma.jedinicaMjere.findMany({
        where: { aktivna: true },
        orderBy: [{ redosljed: "asc" }, { naziv: "asc" }],
        select: { id: true, sifra: true, naziv: true }
      }),
      prisma.pdvStopa.findMany({
        where: {
          agencija_id: context.user.agencija_id!,
          aktivna: true
        },
        orderBy: [{ redosljed: "asc" }, { procenat: "asc" }],
        select: { id: true, naziv: true, procenat: true }
      })
    ]);

  if (
    !invoice ||
    invoice.document_type !== "INVOICE" ||
    invoice.sales_channel !== "OFFICE"
  ) {
    notFound();
  }

  const canEdit = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "create"
  });
  const canPost = hasDirectPortalPermission(context.permissionKeys, {
    modul: "fiskalizacija",
    akcija: "post"
  });
  const editable =
    canEdit &&
    invoice.status === "DRAFT" &&
    !context.year.zakljucena &&
    !invoice.fiscal_api_invoice_id &&
    ["DRAFT", "NOT_REQUIRED"].includes(
      invoice.fiscal_status
    );
  const pending =
    invoice.fiscal_status === "FiscalizationPending" &&
    Boolean(
      invoice.last_fiscal_attempt_at &&
        Date.now() - invoice.last_fiscal_attempt_at.getTime() < 2 * 60 * 1000
    );
  const finalized = invoice.fiscal_status === "Fiscalized";
  const liveEnvironment =
    context.firma.fiscalCompanyLink?.fiscal_environment === "Production"
      ? "Production"
      : "Test";
  const environment =
    invoice.fiscal_environment === "Production" ||
    invoice.fiscal_environment === "Test"
      ? invoice.fiscal_environment
      : liveEnvironment;
  const environmentMismatch = Boolean(
    invoice.fiscal_environment && invoice.fiscal_environment !== liveEnvironment
  );
  const options = items
    .filter((item) => item.pdv_stopa)
    .map((item) => {
      const chosen =
        item.cijene.find(
          (price) =>
            price.komitent_id === invoice.kupac_id &&
            (!price.magacin_id || price.magacin_id === invoice.magacin_id)
        ) ??
        item.cijene.find((price) => price.magacin_id === invoice.magacin_id) ??
        item.cijene.find((price) => price.tip === itemPriceTypes.promotional) ??
        item.cijene.find((price) => price.tip === itemPriceTypes.retail) ??
        item.cijene.find((price) => price.tip === itemPriceTypes.wholesale) ??
        item.cijene[0];

      return {
        id: item.id,
        code: item.sifra,
        name: item.naziv,
        unit: item.jedinica_mjere.oznaka,
        vat: context.firma.pdv_obveznik
          ? Number(item.pdv_stopa!.procenat)
          : 0,
        service: item.usluga,
        netPrice: chosen?.cijena_bez_pdv.toString() ?? "",
        grossPrice: chosen?.cijena_sa_pdv.toString() ?? ""
      };
    });
  const taxGroups = new Map<
    string,
    { label: string; base: bigint; vat: bigint; total: bigint }
  >();

  for (const line of invoice.stavke) {
    const current = taxGroups.get(line.pdv_stopa_sifra) ?? {
      label: `${line.pdv_stopa_naziv} (${line.pdv_stopa_procenat.toString()}%)`,
      base: BigInt(0),
      vat: BigInt(0),
      total: BigInt(0)
    };
    current.base += decimalToScaled(line.osnovica, 2);
    current.vat += decimalToScaled(line.pdv_iznos, 2);
    current.total += decimalToScaled(line.ukupno_sa_pdv, 2);
    taxGroups.set(line.pdv_stopa_sifra, current);
  }

  return (
    <div className="admin-stack outgoing-invoice-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Bezgotovinske fakture / Nacrt</p>
          <h2>{invoice.interni_broj}</h2>
          <p className="muted-text">
            {invoice.kupac.naziv} · {invoice.datum_racuna.toLocaleDateString("sr-Latn-ME")}
          </p>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${portalFiscalStatusTone(invoice.fiscal_status)}`}>
            {portalFiscalStatusFilterLabels[invoice.fiscal_status] ??
              invoice.fiscal_status}
          </span>
          <Link
            className="secondary-button"
            href={`/stampa/portal/racuni/${invoice.id}`}
            prefetch={false}
            target="_blank"
          >
            A4 pregled
          </Link>
          <Link className="secondary-button" href="/portal/fakture">
            Nazad
          </Link>
        </div>
      </header>

      {poruka ? (
        <p
          className={`status-banner ${
            poruka === "fiskalizovana" ? "success" : "error"
          }`}
        >
          {poruka === "fiskalizacija_greska"
            ? `Fiskalizacija nije završena. Dokument je sačuvan.${
                invoice.correlation_id
                  ? ` ID za podršku: ${invoice.correlation_id}`
                  : ""
              }`
            : messages[poruka] ?? "Akcija nije završena."}
        </p>
      ) : null}
      {pending ? (
        <p className="status-banner warning">
          Fiskalizacija je u toku. Ne kreirajte novi dokument za istu prodaju.
        </p>
      ) : null}

      <section className="metric-grid" aria-label="Iznosi fakture">
        <article className="metric">
          <span>Osnovica</span>
          <strong>{formatPortalDecimal(invoice.ukupno_osnovica)} €</strong>
        </article>
        <article className="metric">
          <span>PDV</span>
          <strong>{formatPortalDecimal(invoice.ukupno_izlazni_pdv)} €</strong>
        </article>
        <article className="metric">
          <span>Za plaćanje</span>
          <strong>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Podaci fakture</h3>
            <p className="muted-text">Plaćanje je fiksno: virman.</p>
          </div>
          <span>{environment === "Production" ? "Produkcija" : "Test"}</span>
        </div>
        {editable ? (
          <form action={updatePortalOutgoingInvoiceHeader} className="admin-form">
            <input name="faktura_id" type="hidden" value={invoice.id} />
            <PartnerSearchInput
              companyOnly
              initialPartner={{
                id: invoice.kupac.id,
                label: `${invoice.kupac.naziv}${
                  invoice.kupac.pib ? ` (${invoice.kupac.pib})` : ""
                }`,
                naziv: invoice.kupac.naziv,
                pib: invoice.kupac.pib,
                scope: invoice.kupac.scope
              }}
              label="Kupac"
              name="kupac_id"
              quickCreateEndpoint="/api/portal/partners/quick-create"
              required
              searchEndpoint="/api/portal/partners/search"
            />
            <label>
              <span>Datum računa</span>
              <input defaultValue={date(invoice.datum_racuna)} name="datum_racuna" required type="date" />
            </label>
            <label>
              <span>Datum prometa</span>
              <input defaultValue={date(invoice.datum_prometa)} name="datum_prometa" required type="date" />
            </label>
            <label>
              <span>Rok plaćanja</span>
              <input defaultValue={date(invoice.datum_valute)} name="datum_valute" required type="date" />
            </label>
            <label>
              <span>Mjesto izdavanja</span>
              <input defaultValue={invoice.mjesto_izdavanja ?? ""} maxLength={120} name="mjesto_izdavanja" />
            </label>
            <label>
              <span>Magacin za robu</span>
              <select defaultValue={invoice.magacin_id ?? ""} name="magacin_id">
                <option value="">Bez magacina — samo usluge</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.sifra} · {warehouse.naziv}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-wide">
              <span>Napomena</span>
              <input defaultValue={invoice.napomena ?? ""} maxLength={500} name="napomena" />
            </label>
            <div className="form-actions form-wide">
              <button className="secondary-button" type="submit">Sačuvaj podatke</button>
            </div>
          </form>
        ) : (
          <div className="invoice-summary-grid">
            <span>Kupac <strong>{invoice.kupac.naziv}</strong></span>
            <span>Datum računa <strong>{date(invoice.datum_racuna)}</strong></span>
            <span>Datum prometa <strong>{date(invoice.datum_prometa)}</strong></span>
            <span>Rok plaćanja <strong>{date(invoice.datum_valute)}</strong></span>
            <span>Mjesto <strong>{invoice.mjesto_izdavanja ?? "—"}</strong></span>
            <span>Magacin <strong>{invoice.magacin ? `${invoice.magacin.sifra} · ${invoice.magacin.naziv}` : "—"}</strong></span>
          </div>
        )}
      </section>

      <section className="admin-form-section">
        <div className="panel-header">
          <div>
            <h3>Stavke fakture</h3>
            <p className="muted-text">
              Browser prikazuje pregled, a server ponavlja kompletan obračun.
            </p>
          </div>
          <span>{invoice.stavke.length} stavki</span>
        </div>
        <form action={savePortalOutgoingInvoiceDraft}>
          <input name="faktura_id" type="hidden" value={invoice.id} />
          <OutgoingInvoiceLinesEditor
            disabled={!editable}
            groups={groups.map((group) => ({
              id: group.id,
              label: `${group.sifra} · ${group.naziv}`
            }))}
            initialLines={invoice.stavke.map((line) => ({
              itemId: line.artikal_id,
              quantity: line.kolicina.toString(),
              netUnitPrice: line.jedinicna_cijena_bez_pdv.toString(),
              discountPercent: line.rabat_procenat.toString(),
              note: line.napomena ?? ""
            }))}
            items={options}
            quickItemEndpoint="/api/portal/inventory/items/quick-create"
            units={units.map((unit) => ({
              id: unit.id,
              label: `${unit.sifra} · ${unit.naziv}`
            }))}
            vatRates={vatRates.map((rate) => ({
              id: rate.id,
              label: `${rate.naziv} (${rate.procenat.toString()}%)`
            }))}
          />
          {editable ? (
            <div className="form-actions">
              <button className="primary-button" type="submit">Sačuvaj nacrt</button>
            </div>
          ) : null}
        </form>
      </section>

      {!finalized ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h3>Konačni pregled i potvrda</h3>
              <p className="muted-text">
                Poslije uspješnog JIKR-a faktura se više ne može mijenjati.
              </p>
            </div>
            <span>{environment === "Production" ? "PRODUCTION" : "TEST"}</span>
          </div>
          <div className="invoice-summary-grid">
            <span>Firma <strong>{context.firma.naziv}</strong></span>
            <span>PIB <strong>{context.firma.pib}</strong></span>
            <span>Kupac <strong>{invoice.kupac.naziv}</strong></span>
            <span>Lokalni broj <strong>{invoice.interni_broj}</strong></span>
            <span>Datum računa <strong>{date(invoice.datum_racuna)}</strong></span>
            <span>Datum prometa <strong>{date(invoice.datum_prometa)}</strong></span>
            <span>Plaćanje <strong>Virman</strong></span>
            <span>Ukupno <strong>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong></span>
          </div>
          {taxGroups.size ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>PDV stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead>
                <tbody>
                  {[...taxGroups.entries()].map(([key, group]) => (
                    <tr key={key}>
                      <td>{group.label}</td>
                      <td>{moneyFromCents(group.base)} €</td>
                      <td>{moneyFromCents(group.vat)} €</td>
                      <td>{moneyFromCents(group.total)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <form action={fiscalizePortalOutgoingInvoice} className="admin-stack">
            <input name="faktura_id" type="hidden" value={invoice.id} />
            <input name="expected_updated_at" type="hidden" value={invoice.updated_at.toISOString()} />
            <label className="checkbox-card">
              <input name="reviewed" required type="checkbox" value="yes" />
              <span>
                Pregledao/la sam kupca, datume, sve stavke, PDV i ukupan iznos.
              </span>
            </label>
            {environment === "Production" ? (
              <p className="status-banner error">
                Ovo je produkcijsko slanje. Poslije potvrde dokument dobija JIKR i ne može se uređivati.
              </p>
            ) : (
              <p className="status-banner warning">
                Dokument se šalje u testno fiskalno okruženje.
              </p>
            )}
            {environmentMismatch ? (
              <p className="status-banner error">
                Fiskalno okruženje dokumenta više nije aktivno. Fiskalizacija je
                blokirana; obratite se podršci i navedite ID dokumenta {invoice.id}.
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="primary-button"
                disabled={!canPost || !invoice.stavke.length || pending || context.readiness.blocksChanges || environmentMismatch}
                name="confirmation"
                type="submit"
                value={environment === "Production" ? "CONFIRM_PRODUCTION" : "CONFIRM_TEST"}
              >
                {pending ? "Fiskalizacija u toku…" : environment === "Production" ? "Potvrdi i fiskalizuj u produkciji" : "Potvrdi i fiskalizuj u testu"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="admin-panel">
          <h3>Faktura je završena</h3>
          <p>
            Fiskalizovana je bez KIF-a i naloga. Dostupni su detalj i A4 štampa.
          </p>
          <div className="form-actions">
            <Link className="primary-button" href={`/portal/racuni/${invoice.id}`}>Otvori fiskalni detalj</Link>
          </div>
        </section>
      )}
    </div>
  );
}
