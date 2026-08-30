import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../../plate/_shared";

const payrollReports = [
  {
    href: "/agencija/plate/obracun",
    code: "OBR",
    title: "Obračuni plata",
    description:
      "Pregled obračuna po periodu, radnicima, statusu, netu, brutu, porezima i doprinosima."
  },
  {
    href: "/agencija/plate/obrasci/m4",
    code: "M-4",
    title: "Godišnja evidencija osiguranja",
    description:
      "Pojedinačni M-4 obrazac, Tabela 1, Tabela 2 i potvrđene mjesečne uplate."
  },
  {
    href: "/agencija/plate/obrasci/opp-nd",
    code: "OPP-ND",
    title: "Mjesečna prijava prireza",
    description:
      "Obračun prireza po vrsti poreza i važećoj opštinskoj stopi firme."
  },
  {
    href: "/agencija/plate/obrasci/ioppd",
    code: "IOPPD",
    title: "Porezi i doprinosi",
    description:
      "Mjesečni pregled, službena HTML/CSS štampa i XML za prijavu."
  }
];

export default async function ReportsPayrollPage() {
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina) {
    return <MissingPlateContext title="Plate izvještaji" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled izvještaja plata.</p>
      </section>
    );
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Izvještaji / Plate</p>
          <h2>Plate izvještaji</h2>
          <p>
            {context.firma.naziv} / {context.godina.godina}
          </p>
        </div>
      </header>

      <section className="payroll-forms-grid">
        {payrollReports.map((report) => (
          <Link className="payroll-form-card" href={report.href} key={report.href}>
            <span>{report.code}</span>
            <div>
              <h3>{report.title}</h3>
              <p>{report.description}</p>
            </div>
            <strong>Otvori izvještaj →</strong>
          </Link>
        ))}
      </section>
    </div>
  );
}
