import Link from "next/link";
import { saveGlobalPartnerForAgency } from "./agency-actions";
import { PartnerStatusForm } from "./PartnerStatusForm";
import type { Prisma } from "@prisma/client";
import { createPartner, updatePartner } from "../actions";
import { PartnerForm } from "@/components/PartnerForm";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PartneriPageProps = {
  searchParams?: Promise<{
    partner?: string;
    poruka?: string;
    q?: string;
    scope?: string;
    porijeklo?: string;
    status?: string;
    page?: string;
  }>;
};

const poruke: Record<string, string> = {
  partner_sacuvan: "Dodatni partner je sacuvan.",
  partner_izmijenjen: "Dodatni partner je izmijenjen.",
  partner_obavezno: "Naziv partnera i aktivna firma su obavezni.",
  partner_dupli: "Partner sa tim PIB-om je vec dostupan.",
  partner_greska: "Partner nije sacuvan. Provjerite podatke.",
  partner_obrisan: "Partner je uklonjen iz aktivnog izbora. Dokumenti su sačuvani; možete ga vratiti kroz filter Obrisani.",
  partner_agencijski: "Izmjene su sačuvane samo za vašu agenciju. Partner zadržava postojeće veze sa dokumentima.",
  partner_verzija: "Partner je u međuvremenu izmijenjen. Osvježite obrazac i ponovite izmjenu.",
  partner_vracen: "Partner je vraćen u aktivni izbor.",
  prava: "Nemate pravo za ovu akciju nad partnerima."
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
  const query = (params?.q ?? "").trim().slice(0, 150);
  const scope = ["GLOBAL", "AGENCY", "COMPANY"].includes(params?.scope ?? "") ? params!.scope! : "ALL";
  const origin = ["domaci", "ino"].includes(params?.porijeklo ?? "") ? params!.porijeklo! : "ALL";
  const status = params?.status === "obrisani" ? "obrisani" : "aktivni";
  const requestedPage = Number(params?.page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const pageSize = 50;
  function pageUrl(nextPage: number, partnerId?: string) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (scope !== "ALL") search.set("scope", scope);
    if (origin !== "ALL") search.set("porijeklo", origin);
    if (status === "obrisani") search.set("status", status);
    search.set("page", String(nextPage));
    if (partnerId) search.set("partner", partnerId);
    return `/agencija/nalozi/partneri?${search}${partnerId ? "#partner-form" : ""}`;
  }
  const workContext = await readWorkContext();

  if (workContext.firmaId) {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "nalozi",
      akcija: "view"
    });
  }

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

  const partnerWhere: Prisma.KomitentWhereInput = {
    aktivan: status === "aktivni",
    AND: [
      { OR: [
        { scope: "GLOBAL", aktivan: true },
        { scope: "AGENCY", agencija_id: user.agencija_id },
        { scope: "COMPANY", agencija_id: user.agencija_id, firma_id: activeCompany?.id ?? "" }
      ] },
      ...(scope === "AGENCY" ? [{ OR: [
        { scope: "AGENCY" as const },
        { scope: "GLOBAL" as const, agencijske_izmjene: { some: { agencija_id: user.agencija_id } } }
      ] }] : scope === "GLOBAL" ? [{ scope: "GLOBAL" as const, agencijske_izmjene: { none: { agencija_id: user.agencija_id } } }]
        : scope === "COMPANY" ? [{ scope: "COMPANY" as const }] : []),
      ...(origin !== "ALL" ? [{ is_foreign: origin === "ino" }] : []),
      ...(query ? [{ OR: [
        { naziv: { contains: query, mode: "insensitive" as const } },
        { pib: { contains: query } },
        { pdv_broj: { contains: query, mode: "insensitive" as const } },
        { grad: { contains: query, mode: "insensitive" as const } },
        { firme: { some: { firma_id: activeCompany?.id ?? "", sifra_u_firmi: { contains: query, mode: "insensitive" as const } } } }
      ] }] : [])
    ]
  };
  const [partners, globalPartnerCount, editPartner, filteredCount] = activeCompany
    ? await Promise.all([
        prisma.komitent.findMany({
          where: partnerWhere,
          orderBy: [{ naziv: "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            scope: true,
            agencijske_izmjene: { where: { agencija_id: user.agencija_id }, select: { verzija: true }, take: 1 },
            aktivan: true,
            naziv: true,
            pib: true,
            pdv_broj: true,
            maticni_broj: true,
            adresa: true,
            grad: true,
            drzava: true,
            is_foreign: true,
            country_code: true,
            country_name: true,
            foreign_tax_number: true,
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
                    scope: "GLOBAL"
                  },
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
                agencijske_izmjene: { where: { agencija_id: user.agencija_id }, select: { verzija: true }, take: 1 },
                pravna_forma: true,
                sifra_djelatnosti: true,
                datum_registracije: true,
                naziv: true,
                pib: true,
                pdv_broj: true,
                maticni_broj: true,
                adresa: true,
                grad: true,
                drzava: true,
                is_foreign: true,
                country_code: true,
                country_name: true,
                foreign_tax_number: true,
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
          : null,
        prisma.komitent.count({ where: partnerWhere })
      ])
    : [[], 0, null, 0];

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
              <span>Pronađeni partneri</span>
              <strong>{filteredCount}</strong>
            </div>
            <div className="metric">
              <span>Globalni partneri</span>
              <strong>{globalPartnerCount}</strong>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Pregled partnera</h3>
              <span>{filteredCount} ukupno · strana {page} od {Math.max(1, Math.ceil(filteredCount / pageSize))}</span>
            </div>

            <form method="get" className="admin-form partner-list-filters">
              <label>
                <span>Pretraga partnera</span>
                <input name="q" defaultValue={query} placeholder="Naziv, PIB, PDV broj, grad ili šifra u firmi" />
              </label>
              <label>
                <span>Vidljivost</span>
                <select name="scope" defaultValue={scope}>
                  <option value="ALL">Svi dostupni partneri</option>
                  <option value="GLOBAL">Globalni partneri</option>
                  <option value="AGENCY">Partneri agencije</option>
                  <option value="COMPANY">Partneri aktivne firme</option>
                </select>
              </label>
              <label>
                <span>Porijeklo</span>
                <select name="porijeklo" defaultValue={origin}>
                  <option value="ALL">Domaći i ino</option>
                  <option value="domaci">Domaći partneri</option>
                  <option value="ino">Ino partneri</option>
                </select>
              </label>
              <label>
                <span>Status partnera</span>
                <select name="status" defaultValue={status}>
                  <option value="aktivni">Aktivni</option>
                  <option value="obrisani">Obrisani — moguće vraćanje</option>
                </select>
              </label>
              <div className="admin-actions">
                <button type="submit">Pretraži</button>
                <Link className="table-link" href="/agencija/nalozi/partneri">Poništi filtere</Link>
                <Link className="table-link" href="#partner-form">Novi partner</Link>
              </div>
            </form>
            <p className="empty-state">Globalnog partnera možete prilagoditi svojoj agenciji. Izmjene će se koristiti samo u vašoj agenciji; postojeće veze sa dokumentima ostaju iste.</p>
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
                      <td colSpan={7}>Nema partnera koji odgovaraju izabranoj pretrazi i filterima.</td>
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
                          <td>{partner.scope === "GLOBAL" && partner.agencijske_izmjene.length ? "Agencija — prilagođen" : scopeLabel(partner.scope)}</td>
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
                            {partner.scope === "GLOBAL" ? (
                              <Link className="table-link" href={pageUrl(page, partner.id)}>
                                {partner.agencijske_izmjene.length ? "Uredi za agenciju" : "Uredi za moju agenciju"}
                              </Link>
                            ) : (
                              <div className="partner-row-actions">
                                {partner.aktivan ? <Link className="table-link" href={pageUrl(page, partner.id)}>Uredi</Link> : null}
                                <PartnerStatusForm
                                  firmaId={activeCompany.id} partnerId={partner.id}
                                  name={partner.naziv} active={partner.aktivan}
                                  filters={{ q: query, scope, porijeklo: origin, status, page: String(page) }}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <nav className="admin-actions" aria-label="Stranice partnera">
              {page > 1 ? <Link className="table-link" href={pageUrl(page - 1)}>Prethodna</Link> : null}
              <span>Prikazano {partners.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredCount)} od {filteredCount}</span>
              {page * pageSize < filteredCount ? <Link className="table-link" href={pageUrl(page + 1)}>Sljedeća</Link> : null}
            </nav>
          </section>

          <section className="admin-form-section" id="partner-form">
            <div className="panel-header">
              <h3>{editPartner?.scope === "GLOBAL" ? "Izmjena partnera za moju agenciju" : editPartner ? "Izmjena dodatnog partnera" : "Novi dodatni partner"}</h3>
              {editPartner ? (
                <Link className="table-link" href="/agencija/nalozi/partneri">
                  Novi unos
                </Link>
              ) : null}
            </div>
            <PartnerForm
              key={editPartner?.id ?? "new"}
              action={editPartner?.scope === "GLOBAL" ? saveGlobalPartnerForAgency : editPartner ? updatePartner : createPartner}
              agencyOverride={editPartner?.scope === "GLOBAL"}
              overrideVersion={editPartner?.agencijske_izmjene[0]?.verzija ?? 0}
              buttonLabel={editPartner?.scope === "GLOBAL" ? "Sačuvaj za moju agenciju" : editPartner ? "Sačuvaj izmjene" : "Sačuvaj partnera"}
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
        </>
      )}
    </div>
  );
}
