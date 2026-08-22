import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";

const reportViewPermission = { modul: "izvjestaji", akcija: "view" };
const reportExportPermission = { modul: "izvjestaji", akcija: "export" };

const reports = [
  {
    href: "/portal/izvjestaji/promet",
    title: "Promet",
    description:
      "Neto promet, računi i storna, poreska rekapitulacija, kanali i kase."
  },
  {
    href: "/portal/izvjestaji/artikli",
    title: "Artikli i usluge",
    description:
      "Neto količina i prodajna vrijednost po artiklu, usluzi i grupi."
  },
  {
    href: "/portal/izvjestaji/placanja",
    title: "Načini plaćanja",
    description:
      "Gotovina, kartice, virman i ostala plaćanja za OFFICE i POS prodaju."
  }
];

export default async function DirectPortalReportsPage() {
  const context = await requireDirectPortalContext(
    reportViewPermission,
    "/portal/izvjestaji"
  );
  const canExport = hasDirectPortalPermission(
    context.permissionKeys,
    reportExportPermission
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Direktni fiskalni portal</p>
          <h2>Izvještaji prodaje</h2>
          <p className="muted-text">
            OFFICE i POS promet za {context.year.godina}. godinu, sa
            korektivnim dokumentima uključenim kao umanjenje.
          </p>
        </div>
      </header>

      <section className="portal-report-grid" aria-label="Vrste izvještaja">
        {reports.map((report) => (
          <Link className="portal-report-card" key={report.href} href={report.href}>
            <span className="portal-report-card-label">Izvještaj</span>
            <strong>{report.title}</strong>
            <small>{report.description}</small>
            <span aria-hidden="true" className="portal-report-card-arrow">→</span>
          </Link>
        ))}
      </section>

      <section className="admin-panel portal-report-rules">
        <h3>Pravila podataka</h3>
        <p className="muted-text">
          U izvještaje ulaze samo fiskalno potvrđeni dokumenti ove firme i
          aktivne poslovne godine. Original ostaje pozitivan, a povezani storno
          dokument ulazi negativno, pa zbir prikazuje stvarni neto promet.
        </p>
        <p className="muted-text">
          {canExport
            ? "Vaš nalog ima pravo CSV izvoza i A4 štampe izvještaja."
            : "Pregled je dostupan, dok CSV izvoz i A4 štampa zahtijevaju posebno pravo izvoza."}
        </p>
      </section>
    </div>
  );
}
