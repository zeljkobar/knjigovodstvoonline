import { randomUUID } from "crypto";
import Link from "next/link";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { podgoricaBusinessDate } from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";
import { createPortalOutgoingInvoice } from "../actions";

const createPermissions = [
  { modul: "robno", akcija: "create" },
  { modul: "fiskalizacija", akcija: "create" }
];

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export default async function NewPortalInvoicePage({
  searchParams
}: {
  searchParams: Promise<{ poruka?: string }>;
}) {
  const [{ poruka }, context] = await Promise.all([
    searchParams,
    requireDirectPortalContext(
      createPermissions,
      "/portal/fakture/nova",
      "all"
    )
  ]);
  const today = podgoricaBusinessDate();
  const [warehouses, settings] = await Promise.all([
    prisma.magacin.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    }),
    prisma.posPodesavanje.findUnique({
      where: { firma_id: context.firma.id },
      select: { podrazumijevani_rok_dana: true, podrazumijevana_kasa: { select: { magacin_id: true } } }
    })
  ]);
  const blocked = context.readiness.blocksChanges || context.year.zakljucena;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Bezgotovinska prodaja</p>
          <h2>Nova faktura</h2>
          <p className="muted-text">
            Otvorite nacrt, zatim dodajte i provjerite stavke prije fiskalizacije.
          </p>
        </div>
        <Link className="secondary-button" href="/portal/fakture">
          Nazad na fakture
        </Link>
      </header>

      {blocked ? (
        <p className="status-banner error">
          {context.year.zakljucena
            ? "Poslovna godina je zaključana. Novi nacrt nije dozvoljen."
            : context.readiness.label}
        </p>
      ) : null}
      {poruka ? (
        <p className="status-banner error">
          {poruka === "obavezno"
            ? "Kupac i svi obavezni datumi moraju biti uneseni."
            : poruka === "datum"
              ? "Datumi moraju pripadati aktivnoj poslovnoj godini."
              : poruka === "kupac"
                ? "Izabrani kupac nije dostupan ovoj firmi."
                : poruka === "submission"
                  ? "Osvježite stranicu i pokušajte ponovo."
                  : "Nacrt nije otvoren. Provjerite unesene podatke."}
        </p>
      ) : null}

      <section className="admin-form-section">
        <form action={createPortalOutgoingInvoice} className="admin-form">
          <input name="submission_id" type="hidden" value={randomUUID()} />
          <input name="nacin_placanja" type="hidden" value="BANK_TRANSFER" />
          <PartnerSearchInput
            companyOnly
            label="Kupac"
            name="kupac_id"
            quickCreateEndpoint="/api/portal/partners/quick-create"
            required
            searchEndpoint="/api/portal/partners/search"
          />
          <label>
            <span>Datum računa</span>
            <input
              defaultValue={isoDate(today)}
              name="datum_racuna"
              required
              type="date"
            />
          </label>
          <label>
            <span>Datum prometa</span>
            <input
              defaultValue={isoDate(today)}
              name="datum_prometa"
              required
              type="date"
            />
          </label>
          <label>
            <span>Rok plaćanja</span>
            <input
              defaultValue={isoDate(addDays(today, settings?.podrazumijevani_rok_dana ?? 7))}
              name="datum_valute"
              required
              type="date"
            />
          </label>
          <label>
            <span>Mjesto izdavanja</span>
            <input
              defaultValue={context.firma.grad ?? ""}
              maxLength={120}
              name="mjesto_izdavanja"
            />
          </label>
          <label>
            <span>Magacin za robu</span>
            <select
              defaultValue={settings?.podrazumijevana_kasa?.magacin_id ?? (warehouses.length === 1 ? warehouses[0].id : "")}
              name="magacin_id"
            >
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
            <input maxLength={500} name="napomena" />
          </label>
          <div className="form-actions form-wide">
            <button className="primary-button" disabled={blocked} type="submit">
              Otvori nacrt i dodaj stavke
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
