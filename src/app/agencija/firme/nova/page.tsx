import Link from "next/link";
import { createCompany } from "../../actions";
import { CompanyForm } from "@/components/CompanyForm";
import { requireRole } from "@/lib/auth";

type NovaFirmaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  firma_obavezno: "Naziv firme je obavezan.",
  firma_greska: "Firma nije sacuvana. Provjerite podatke.",
  tip_nevalidan: "Tip subjekta nije validan.",
  agencija_nedostaje: "Korisnik nije povezan sa agencijom."
};

export default async function NovaFirmaPage({ searchParams }: NovaFirmaPageProps) {
  await requireRole("admin_agencije");
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentYear = new Date().getFullYear();

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Modul 2</p>
          <h2>Dodaj firmu</h2>
        </div>
        <Link className="primary-link" href="/agencija/firme">
          Lista firmi
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>Nova firma</h3>
        <CompanyForm action={createCompany} currentYear={currentYear} />
      </section>
    </div>
  );
}
