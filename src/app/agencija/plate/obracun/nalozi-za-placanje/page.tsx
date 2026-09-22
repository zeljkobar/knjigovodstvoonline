import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../../_shared";
import { hasAllPermissions } from "@/lib/permissions";
import {
  buildPayrollPaymentOrders,
  getPayrollDocumentData
} from "@/lib/payroll-documents";
import { money, payrollStatusLabel } from "@/lib/payroll";

type PageProps = {
  searchParams?: Promise<{ obracun?: string }>;
};

function displayDate(value: Date | null) {
  return value
    ? value.toLocaleDateString("sr-Latn-ME", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      })
    : "Nije unesen";
}

export default async function PayrollPaymentOrdersPage({ searchParams }: PageProps) {
  const context = await getPlateContext("view");
  const params = await searchParams;

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="Virmani / nalozi za plaćanje" />;
  }

  if (!context.allowed || !params?.obracun) {
    return (
      <section className="admin-panel">
        <p className="empty-state">
          {!context.allowed
            ? "Nemate pravo za pregled naloga za plaćanje."
            : "Izaberite obračun plata."}
        </p>
      </section>
    );
  }

  const data = await getPayrollDocumentData({
    agencijaId: context.user.agencija_id,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.godina.id,
    obracunId: params.obracun
  });

  if (!data) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Obračun nije pronađen u aktivnom kontekstu.</p>
      </section>
    );
  }

  const canExport = await hasAllPermissions(context.user, [
    { firmaId: context.firma.id, modul: "plate", akcija: "view" },
    { firmaId: context.firma.id, modul: "plate", akcija: "export" }
  ]);
  const paymentOrders = await buildPayrollPaymentOrders(data);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Plate / Obračun / Dokumenti</p>
          <h2>Virmani / nalozi za plaćanje</h2>
          <p>
            Obračun {data.obracun.broj} / {data.obracun.godina} · {data.firma.naziv}
          </p>
        </div>
        <div className="button-row">
          {canExport && data.isPrintable && paymentOrders.readyOrders.length > 0 ? (
            <Link
              className="primary-button"
              href={`/stampa/plate/virmani?obracun=${data.obracun.id}`}
              target="_blank"
            >
              Štampaj ispravne naloge
            </Link>
          ) : null}
          <Link
            className="secondary-button"
            href={`/agencija/plate/obracun?obracun=${data.obracun.id}`}
          >
            Nazad na obračun
          </Link>
        </div>
      </header>

      {!data.isPrintable ? (
        <p className="admin-message">Obračun prvo mora biti obrađen.</p>
      ) : null}

      <section className="stats-grid">
        <div className="stat-card">
          <span>Status obračuna</span>
          <strong>{payrollStatusLabel(data.obracun.status)}</strong>
        </div>
        <div className="stat-card">
          <span>Datum naloga</span>
          <strong>{displayDate(data.obracun.datum_isplate ?? data.obracun.datum_obracuna)}</strong>
        </div>
        <div className="stat-card">
          <span>Spremni nalozi</span>
          <strong>{paymentOrders.readyOrders.length}</strong>
        </div>
        <div className="stat-card">
          <span>Za dopunu</span>
          <strong>{paymentOrders.invalidOrders.length}</strong>
        </div>
      </section>

      {data.isPreview ? (
        <p className="admin-message">
          Obračun još nije proknjižen ili zaključan. Odštampani nalozi imaju oznaku NACRT.
        </p>
      ) : null}

      {!data.obracun.datum_isplate ? (
        <p className="admin-message">
          Datum isplate nije posebno unesen, pa se kao datum naloga koristi datum obračuna.
        </p>
      ) : null}

      <p className="compact-note">
        Neto zarada se priprema po radniku. Porez, PIO, nezaposlenost i Fond rada
        sabiraju se na zbirni račun 820-30000-74, dok se prirez priprema odvojeno po
        opštini. Sindikat i Privredna komora imaju zasebne zbirne naloge kada postoji
        obračunati iznos.
      </p>

      {paymentOrders.cashWorkers.length > 0 ? (
        <section className="admin-panel">
          <h3>Isplata gotovinom</h3>
          <p className="compact-note">
            Za ove radnike se ne pravi virman: {paymentOrders.cashWorkers.join(", ")}.
          </p>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Pregled naloga</h3>
            <span>Štampaju se samo redovi bez otvorenih grešaka.</span>
          </div>
          <strong>{paymentOrders.orders.length} ukupno</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vrsta</th>
                <th>Primalac</th>
                <th>Račun primaoca</th>
                <th>Svrha</th>
                <th>Iznos</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {paymentOrders.orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.typeLabel}</td>
                  <td>{order.recipientName}</td>
                  <td>{order.recipientAccount ?? "—"}</td>
                  <td>{order.purpose}</td>
                  <td>{money(order.amountCent)}</td>
                  <td>
                    {order.errors.length === 0 ? (
                      <span className="status-pill status-pill--success">Spremno</span>
                    ) : (
                      <div className="control-issues">
                        {order.errors.map((error) => (
                          <small key={error}>{error}</small>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {paymentOrders.orders.length === 0 ? (
                <tr>
                  <td colSpan={6}>Obračun nema iznose za naloge plaćanja.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
