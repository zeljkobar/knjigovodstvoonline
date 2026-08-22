import Link from "next/link";
import { createPortalCustomer } from "../../_actions/catalog";
import { PartnerForm } from "@/components/PartnerForm";
import { requireDirectPortalContext } from "@/lib/direct-portal";

const messages: Record<string, string> = {
  kupac_obavezno: "Naziv i ispravni poreski podaci su obavezni. Inostrani kupac mora imati ISO šifru države i poreski broj.",
  kupac_postoji: "Kupac sa tim PIB-om već postoji za firmu.",
  godina_zakljucana: "Poslovna godina je zaključana; novi kupac nije dozvoljen."
};

export default async function NewPortalCustomerPage({
  searchParams
}: {
  searchParams: Promise<{ poruka?: string }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "create" },
    "/portal/kupci/novi"
  );

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Prodajni šifarnik</p><h2>Novi kupac</h2><p className="muted-text">Kupac se kreira isključivo u scope-u firme {context.firma.naziv}.</p></div><Link className="secondary-button" href="/portal/kupci">Nazad</Link></header>
    {params.poruka ? <p className="status-banner error">{messages[params.poruka] ?? "Kupac nije sačuvan."}</p> : null}
    <section className="admin-form-section"><PartnerForm action={createPortalCustomer} buttonLabel="Sačuvaj kupca" firmaId={context.firma.id} irmsEndpoint="/api/portal/irms/search" mode="global" /></section>
  </div>;
}
