import Link from "next/link";
import { notFound } from "next/navigation";
import { updatePortalCustomer } from "../../_actions/catalog";
import { PartnerForm } from "@/components/PartnerForm";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  kupac_kreiran: "Kupac je kreiran.",
  kupac_povezan: "Postojeći globalni kupac je povezan sa firmom.",
  kupac_sacuvan: "Podaci kupca su sačuvani.",
  kupac_obavezno: "Naziv i poreski podaci nijesu ispravni.",
  kupac_postoji: "Kupac sa tim PIB-om već postoji.",
  kupac_samo_citanje: "Globalnog kupca nije moguće mijenjati iz portala.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

export default async function PortalCustomerDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ poruka?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    `/portal/kupci/${id}`
  );
  const agencijaId = context.user.agencija_id!;
  const link = await prisma.firmaKomitent.findFirst({
    where: {
      firma_id: context.firma.id,
      komitent_id: id,
      komitent: {
        OR: [
          { scope: "GLOBAL" },
          { scope: "COMPANY", firma_id: context.firma.id, agencija_id: agencijaId }
        ]
      }
    },
    include: { komitent: true }
  });

  if (!link) notFound();

  const customer = link.komitent;
  const canUpdate = customer.scope === "COMPANY" && hasDirectPortalPermission(context.permissionKeys, { modul: "robno", akcija: "update" });
  const initial = {
    ...customer,
    napomena: link.napomena,
    rok_placanja_dana: link.rok_placanja_dana,
    sifra_u_firmi: link.sifra_u_firmi,
    tip_komitenta: link.tip_komitenta
  };

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Kupci / {customer.scope === "GLOBAL" ? "Globalni registar" : "Firma"}</p><h2>{customer.naziv}</h2><p className="muted-text">{customer.is_foreign ? customer.foreign_tax_number ?? "Inostrani kupac" : customer.pib ?? "Bez PIB-a"}</p></div><Link className="secondary-button" href="/portal/kupci">Nazad</Link></header>
    {query.poruka ? <p className={query.poruka === "kupac_kreiran" || query.poruka === "kupac_povezan" || query.poruka === "kupac_sacuvan" ? "status-banner success" : "status-banner error"}>{messages[query.poruka] ?? "Akcija nije završena."}</p> : null}
    {canUpdate ? <section className="admin-form-section"><PartnerForm action={updatePortalCustomer} buttonLabel="Sačuvaj izmjene" firmaId={context.firma.id} initialValues={initial} irmsEndpoint="/api/portal/irms/search" mode="global" /></section> : <section className="admin-panel"><div className="panel-header"><h3>Podaci kupca</h3><span>Samo čitanje</span></div><dl className="detail-grid"><div><dt>Naziv</dt><dd>{customer.naziv}</dd></div><div><dt>PIB / poreski broj</dt><dd>{customer.is_foreign ? customer.foreign_tax_number ?? "-" : customer.pib ?? "-"}</dd></div><div><dt>Adresa</dt><dd>{[customer.adresa, customer.grad, customer.drzava].filter(Boolean).join(", ") || "-"}</dd></div><div><dt>Kontakt</dt><dd>{customer.email ?? customer.telefon ?? "-"}</dd></div><div><dt>Rok plaćanja</dt><dd>{link.rok_placanja_dana === null ? "-" : `${link.rok_placanja_dana} dana`}</dd></div><div><dt>Status</dt><dd>{link.aktivan && customer.aktivan ? "Aktivan" : "Neaktivan"}</dd></div></dl><p className="muted-text">Globalne podatke održava platformski administrator; portal može koristiti kupca bez preuzimanja vlasništva nad zapisom.</p></section>}
  </div>;
}
