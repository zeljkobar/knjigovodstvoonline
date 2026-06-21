import Link from "next/link";
import { createPartner, updatePartner } from "../actions";
import { PartnerForm } from "@/components/PartnerForm";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PartneriPageProps = {
  searchParams?: Promise<{
    partner?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  partner_sacuvan: "Dodatni partner je sacuvan.",
  partner_izmijenjen: "Dodatni partner je izmijenjen.",
  partner_obavezno: "Naziv partnera i aktivna firma su obavezni.",
  partner_dupli: "Partner sa tim PIB-om je vec dostupan.",
  partner_greska: "Partner nije sacuvan. Provjerite podatke."
};

function scopeLabel(scope: string) {
  if (scope === "AGENCY") {
    return "Agencija";
  }

  if (scope === "COMPANY") {
    return "Aktivna firma";
  }

  return "Globalni";
}

export default async function PartneriPage({ searchParams }: PartneriPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const editPartnerId = params?.partner ?? "";
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  const activeCompany = workContext.firmaId
    ? await prisma.firma.findFirst({
        where: {
          id: workContext.firmaId,
          agencija_id: user.agencija_id,
          is_deleted: false,
          aktivan: true,
          ...(user.rola === "admin_agencije"
            ? {}
            : {
                korisnici: {
                  some: {
                    korisnik_id: user.id,
                    is_deleted: false
                  }
                }
              })
        },
        select: {
          id: true,
          naziv: true,
          pib: true
        }
      })
    : null;

  const [partners, globalPartnerCount, editPartner] = activeCompany
    ? await Promise.all([
        prisma.komitent.findMany({
          where: {
            aktivan: true,
            OR: [
              {
                scope: "AGENCY",
                agencija_id: user.agencija_id
              },
              {
                scope: "COMPANY",
                firma_id: activeCompany.id
              }
            ]
          },
          orderBy: {
            naziv: "asc"
          },
          select: {
            id: true,
            scope: true,
            naziv: true,
            pib: true,
            pdv_broj: true,
            maticni_broj: true,
            adresa: true,
            grad: true,
            telefon: true,
            email: true,
            firme: {
              where: {
                firma_id: activeCompany.id
              },
              select: {
                tip_komitenta: true,
                sifra_u_firmi: true,
                rok_placanja_dana: true,
                napomena: true
              },
              take: 1
            }
          }
        }),
        prisma.komitent.count({
          where: {
            scope: "GLOBAL",
            aktivan: true
          }
        }),
        editPartnerId
          ? prisma.komitent.findFirst({
              where: {
                id: editPartnerId,
                aktivan: true,
                OR: [
                  {
                    scope: "AGENCY",
                    agencija_id: user.agencija_id
                  },
                  {
                    scope: "COMPANY",
                    firma_id: activeCompany.id
                  }
                ]
              },
              select: {
                id: true,
                scope: true,
                naziv: true,
                pib: true,
                pdv_broj: true,
                maticni_broj: true,
                adresa: true,
                grad: true,
                drzava: true,
                telefon: true,
                email: true,
                web_sajt: true,
                firme: {
                  where: {
                    firma_id: activeCompany.id
                  },
                  select: {
                    tip_komitenta: true,
                    sifra_u_firmi: true,
                    rok_placanja_dana: true,
                    napomena: true
                  },
                  take: 1
                }
              }
            })
          : null
      ])
    : [[], 0, null];

  const editSettings = editPartner?.firme[0] ?? null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Partneri</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany ? (
        <section className="admin-panel">
          <h3>Izaberite firmu</h3>
          <p className="empty-state">
            Partneri se vode za aktivnu firmu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Firma</span>
              <strong className="metric-text">{activeCompany.naziv}</strong>
              <small>{activeCompany.pib ?? "Bez PIB-a"}</small>
            </div>
            <div className="metric">
              <span>Dodatni partneri</span>
              <strong>{partners.length}</strong>
            </div>
            <div className="metric">
              <span>Globalni partneri</span>
              <strong>{globalPartnerCount}</strong>
            </div>
          </section>

          <section className="admin-form-section">
            <div className="panel-header">
              <h3>{editPartner ? "Izmjena dodatnog partnera" : "Novi dodatni partner"}</h3>
              {editPartner ? (
                <Link className="table-link" href="/agencija/nalozi/partneri">
                  Novi unos
                </Link>
              ) : null}
            </div>
            <PartnerForm
              action={editPartner ? updatePartner : createPartner}
              buttonLabel={editPartner ? "Sačuvaj izmjene" : "Sačuvaj partnera"}
              firmaId={activeCompany.id}
              initialValues={
                editPartner
                  ? {
                      ...editPartner,
                      napomena: editSettings?.napomena ?? null,
                      rok_placanja_dana: editSettings?.rok_placanja_dana ?? null,
                      sifra_u_firmi: editSettings?.sifra_u_firmi ?? null,
                      tip_komitenta: editSettings?.tip_komitenta ?? "kupac_dobavljac"
                    }
                  : undefined
              }
            />
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Dodatni partneri</h3>
              <span>{partners.length} ukupno</span>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Naziv</th>
                    <th>Vidljivost</th>
                    <th>PIB / PDV</th>
                    <th>Kontakt</th>
                    <th>Rok</th>
                    <th>Napomena</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Nema dodatnih partnera za agenciju ili aktivnu firmu.</td>
                    </tr>
                  ) : (
                    partners.map((partner) => {
                      const settings = partner.firme[0] ?? null;

                      return (
                        <tr key={partner.id}>
                          <td>
                            <strong>{partner.naziv}</strong>
                            <small>
                              {settings?.sifra_u_firmi
                                ? `Šifra: ${settings.sifra_u_firmi}`
                                : "Bez interne šifre"}
                            </small>
                          </td>
                          <td>{scopeLabel(partner.scope)}</td>
                          <td>
                            {partner.pib ?? "-"}
                            <small>{partner.pdv_broj ?? ""}</small>
                          </td>
                          <td>
                            {partner.email ?? partner.telefon ?? "-"}
                            <small>
                              {[partner.adresa, partner.grad].filter(Boolean).join(", ")}
                            </small>
                          </td>
                          <td>
                            {settings?.rok_placanja_dana !== null &&
                            settings?.rok_placanja_dana !== undefined
                              ? `${settings.rok_placanja_dana} dana`
                              : "-"}
                          </td>
                          <td>{settings?.napomena ?? "-"}</td>
                          <td>
                            <Link
                              className="table-link"
                              href={`/agencija/nalozi/partneri?partner=${partner.id}`}
                            >
                              Uredi
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
