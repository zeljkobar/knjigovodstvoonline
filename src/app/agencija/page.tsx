import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function OperationCard({
  allowed,
  count,
  eyebrow,
  href,
  label,
  tone
}: {
  allowed: boolean;
  count: number;
  eyebrow: string;
  href: string;
  label: string;
  tone: "journal" | "kif" | "kuf";
}) {
  const content = (
    <>
      <span>{eyebrow}</span>
      <strong>{allowed ? count : "—"}</strong>
      <small>{allowed ? label : "Nemate pravo pregleda ovog modula"}</small>
    </>
  );

  return allowed ? (
    <Link className={`dashboard-operation-card dashboard-operation-card--${tone}`} href={href}>
      {content}
    </Link>
  ) : (
    <div className={`dashboard-operation-card dashboard-operation-card--${tone}`}>
      {content}
    </div>
  );
}

export default async function AgencijaPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  const [brojFirmi, brojRadnika, brojKlijenata, activeCompany] = await Promise.all([
    prisma.firma.count({
      where: {
        agencija_id: user.agencija_id,
        is_deleted: false
      }
    }),
    prisma.korisnik.count({
      where: {
        agencija_id: user.agencija_id,
        rola: "korisnik_agencije",
        is_deleted: false
      }
    }),
    prisma.korisnik.count({
      where: {
        agencija_id: user.agencija_id,
        rola: "klijent",
        is_deleted: false
      }
    }),
    workContext.firmaId
      ? prisma.firma.findFirst({
          where: {
            id: workContext.firmaId,
            agencija_id: user.agencija_id,
            aktivan: true,
            is_deleted: false,
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
      : Promise.resolve(null)
  ]);

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true
          }
        })
      : null;

  const [canViewJournals, canViewCalculations, canViewKif] =
    activeCompany && activeYear
      ? await Promise.all([
          hasPermission(user, {
            firmaId: activeCompany.id,
            modul: "nalozi",
            akcija: "view"
          }),
          hasPermission(user, {
            firmaId: activeCompany.id,
            modul: "robno",
            akcija: "view"
          }),
          hasPermission(user, {
            firmaId: activeCompany.id,
            modul: "izlazni_racuni",
            akcija: "view"
          })
        ])
      : [false, false, false];

  const journalWhere: Prisma.NalogWhereInput | null = activeCompany && activeYear
    ? {
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        status: journalStatuses.draft,
        is_deleted: false
      }
    : null;
  const calculationWhere: Prisma.KalkulacijaWhereInput | null = activeCompany && activeYear
    ? {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        status: "WAITING_KUF",
        kuf_entry_id: null,
        is_deleted: false
      }
    : null;
  const invoiceWhere: Prisma.FiskalniIzlazniRacunWhereInput | null = activeCompany && activeYear
    ? {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        status: "WAITING_KIF",
        kif_status: "WAITING_KIF",
        kif_entry_id: null,
        nalog_id: { not: null },
        is_deleted: false,
        OR: [
          { fiskalizacija_rezim: "SUMMA", fiscal_status: "Fiscalized" },
          { fiskalizacija_rezim: "EXTERNAL_OR_NONE", fiscal_status: "NOT_REQUIRED" }
        ]
      }
    : null;

  const [draftJournals, draftJournalCount] =
    journalWhere && canViewJournals
      ? await Promise.all([
          prisma.nalog.findMany({
            where: journalWhere,
            orderBy: [{ datum: "desc" }, { updated_at: "desc" }],
            take: 6,
            select: {
              id: true,
              broj: true,
              sifra: true,
              datum: true,
              opis: true,
              vrsta_naloga: {
                select: {
                  naziv: true,
                  prefiks: true
                }
              }
            }
          }),
          prisma.nalog.count({ where: journalWhere })
        ])
      : [[], 0];

  const [pendingCalculations, pendingCalculationCount] =
    calculationWhere && canViewCalculations
      ? await Promise.all([
          prisma.kalkulacija.findMany({
            where: calculationWhere,
            orderBy: [{ datum_racuna_dobavljaca: "desc" }, { updated_at: "desc" }],
            take: 6,
            select: {
              id: true,
              interni_broj: true,
              broj_racuna_dobavljaca: true,
              datum_racuna_dobavljaca: true,
              ukupno_racun_sa_pdv: true,
              dobavljac: {
                select: {
                  naziv: true
                }
              }
            }
          }),
          prisma.kalkulacija.count({ where: calculationWhere })
        ])
      : [[], 0];

  const [pendingInvoices, pendingInvoiceCount] =
    invoiceWhere && canViewKif
      ? await Promise.all([
          prisma.fiskalniIzlazniRacun.findMany({
            where: invoiceWhere,
            orderBy: [{ datum_racuna: "desc" }, { updated_at: "desc" }],
            take: 6,
            select: {
              id: true,
              interni_broj: true,
              broj_racuna: true,
              datum_racuna: true,
              ukupno_sa_pdv: true,
              kupac: {
                select: {
                  naziv: true
                }
              }
            }
          }),
          prisma.fiskalniIzlazniRacun.count({ where: invoiceWhere })
        ])
      : [[], 0];

  const pendingDocuments = [
    ...pendingCalculations.map((calculation) => ({
      id: calculation.id,
      type: "Čeka KUF",
      number: calculation.interni_broj,
      sourceNumber: calculation.broj_racuna_dobavljaca,
      party: calculation.dobavljac.naziv,
      date: calculation.datum_racuna_dobavljaca,
      amount: calculation.ukupno_racun_sa_pdv,
      href: `/agencija/robno/kalkulacije/${calculation.id}`
    })),
    ...pendingInvoices.map((invoice) => ({
      id: invoice.id,
      type: "Čeka KIF",
      number: invoice.interni_broj,
      sourceNumber: invoice.broj_racuna,
      party: invoice.kupac.naziv,
      date: invoice.datum_racuna,
      amount: invoice.ukupno_sa_pdv,
      href: `/agencija/robno/izlazne-fakture/${invoice.id}`
    }))
  ]
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, 8);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Pregled agencije</h2>
        </div>
        {user.rola === "admin_agencije" ? (
          <Link className="primary-link" href="/agencija/korisnici">
            Korisnici i prava
          </Link>
        ) : null}
      </header>

      <section className="metric-grid" aria-label="Statistika agencije">
        <div className="metric">
          <span>Firmi</span>
          <strong>{brojFirmi}</strong>
        </div>
        <div className="metric">
          <span>Radnika</span>
          <strong>{brojRadnika}</strong>
        </div>
        <div className="metric">
          <span>Klijenata</span>
          <strong>{brojKlijenata}</strong>
        </div>
      </section>

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <div className="panel-header">
            <h3>Za obradu</h3>
            <span>Aktivna firma i godina</span>
          </div>
          <p className="empty-state">
            Izaberite firmu i poslovnu godinu u gornjoj traci da vidite neproknjižene naloge i
            dokumenta koja čekaju KIF/KUF.
          </p>
        </section>
      ) : (
        <>
          <section aria-label="Stavke koje čekaju obradu" className="dashboard-operation-grid">
            <OperationCard
              allowed={canViewJournals}
              count={draftJournalCount}
              eyebrow="Nalozi"
              href="/agencija/nalozi?status=DRAFT"
              label="nacrta za knjiženje"
              tone="journal"
            />
            <OperationCard
              allowed={canViewCalculations}
              count={pendingCalculationCount}
              eyebrow="KUF"
              href="/agencija/racuni/kuf"
              label="kalkulacija za prenos"
              tone="kuf"
            />
            <OperationCard
              allowed={canViewKif}
              count={pendingInvoiceCount}
              eyebrow="KIF"
              href="/agencija/racuni/kif"
              label="računa za prenos"
              tone="kif"
            />
          </section>

          <section className="dashboard-operational-panels">
            <article className="admin-panel">
              <div className="panel-header">
                <div>
                  <h3>Neproknjiženi nalozi</h3>
                  <p>{activeCompany.naziv} · {activeYear.godina}</p>
                </div>
                {canViewJournals ? (
                  <Link className="table-link" href="/agencija/nalozi?status=DRAFT">
                    Svi nacrti
                  </Link>
                ) : null}
              </div>

              {!canViewJournals ? (
                <p className="empty-state">Nemate pravo pregleda naloga za ovu firmu.</p>
              ) : draftJournals.length === 0 ? (
                <p className="empty-state">Nema neproknjiženih naloga.</p>
              ) : (
                <div className="dashboard-item-list">
                  {draftJournals.map((journal) => (
                    <Link href={`/agencija/nalozi/${journal.id}`} key={journal.id}>
                      <span>
                        <strong>
                          {journal.sifra ||
                            formatJournalCode(
                              journal.vrsta_naloga.prefiks,
                              activeYear.godina,
                              journal.broj
                            )}
                        </strong>
                        <small>{journal.opis || journal.vrsta_naloga.naziv}</small>
                      </span>
                      <time>{formatDate(journal.datum)}</time>
                    </Link>
                  ))}
                </div>
              )}
            </article>

            <article className="admin-panel">
              <div className="panel-header">
                <div>
                  <h3>Dokumenti čekaju KIF/KUF</h3>
                  <p>{pendingCalculationCount + pendingInvoiceCount} ukupno za obradu</p>
                </div>
                <Link className="table-link" href="/agencija/racuni">
                  KIF/KUF
                </Link>
              </div>

              {!canViewCalculations && !canViewKif ? (
                <p className="empty-state">Nemate pravo pregleda ovih dokumenata.</p>
              ) : pendingDocuments.length === 0 ? (
                <p className="empty-state">Nema dokumenata koji čekaju prenos u KIF ili KUF.</p>
              ) : (
                <div className="table-wrap">
                  <table className="dashboard-pending-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Dokument</th>
                        <th>Komitent</th>
                        <th>Datum</th>
                        <th>Iznos</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingDocuments.map((document) => (
                        <tr key={`${document.type}-${document.id}`}>
                          <td>
                            <span className={`status-pill ${document.type === "Čeka KIF" ? "status-pill--info" : "status-pill--warning"}`}>
                              {document.type}
                            </span>
                          </td>
                          <td>
                            <strong>{document.number}</strong>
                            <small>{document.sourceNumber}</small>
                          </td>
                          <td>{document.party}</td>
                          <td>{formatDate(document.date)}</td>
                          <td>{money(document.amount)} €</td>
                          <td>
                            <Link className="table-button" href={document.href}>
                              Otvori
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}
