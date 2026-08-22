import Link from "next/link";
import {
  directPortalReportChannelLabels,
  directPortalReportPaymentLabels,
  directPortalReportQuery,
  type DirectPortalReportFilters,
  type DirectPortalReportKind
} from "@/lib/direct-portal-reports";

type ReportOptions = {
  registers: Array<{
    id: string;
    sifra: string;
    naziv: string;
    aktivan: boolean;
  }>;
  groups: Array<{
    id: string;
    sifra: string;
    naziv: string;
    aktivna: boolean;
  }>;
  selectedItem: { id: string; sifra: string; naziv: string } | null;
};

export function DirectPortalReportFilters({
  kind,
  filters,
  options,
  canExport,
  showItemFilters = false
}: {
  kind: DirectPortalReportKind;
  filters: DirectPortalReportFilters;
  options: ReportOptions;
  canExport: boolean;
  showItemFilters?: boolean;
}) {
  const basePath = `/portal/izvjestaji/${kind}`;
  const query = directPortalReportQuery(filters);
  const clearSelectedItem = directPortalReportQuery(filters, {
    artikal_id: null
  });

  return (
    <section className="admin-panel" aria-labelledby="report-filter-title">
      <div className="panel-header">
        <div>
          <h3 id="report-filter-title">Filteri</h3>
          <p className="muted-text">
            Period je ograničen na izabranu poslovnu godinu. Svi zbirni podaci
            uključuju fiskalizovana storna kao negativne iznose.
          </p>
        </div>
        {canExport ? (
          <div className="header-actions">
            <Link
              className="secondary-button"
              href={`/stampa/portal/izvjestaji/${kind}?${query}`}
              target="_blank"
              prefetch={false}
            >
              A4 štampa
            </Link>
            <Link
              className="secondary-button"
              href={`/portal/izvjestaji/export?tip=${kind}&${query}`}
              prefetch={false}
            >
              CSV izvoz
            </Link>
          </div>
        ) : null}
      </div>

      {filters.invalidPeriod ? (
        <p className="status-banner error" role="alert">
          Traženi period nije ispravan ili nije u aktivnoj poslovnoj godini.
          Prikazan je podrazumijevani period.
        </p>
      ) : null}

      {showItemFilters && filters.itemId ? (
        <p className="status-banner">
          Tačan artikal: {options.selectedItem
            ? `${options.selectedItem.sifra} · ${options.selectedItem.naziv}`
            : "artikal više nije dostupan"}.{" "}
          <Link href={`${basePath}?${clearSelectedItem}`}>
            Ukloni ovaj filter
          </Link>
        </p>
      ) : null}

      <form className={`portal-filter-form${showItemFilters ? " portal-filter-form--extended" : ""}`} method="get">
        <label>
          <span>Od</span>
          <input type="date" name="od" defaultValue={filters.periodFrom} />
        </label>
        <label>
          <span>Do</span>
          <input type="date" name="do" defaultValue={filters.periodTo} />
        </label>
        <label>
          <span>Kasa</span>
          <select name="kasa" defaultValue={filters.registerId}>
            <option value="">Sve kase i OFFICE</option>
            {options.registers.map((register) => (
              <option key={register.id} value={register.id}>
                {register.sifra} · {register.naziv}
                {register.aktivan ? "" : " (neaktivna)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Kanal</span>
          <select name="kanal" defaultValue={filters.salesChannel}>
            <option value="">OFFICE i POS</option>
            {Object.entries(directPortalReportChannelLabels).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </label>
        <label>
          <span>Plaćanje</span>
          <select name="placanje" defaultValue={filters.paymentMethod}>
            <option value="">Sva plaćanja</option>
            {Object.entries(directPortalReportPaymentLabels).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              )
            )}
          </select>
        </label>
        <label>
          <span>Kupac (naziv ili PIB)</span>
          <input
            name="kupac"
            defaultValue={filters.buyer}
            maxLength={120}
          />
        </label>
        {showItemFilters ? (
          <>
            <label>
              <span>Artikal (šifra ili naziv)</span>
              <input
                name="artikal"
                defaultValue={filters.item}
                maxLength={120}
              />
            </label>
            <label>
              <span>Grupa artikala</span>
              <select name="grupa" defaultValue={filters.groupId}>
                <option value="">Sve grupe</option>
                {options.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.sifra} · {group.naziv}
                    {group.aktivna ? "" : " (neaktivna)"}
                  </option>
                ))}
              </select>
            </label>
            {filters.itemId ? (
              <input type="hidden" name="artikal_id" value={filters.itemId} />
            ) : null}
          </>
        ) : null}
        <div className="form-actions">
          <button className="primary-button" type="submit">
            Primijeni filtere
          </button>
          <Link className="secondary-button" href={basePath}>
            Poništi
          </Link>
        </div>
      </form>
    </section>
  );
}
