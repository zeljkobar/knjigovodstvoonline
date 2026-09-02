import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { PartnerFilterSelect } from "@/components/PartnerFilterSelect";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type AnalitickeKarticePageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    konto?: string;
    konto_q?: string;
    konto_prefix?: string;
    partner?: string;
    partner_q?: string;
    prikaz?: string;
    sva_konta?: string;
    jedinica?: string;
  }>;
};

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

function parseBusinessUnitFilter(value?: string) {
  if (value === "NONE") return value;
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "ALL";
}

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn");
}

export default async function AnalitickeKarticePage({
  searchParams
}: AnalitickeKarticePageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const variant =
    params?.prikaz === "account"
      ? "account"
      : params?.prikaz === "partner"
        ? "partner"
        : "combined";
  const title =
    variant === "account"
      ? "Kartice konta"
      : variant === "partner"
        ? "Kartice partnera"
        : "Analitičke kartice";
  const basePath =
    variant === "account"
      ? "/agencija/izvjestaji/kartice-konta"
      : variant === "partner"
        ? "/agencija/izvjestaji/kartice-partnera"
        : "/agencija/nalozi/analiticke-kartice";
  const selectedAccount = params?.konto ?? "";
  const accountQuery = params?.konto_q?.trim() ?? "";
  const selectedAccountPrefix = params?.konto_prefix?.trim() ?? "";
  const selectedPartner = params?.partner ?? "";
  const selectedPartnerQuery = params?.partner_q?.trim() ?? "";
  const showAllAccounts = variant === "account" && params?.sva_konta === "1";
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);
  const selectedBusinessUnit = parseBusinessUnitFilter(params?.jedinica);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h1>{title}</h1>
          </div>
        </header>
        <section className="admin-card">
          <p className="muted">Izaberite firmu i poslovnu godinu u gornjem izboru.</p>
        </section>
      </div>
    );
  }

  const [firma, godina, accounts, businessUnits] = await Promise.all([
    prisma.firma.findFirst({
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
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: workContext.firmaId,
        aktivan: true,
        ...(variant === "account" ? {} : { tip_konta: "analiticko" as const }),
        ...(variant === "account" && showAllAccounts
          ? {}
          : {
              stavke_naloga: {
                some: {
                  ...(selectedBusinessUnit !== "ALL"
                    ? { poslovna_jedinica_id: selectedBusinessUnit === "NONE" ? null : selectedBusinessUnit }
                    : {}),
                  nalog: {
                    firma_id: workContext.firmaId,
                    poslovna_godina_id: workContext.poslovnaGodinaId,
                    status: journalStatuses.posted,
                    is_deleted: false,
                  }
                }
              }
            }),
        ...(variant === "account" && accountQuery
          ? {
              OR: [
                {
                  sifra: {
                    contains: accountQuery,
                    mode: "insensitive" as const
                  }
                },
                {
                  naziv: {
                    contains: accountQuery,
                    mode: "insensitive" as const
                  }
                }
              ]
            }
          : {})
      },
      orderBy: {
        sifra: "asc"
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    }),
    prisma.poslovnaJedinica.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        is_deleted: false
      },
      select: { id: true, sifra: true, naziv: true, aktivna: true },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }]
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const selectedPartnerRecord =
    selectedPartner && selectedPartner !== "ALL"
      ? await prisma.komitent.findUnique({
          where: { id: selectedPartner },
          select: { naziv: true, pib: true }
        })
      : null;

  const selectedAccountRecord =
    selectedAccount && selectedAccount !== "ALL"
      ? await prisma.firmaKonto.findFirst({
          where: {
            id: selectedAccount,
            firma_id: workContext.firmaId,
            aktivan: true
          },
          select: {
            id: true,
            sifra: true,
            naziv: true
          }
        })
      : null;

  const selectedPartnerLabel = selectedPartnerRecord
    ? `${selectedPartnerRecord.naziv}${
        selectedPartnerRecord.pib ? ` (${selectedPartnerRecord.pib})` : ""
      }`
    : selectedPartnerQuery;

  const partnerQueryDigits = selectedPartnerQuery.replace(/\D/g, "");

  const where: Prisma.StavkaNalogaWhereInput = {
    ...(selectedBusinessUnit !== "ALL"
      ? { poslovna_jedinica_id: selectedBusinessUnit === "NONE" ? null : selectedBusinessUnit }
      : {}),
    nalog: {
      firma_id: workContext.firmaId,
      poslovna_godina_id: workContext.poslovnaGodinaId,
      status: "POSTED",
      is_deleted: false,
      ...(dateFrom || dateTo
        ? {
            datum: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    },
    ...(selectedAccount && selectedAccount !== "ALL"
      ? {
          konto_id: selectedAccount
        }
      : selectedAccountPrefix
        ? {
            firma_konto: {
              sifra: {
                startsWith: selectedAccountPrefix
              }
            }
          }
      : {}),
    ...(selectedPartner && selectedPartner !== "ALL"
      ? {
          komitent_id: selectedPartner
        }
      : selectedPartnerQuery.length >= 2
        ? {
            komitent: {
              OR: [
                {
                  naziv: {
                    contains: selectedPartnerQuery,
                    mode: "insensitive"
                  }
                },
                ...(partnerQueryDigits
                  ? [
                      {
                        pib: {
                          contains: partnerQueryDigits
                        }
                      }
                    ]
                  : [])
              ]
            }
          }
      : {})
  };

  const shouldLoadLines =
    variant === "account"
      ? Boolean(selectedAccount || selectedAccountPrefix)
      : Boolean(
          selectedAccount ||
            selectedAccountPrefix ||
            selectedPartner ||
            selectedPartnerQuery ||
            dateFrom ||
            dateTo ||
            selectedBusinessUnit !== "ALL"
        );

  const lines = shouldLoadLines
      ? await prisma.stavkaNaloga.findMany({
          where,
          orderBy: [
            {
              nalog: {
                datum: "asc"
              }
            },
            {
              nalog: {
                created_at: "asc"
              }
            },
            {
              redni_broj: "asc"
            }
          ],
          select: {
            id: true,
            duguje: true,
            potrazuje: true,
            opis: true,
            redni_broj: true,
            firma_konto: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            komitent: {
              select: {
                naziv: true,
                pib: true
              }
            },
            nalog: {
              select: {
                id: true,
                sifra: true,
                broj: true,
                datum: true,
                opis: true,
                poslovna_godina: {
                  select: {
                    godina: true
                  }
                },
                vrsta_naloga: {
                  select: {
                    naziv: true,
                    prefiks: true
                  }
                }
              }
            }
          }
        })
      : [];

  let runningBalance = 0;
  const rows = lines.map((line) => {
    const debit = Number(line.duguje);
    const credit = Number(line.potrazuje);
    runningBalance += debit - credit;

    return {
      ...line,
      credit,
      debit,
      runningBalance
    };
  });
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  const totalBalance = totalDebit - totalCredit;

  function accountHref(accountId?: string, overrides?: { showAll?: boolean }) {
    const query = new URLSearchParams();
    const nextShowAll = overrides?.showAll ?? showAllAccounts;

    if (accountId) query.set("konto", accountId);
    if (accountQuery) query.set("konto_q", accountQuery);
    if (selectedPartner && selectedPartner !== "ALL") query.set("partner", selectedPartner);
    if (selectedPartnerQuery) query.set("partner_q", selectedPartnerQuery);
    if (params?.datum_od) query.set("datum_od", params.datum_od);
    if (params?.datum_do) query.set("datum_do", params.datum_do);
    if (selectedBusinessUnit !== "ALL") query.set("jedinica", selectedBusinessUnit);
    if (nextShowAll) query.set("sva_konta", "1");

    const serialized = query.toString();
    return serialized ? `${basePath}?${serialized}` : basePath;
  }

  function accountPrintHref() {
    const query = new URLSearchParams({ konto: selectedAccount });

    if (selectedPartner && selectedPartner !== "ALL") query.set("partner", selectedPartner);
    if (selectedPartnerQuery) query.set("partner_q", selectedPartnerQuery);
    if (params?.datum_od) query.set("datum_od", params.datum_od);
    if (params?.datum_do) query.set("datum_do", params.datum_do);
    if (selectedBusinessUnit !== "ALL") query.set("jedinica", selectedBusinessUnit);

    return `/stampa/kartica-konta?${query.toString()}`;
  }

  const filterPanel = (
    <section className="admin-card account-card-filter-panel">
      <div className="card-header">
        <h2>Filteri kartice</h2>
        <span>{rows.length} stavki</span>
      </div>
      <AutoSubmitFilterForm
        action={basePath}
        className={`admin-form journal-filter-form${
          variant === "account" ? " account-card-filter-form" : ""
        }`}
      >
        {variant === "account" ? (
          <>
            {selectedAccount ? <input name="konto" type="hidden" value={selectedAccount} /> : null}
            {accountQuery ? <input name="konto_q" type="hidden" value={accountQuery} /> : null}
            {showAllAccounts ? <input name="sva_konta" type="hidden" value="1" /> : null}
          </>
        ) : (
          <label>
            <span>Konto</span>
            <select name="konto" defaultValue={selectedAccount || "ALL"}>
              <option value="ALL">Sva konta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedAccountPrefix ? (
          <input name="konto_prefix" type="hidden" value={selectedAccountPrefix} />
        ) : null}
        <label>
          <span>Partner</span>
          <PartnerFilterSelect
            initialId={selectedPartner}
            initialLabel={selectedPartnerLabel}
            name="partner"
          />
        </label>
        <label>
          <span>Datum od</span>
          <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
        </label>
        <label>
          <span>Datum do</span>
          <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
        </label>
        <label>
          <span>Poslovna jedinica</span>
          <select name="jedinica" defaultValue={selectedBusinessUnit}>
            <option value="ALL">Sve jedinice</option>
            <option value="NONE">Bez poslovne jedinice</option>
            {businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.sifra} - {unit.naziv}{unit.aktivna ? "" : " (neaktivna)"}</option>
            ))}
          </select>
        </label>
      </AutoSubmitFilterForm>
    </section>
  );

  const cardPanel = (
    <section className="admin-card account-card-table-panel">
      <div className="card-header">
        <div>
          <h2>
            {variant === "account"
              ? selectedAccountRecord
                ? `${selectedAccountRecord.sifra} — ${selectedAccountRecord.naziv}`
                : selectedAccountPrefix
                  ? `Grupa konta ${selectedAccountPrefix}`
                  : "Kartica konta"
              : variant === "partner"
                ? "Kartica partnera"
                : "Kartica"}
          </h2>
          {variant === "account" && selectedAccountRecord ? (
            <p className="account-card-selected-caption">Proknjiženi promet izabrane poslovne godine</p>
          ) : null}
        </div>
        <div className="account-card-header-actions">
          <span>
            Duguje {money(totalDebit)} · Potražuje {money(totalCredit)}
          </span>
          {variant === "account" && selectedAccountRecord ? (
            <Link
              className="secondary-button account-card-print-link"
              href={accountPrintHref()}
              target="_blank"
            >
              Štampa kartice
            </Link>
          ) : null}
        </div>
      </div>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Nalog</th>
              <th>Konto</th>
              <th>Partner</th>
              <th>Opis</th>
              <th>Duguje</th>
              <th>Potražuje</th>
              <th>Saldo</th>
              <th>Akcija</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const journalCode =
                row.nalog.sifra ||
                formatJournalCode(
                  row.nalog.vrsta_naloga.prefiks,
                  row.nalog.poslovna_godina.godina,
                  row.nalog.broj
                );

              return (
                <tr key={row.id}>
                  <td>{formatDate(row.nalog.datum)}</td>
                  <td>
                    <strong>{journalCode}</strong>
                    <small>{row.nalog.vrsta_naloga.naziv}</small>
                  </td>
                  <td>
                    {row.firma_konto.sifra}
                    <small>{row.firma_konto.naziv}</small>
                  </td>
                  <td>
                    {row.komitent?.naziv ?? "-"}
                    <small>{row.komitent?.pib ?? ""}</small>
                  </td>
                  <td>{row.opis || row.nalog.opis || "-"}</td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>{money(row.runningBalance)}</td>
                  <td>
                    <Link className="table-link" href={`/agencija/nalozi/${row.nalog.id}`}>
                      Otvori
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  {variant === "account" && !selectedAccount && !selectedAccountPrefix
                    ? "Izaberite konto sa spiska da otvorite njegovu karticu."
                    : "Nema proknjiženih stavki za izabrane uslove."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>{title}</h1>
        </div>
      </header>

      <section className="stats-grid account-card-summary">
        <article className="stat-card">
          <span>Firma</span>
          <strong>{firma.naziv}</strong>
        </article>
        <article className="stat-card">
          <span>Godina</span>
          <strong>{godina.godina}</strong>
        </article>
        <article className="stat-card">
          <span>Saldo</span>
          <strong>{money(totalBalance)}</strong>
        </article>
      </section>

      {variant === "account" ? (
        <section className="account-card-workspace">
          <aside
            className={`admin-card account-card-sidebar${
              selectedAccount || selectedAccountPrefix
                ? " account-card-sidebar--mobile-hidden"
                : ""
            }`}
          >
            <div className="account-card-sidebar-header">
              <div>
                <h2>Konta</h2>
                <span>{accounts.length} prikazano</span>
              </div>
              <Link
                className="account-card-list-toggle"
                href={accountHref(selectedAccount || undefined, {
                  showAll: !showAllAccounts
                })}
              >
                {showAllAccounts ? "Samo sa prometom" : "Prikaži sva"}
              </Link>
            </div>

            <AutoSubmitFilterForm
              action={basePath}
              className="account-card-search-form"
              debounceMs={250}
            >
              {selectedAccount ? <input name="konto" type="hidden" value={selectedAccount} /> : null}
              {selectedPartner ? <input name="partner" type="hidden" value={selectedPartner} /> : null}
              {selectedPartnerQuery ? (
                <input name="partner_q" type="hidden" value={selectedPartnerQuery} />
              ) : null}
              {params?.datum_od ? <input name="datum_od" type="hidden" value={params.datum_od} /> : null}
              {params?.datum_do ? <input name="datum_do" type="hidden" value={params.datum_do} /> : null}
              {selectedBusinessUnit !== "ALL" ? <input name="jedinica" type="hidden" value={selectedBusinessUnit} /> : null}
              {showAllAccounts ? <input name="sva_konta" type="hidden" value="1" /> : null}
              <label>
                <span>Pretraga</span>
                <input
                  defaultValue={accountQuery}
                  name="konto_q"
                  placeholder="Broj ili naziv konta"
                  type="search"
                />
              </label>
            </AutoSubmitFilterForm>

            <nav aria-label="Spisak konta" className="account-card-account-list">
              {accounts.map((account) => (
                <Link
                  aria-current={selectedAccount === account.id ? "page" : undefined}
                  className={selectedAccount === account.id ? "active" : undefined}
                  href={accountHref(account.id)}
                  key={account.id}
                >
                  <strong>{account.sifra}</strong>
                  <span>{account.naziv}</span>
                </Link>
              ))}
              {accounts.length === 0 ? (
                <p className="account-card-list-empty">
                  Nema konta za izabranu pretragu.
                </p>
              ) : null}
            </nav>
          </aside>

          <div
            className={`account-card-detail${
              selectedAccount || selectedAccountPrefix
                ? ""
                : " account-card-detail--mobile-hidden"
            }`}
          >
            <Link className="account-card-mobile-back" href={accountHref()}>
              ← Nazad na konta
            </Link>
            {filterPanel}
            {cardPanel}
          </div>
        </section>
      ) : (
        <>
          {filterPanel}
          {cardPanel}
        </>
      )}
    </div>
  );
}
