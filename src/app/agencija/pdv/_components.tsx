import Link from "next/link";
import { pdvMonths, statusLabel } from "@/lib/pdv";

export function PdvMonthForm({
  action,
  month
}: {
  action: string;
  month: number;
}) {
  return (
    <form className="compact-form account-filter-form" action={action}>
      <label>
        <span>Mjesec</span>
        <select name="mjesec" defaultValue={month}>
          {pdvMonths.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary-button" type="submit">
        Prikaži
      </button>
    </form>
  );
}

export function PdvStatusPill({ status }: { status?: string | null }) {
  if (!status) {
    return <span className="status-pill">Nije kreiran</span>;
  }

  const className =
    status === "LOCKED" || status === "POSTED"
      ? "status-pill status-pill--success"
      : status === "READY" || status === "SUBMITTED"
        ? "status-pill status-pill--warning"
        : "status-pill";

  return <span className={className}>{statusLabel(status)}</span>;
}

export function PdvEmptyContext() {
  return (
    <section className="admin-panel">
      <h3>Izaberite firmu i poslovnu godinu</h3>
      <p className="empty-state">PDV modul koristi globalni kontekst iz gornje trake.</p>
    </section>
  );
}

export function PdvReturnActions({
  month,
  prijavaId,
  canPost
}: {
  month: number;
  prijavaId?: string;
  canPost: boolean;
}) {
  return (
    <div className="button-row">
      {prijavaId ? (
        <Link className="secondary-button" href={`/api/pdv/xml?mjesec=${month}`}>
          XML izvoz
        </Link>
      ) : null}
      <button className="primary-button" form="pdv-return-form" type="submit">
        Sačuvaj nacrt
      </button>
      <button
        className="secondary-button"
        form="pdv-post-form"
        type="submit"
        disabled={!prijavaId || !canPost}
      >
        Proknjiži
      </button>
    </div>
  );
}
