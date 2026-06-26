import Link from "next/link";
import { createGlobalPartner, updateGlobalPartner } from "../actions";
import { ImportPartnersButton } from "@/components/ImportPartnersButton";
import { Pagination } from "@/components/Pagination";
import { PartnerForm } from "@/components/PartnerForm";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

type GlobalniPartneriPageProps = {
  searchParams?: Promise<{
    partner?: string;
    poruka?: string;
    stranica?: string;
  }>;
};

const poruke: Record<string, string> = {
  partner_sacuvan: "Globalni partner je sacuvan.",
  partner_izmijenjen: "Globalni partner je izmijenjen.",
  partner_obavezno: "Naziv partnera je obavezan.",
  partner_dupli: "Globalni partner sa tim PIB-om vec postoji.",
  partner_greska: "Globalni partner nije sacuvan. Provjerite PIB ili podatke.",
};

export default async function GlobalniPartneriPage({
  searchParams,
}: GlobalniPartneriPageProps) {
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const editPartnerId = params?.partner ?? "";
  const currentPage = Math.max(1, parseInt(params?.stranica ?? "1"));
  const skip = (currentPage - 1) * PAGE_SIZE;

  const where = { scope: "GLOBAL" as const, aktivan: true };

  const [partneri, ukupno, editPartner] = await Promise.all([
    prisma.komitent.findMany({
      where,
      orderBy: {
        naziv: "asc",
      },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        naziv: true,
        pib: true,
        pdv_broj: true,
        maticni_broj: true,
        pravna_forma: true,
        sifra_djelatnosti: true,
        adresa: true,
        grad: true,
        telefon: true,
        email: true,
        web_sajt: true,
        drzava: true,
        is_foreign: true,
        country_code: true,
        country_name: true,
        foreign_tax_number: true,
      },
    }),
    prisma.komitent.count({ where }),
    editPartnerId
      ? prisma.komitent.findFirst({
          where: {
            id: editPartnerId,
            scope: "GLOBAL",
            aktivan: true,
          },
          select: {
            id: true,
            naziv: true,
            pib: true,
            pdv_broj: true,
            maticni_broj: true,
            pravna_forma: true,
            sifra_djelatnosti: true,
            datum_registracije: true,
            adresa: true,
            grad: true,
            drzava: true,
            telefon: true,
            email: true,
            web_sajt: true,
            is_foreign: true,
            country_code: true,
            country_name: true,
            foreign_tax_number: true,
          },
        })
      : null,
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Sistem</p>
          <h2>Globalni partneri</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>
            {editPartner
              ? "Izmjena globalnog partnera"
              : "Novi globalni partner"}
          </h3>
          {editPartner ? (
            <Link className="table-link" href="/admin/globalni-partneri">
              Novi unos
            </Link>
          ) : null}
        </div>
        <PartnerForm
          action={editPartner ? updateGlobalPartner : createGlobalPartner}
          buttonLabel={editPartner ? "Sačuvaj izmjene" : "Sačuvaj partnera"}
          initialValues={editPartner ?? undefined}
          mode="global"
        />
      </section>

      <section className="admin-panel">
        <ImportPartnersButton />
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled globalnih partnera</h3>
          <span>{ukupno} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Naziv</th>
                <th>PIB / PDV</th>
                <th>Matični broj</th>
                <th>Pravna forma</th>
                <th>Šifra dj.</th>
                <th>Kontakt</th>
                <th>Adresa</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {partneri.length === 0 ? (
                <tr>
                  <td colSpan={8}>Nema globalnih partnera.</td>
                </tr>
              ) : (
                partneri.map((partner) => (
                  <tr key={partner.id}>
                    <td>
                      <strong>{partner.naziv}</strong>
                    </td>
                    <td>
                      {partner.pib ?? "-"}
                      <small>{partner.pdv_broj ?? ""}</small>
                    </td>
                    <td>{partner.maticni_broj ?? "-"}</td>
                    <td>{partner.pravna_forma ?? "-"}</td>
                    <td>{partner.sifra_djelatnosti ?? "-"}</td>
                    <td>{partner.email ?? partner.telefon ?? "-"}</td>
                    <td>
                      {[partner.adresa, partner.grad]
                        .filter(Boolean)
                        .join(", ") || "-"}
                    </td>
                    <td>
                      <Link
                        className="table-link"
                        href={`/admin/globalni-partneri?partner=${partner.id}`}
                      >
                        Uredi
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          pageSize={PAGE_SIZE}
          searchParams={params ?? {}}
          total={ukupno}
        />
      </section>
    </div>
  );
}
