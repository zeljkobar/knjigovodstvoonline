import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../_shared";

const forms = [
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
      "Obračun prireza porezu na dohodak fizičkih lica po vrsti poreza i opštinskoj stopi."
  },
  {
    href: "/agencija/plate/obrasci/ioppd",
    code: "IOPPD",
    title: "Porezi i doprinosi",
    description:
      "Mjesečni pregled, službena HTML/CSS štampa i XML za prijavu."
  }
];

export default async function PayrollFormsPage() {
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina) {
    return <MissingPlateContext title="Obrasci plata" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled obrazaca plata.</p>
      </section>
    );
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Obrasci plata</h2>
          <p>
            {context.firma.naziv} / {context.godina.godina}
          </p>
        </div>
      </header>

      <section className="payroll-forms-grid">
        {forms.map((form) => (
          <Link className="payroll-form-card" href={form.href} key={form.href}>
            <span>{form.code}</span>
            <div>
              <h3>{form.title}</h3>
              <p>{form.description}</p>
            </div>
            <strong>Otvori obrazac →</strong>
          </Link>
        ))}
      </section>
    </div>
  );
}
