import { getPlateContext, MissingPlateContext } from "../../_shared";
import { PayrollPaymentOrdersEditor } from "@/components/PayrollPaymentOrdersEditor";
import { hasAllPermissions } from "@/lib/permissions";
import {
  buildPayrollPaymentOrders,
  getPayrollDocumentData
} from "@/lib/payroll-documents";
import { serializePayrollPaymentOrder } from "@/lib/payroll-payment-order-print";
import { payrollStatusLabel } from "@/lib/payroll";

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
        opštini. Privredna komora i sindikat imaju zasebne zbirne naloge kada postoji
        obračunati iznos. Štampa je prilagođena obrascu sa tri virmana na A4 strani.
      </p>

      {paymentOrders.cashWorkers.length > 0 ? (
        <section className="admin-panel">
          <h3>Isplata gotovinom</h3>
          <p className="compact-note">
            Za ove radnike se ne pravi virman: {paymentOrders.cashWorkers.join(", ")}.
          </p>
        </section>
      ) : null}

      <PayrollPaymentOrdersEditor
        backUrl={`/agencija/plate/obracun?obracun=${data.obracun.id}`}
        calculationId={data.obracun.id}
        canEdit={canExport && data.isPrintable}
        initialOrders={paymentOrders.orders.map(serializePayrollPaymentOrder)}
        printUrl={`/stampa/plate/virmani?obracun=${data.obracun.id}`}
      />
    </div>
  );
}
