import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { loadPayrollDocumentForPrint } from "@/lib/payroll-document-access";
import {
  buildPayrollPaymentOrders,
  type PayrollPaymentOrder
} from "@/lib/payroll-documents";
import { money } from "@/lib/payroll";

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
    : "—";
}

function PaymentOrder({
  order,
  isPreview
}: {
  order: PayrollPaymentOrder;
  isPreview: boolean;
}) {
  return (
    <section className="payroll-payment-order-document">
      {isPreview ? <div className="payroll-print-watermark">NACRT</div> : null}
      <header className="payroll-payment-order-title">
        <div>
          <span>Vrsta naloga</span>
          <strong>{order.typeLabel}</strong>
        </div>
        <h1>NALOG ZA PRENOS</h1>
      </header>

      <div className="payroll-payment-order-grid">
        <p className="payroll-payment-order-wide">
          <span>Nalogodavac</span>
          <strong>{order.payerName}</strong>
        </p>
        <p className="payroll-payment-order-wide">
          <span>Svrha plaćanja</span>
          <strong>{order.purpose}</strong>
        </p>
        <p className="payroll-payment-order-wide">
          <span>Primalac</span>
          <strong>{order.recipientName}</strong>
        </p>
        <p>
          <span>Račun nalogodavca</span>
          <strong>{order.payerAccount}</strong>
        </p>
        <p>
          <span>Šifra plaćanja</span>
          <strong>{order.paymentCode ?? "—"}</strong>
        </p>
        <p>
          <span>Iznos</span>
          <strong>EUR {money(order.amountCent)}</strong>
        </p>
        <p>
          <span>Račun primaoca</span>
          <strong>{order.recipientAccount}</strong>
        </p>
        <p>
          <span>Poziv na broj zaduženja</span>
          <strong>{order.debitReference ?? "—"}</strong>
        </p>
        <p>
          <span>Poziv na broj odobrenja</span>
          <strong>{order.creditReference ?? "—"}</strong>
        </p>
        <p>
          <span>Datum izvršenja</span>
          <strong>{displayDate(order.paymentDate)}</strong>
        </p>
        <p>
          <span>Mjesto</span>
          <strong>{order.municipality ?? "—"}</strong>
        </p>
      </div>

      <footer className="payroll-payment-order-signatures">
        <p><i></i><span>Pečat i potpis nalogodavca</span></p>
        <p><i></i><span>Datum prijema</span></p>
        <p><i></i><span>Potpis ovlašćenog lica banke</span></p>
      </footer>
    </section>
  );
}

export default async function PayrollPaymentOrdersPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const result = await loadPayrollDocumentForPrint(params?.obracun);

  if (!result.data) {
    return (
      <main className="print-page">
        <section className="payroll-payment-order-document"><p>{result.error}</p></section>
      </main>
    );
  }

  const paymentOrders = await buildPayrollPaymentOrders(result.data);

  if (paymentOrders.readyOrders.length === 0) {
    return (
      <main className="print-page">
        <div className="print-toolbar">
          <Link
            className="print-button print-back-button"
            href={`/agencija/plate/obracun/nalozi-za-placanje?obracun=${result.data.obracun.id}`}
          >
            Nazad na pregled
          </Link>
        </div>
        <section className="payroll-payment-order-document">
          <h1>Nema naloga spremnih za štampu</h1>
          <p>Na pregledu naloga dopunite podatke koji nedostaju.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="print-page payroll-payment-orders-print-page">
      <div className="print-toolbar">
        <Link
          className="print-button print-back-button"
          href={`/agencija/plate/obracun/nalozi-za-placanje?obracun=${result.data.obracun.id}`}
        >
          Nazad na pregled
        </Link>
        {paymentOrders.invalidOrders.length > 0 ? (
          <span className="payroll-payment-order-omitted">
            Preskočeno: {paymentOrders.invalidOrders.length}
          </span>
        ) : null}
        <PrintButton label="Štampaj naloge" />
      </div>

      {paymentOrders.readyOrders.map((order) => (
        <PaymentOrder order={order} isPreview={result.data!.isPreview} key={order.id} />
      ))}
    </main>
  );
}
