import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { Pagination } from "@/components/Pagination";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatusLabel, journalStatuses } from "@/lib/journals";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { deleteJournal, postJournal } from "./actions";

const PAGE_SIZE = 50;

type NaloziPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    poruka?: string;
    q?: string;
    status?: string;
    stranica?: string;
    vrsta?: string;
  }>;
};

const poruke: Record<string, string> = {
  nalog_obrisan: "Nalog je obrisan.",
  nalog_kalkulacija: "Nalog kalkulacije se ne briše odvojeno od robnog dokumenta.",
  nalog_greska: "Nalog nije pronađen ili akcija nije dozvoljena.",
  nalog_proknjizen: "Nalog je proknjižen.",
  prava: "Nemate pravo za ovu akciju nad nalozima."
};

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn");
}

function money(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseDateFilter(value?: string) {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

export default async function NaloziPage({ searchParams }: NaloziPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const workContext = await readWorkContext();
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);
  const query = params?.q?.trim() ?? "";
  const statusFilter = params?.status ?? "";
  const typeFilter = params?.vrsta ?? "";
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentPage = Math.max(1, parseInt(params?.stranica ?? "1"));
  const skip = (currentPage - 1) * PAGE_SIZE;

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
          naziv: true
        }
      })
    : null;

  const [canView, canCreate, canPost, canDelete] = activeCompany
    ? await Promise.all([
        hasPermission(user, { firmaId: activeCompany.id, modul: "nalozi", akcija: "view" }),
        hasPermission(user, { firmaId: activeCompany.id, modul: "nalozi", akcija: "create" }),
        hasPermission(user, { firmaId: activeCompany.id, modul: "nalozi", akcija: "post" }),
        hasPermission(user, { firmaId: activeCompany.id, modul: "nalozi", akcija: "delete" })
      ])
    : [false, false, false, false];

  if (activeCompany && !canView) {
    redirect("/agencija?greska=prava");
  }

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true,
            zakljucena: true
          }
        })
      : null;

  const journalTypes =
    activeCompany && activeYear
      ? await prisma.vrstaNaloga.findMany({
          where: {
            aktivan: true,
            OR: [
              {
                sistemska: true
              },
              {
                agencija_id: user.agencija_id
              },
              {
                firma_id: activeCompany.id
              }
            ]
          },
          orderBy: {
            naziv: "asc"
          },
          select: {
            id: true,
            naziv: true,
            prefiks: true
          }
        })
      : [];

  const journalWhere: Prisma.NalogWhereInput =
    activeCompany && activeYear
      ? {
          firma_id: activeCompany.id,
          poslovna_godina_id: activeYear.id,
          is_deleted: false,
          ...(statusFilter && statusFilter !== "ALL"
            ? {
                status: statusFilter
              }
            : {}),
          ...(typeFilter && typeFilter !== "ALL"
            ? {
                vrsta_naloga_id: typeFilter
              }
            : {}),
          ...(dateFrom || dateTo
            ? {
                datum: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {})
                }
              }
            : {}),
          ...(query
            ? {
                OR: [
                  {
                    sifra: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    opis: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    vrsta_naloga: {
                      naziv: {
                        contains: query,
                        mode: "insensitive"
                      }
                    }
                  }
                ]
              }
            : {})
        }
      : {};

  const [nalozi, ukupnoNaloga, sumePrometa] =
    activeCompany && activeYear
      ? await Promise.all([
          prisma.nalog.findMany({
            where: journalWhere,
            orderBy: [
              {
                datum: "desc"
              },
              {
                created_at: "desc"
              }
            ],
            take: PAGE_SIZE,
            skip,
            select: {
              id: true,
              sifra: true,
              broj: true,
              datum: true,
              opis: true,
              status: true,
              vrsta_naloga: {
                select: {
                  naziv: true,
                  prefiks: true
                }
              },
              poslovna_godina: {
                select: {
                  godina: true
                }
              },
              stavke: {
                select: {
                  duguje: true,
                  potrazuje: true
                }
              }
            }
          }),
          prisma.nalog.count({ where: journalWhere }),
          prisma.stavkaNaloga.aggregate({
            where: { nalog: journalWhere },
            _sum: { duguje: true, potrazuje: true }
          })
        ])
      : [[], 0, null];

  const totals = {
    duguje: Number(sumePrometa?._sum?.duguje ?? 0),
    potrazuje: Number(sumePrometa?._sum?.potrazuje ?? 0)
  };

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Nalozi za knjiženje</h2>
        </div>
        {activeCompany && activeYear && !activeYear.zakljucena && canCreate ? (
          <Link className="primary-link" href="/agencija/nalozi/novi">
            Novi nalog
          </Link>
        ) : null}
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i poslovnu godinu</h3>
          <p className="empty-state">
            Nalozi se prikazuju za aktivnu firmu i godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Firma</span>
              <strong className="metric-text">{activeCompany.naziv}</strong>
            </div>
            <div className="metric">
              <span>Godina</span>
              <strong>{activeYear.godina}</strong>
            </div>
            <div className="metric">
              <span>Promet naloga</span>
              <strong className="metric-text">
                {money(totals.duguje)} / {money(totals.potrazuje)}
              </strong>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Pregled naloga</h3>
              <AutoSubmitFilterForm
                action="/agencija/nalozi"
                className="compact-form journal-filter-form"
              >
                <label>
                  <span>Pretraga</span>
                  <input
                    defaultValue={query}
                    name="q"
                    placeholder="Broj, opis ili vrsta"
                    type="search"
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select name="status" defaultValue={statusFilter || "ALL"}>
                    <option value="ALL">Svi aktivni</option>
                    <option value={journalStatuses.draft}>Nacrti</option>
                    <option value={journalStatuses.posted}>Proknjiženi</option>
                  </select>
                </label>
                <label>
                  <span>Vrsta</span>
                  <select name="vrsta" defaultValue={typeFilter || "ALL"}>
                    <option value="ALL">Sve vrste</option>
                    {journalTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.naziv} {type.prefiks ? `(${type.prefiks})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Datum od</span>
                  <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
                </label>
                <label>
                  <span>Datum do</span>
                  <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
                </label>
                <Link className="table-link" href="/agencija/nalozi">
                  Poništi
                </Link>
              </AutoSubmitFilterForm>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Broj</th>
                    <th>Datum</th>
                    <th>Vrsta</th>
                    <th>Opis</th>
                    <th>Status</th>
                    <th>Duguje</th>
                    <th>Potražuje</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {nalozi.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Nema naloga za izabranu firmu i godinu.</td>
                    </tr>
                  ) : (
                    nalozi.map((nalog) => {
                      const duguje = nalog.stavke.reduce(
                        (sum, line) => sum + Number(line.duguje),
                        0
                      );
                      const potrazuje = nalog.stavke.reduce(
                        (sum, line) => sum + Number(line.potrazuje),
                        0
                      );
                      const code =
                        nalog.sifra ||
                        formatJournalCode(
                          nalog.vrsta_naloga.prefiks,
                          nalog.poslovna_godina.godina,
                          nalog.broj
                        );

                      return (
                        <tr key={nalog.id}>
                          <td>
                            <strong>{code}</strong>
                          </td>
                          <td>{formatDate(nalog.datum)}</td>
                          <td>{nalog.vrsta_naloga.naziv}</td>
                          <td>{nalog.opis ?? "-"}</td>
                          <td>{journalStatusLabel(nalog.status)}</td>
                          <td>{money(duguje)}</td>
                          <td>{money(potrazuje)}</td>
                          <td>
                            <div className="table-actions">
                              <Link className="table-link" href={`/agencija/nalozi/${nalog.id}`}>
                                Otvori
                              </Link>
                              {nalog.status === journalStatuses.draft && !activeYear.zakljucena ? (
                                <>
                                  {canPost ? (
                                    <form action={postJournal}>
                                      <input name="nalog_id" type="hidden" value={nalog.id} />
                                      <input name="return_to" type="hidden" value="drafts" />
                                      <button className="table-button" type="submit">
                                        Proknjiži
                                      </button>
                                    </form>
                                  ) : null}
                                  {canDelete ? (
                                    <form action={deleteJournal}>
                                      <input name="nalog_id" type="hidden" value={nalog.id} />
                                      <input name="return_to" type="hidden" value="drafts" />
                                      <input
                                        name="delete_reason"
                                        type="hidden"
                                        value="Trajno brisanje nacrta iz pregleda naloga"
                                      />
                                      <button
                                        className="table-button table-button-danger"
                                        type="submit"
                                      >
                                        Izbriši
                                      </button>
                                    </form>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={currentPage}
              pageSize={PAGE_SIZE}
              searchParams={params ?? {}}
              total={ukupnoNaloga}
            />
          </section>
        </>
      )}
    </div>
  );
}
