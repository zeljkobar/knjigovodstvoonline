import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteJournal,
  postJournal,
  reopenJournal,
  updateDraftJournalLines
} from "../actions";
import { JournalEntryForm } from "@/components/JournalEntryForm";
import {
  JournalLinesEditor,
  type JournalLineInitialValue
} from "@/components/JournalLinesEditor";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatusLabel, journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";

type NalogDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    detalj?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  nalog_kreiran: "Nalog je sacuvan kao nacrt.",
  nalog_proknjizen: "Nalog je proknjizen.",
  nalog_nacrt: "Nalog je vracen u nacrt.",
  stavke_sacuvane: "Stavke naloga su sacuvane.",
  nalog_nije_balansiran: "Nalog nije izbalansiran i ne moze biti proknjizen.",
  godina_zakljucena: "Poslovna godina je zakljucena.",
  nalog_greska: "Akcija nije dozvoljena.",
  stavke_obavezne: "Nalog mora imati bar jednu stavku.",
  stavke_nevalidne: "Provjerite konta i iznose na stavkama.",
  stavka_iznos: "Jedna stavka mora imati samo duguje ili samo potrazuje.",
  konto_nevalidno: "Konto ne postoji ili je deaktivirano za firmu.",
  partner_obavezan: "Za analiticko konto morate izabrati partnera."
};

function formatDate(date: Date | null) {
  return date ? date.toLocaleDateString("sr-Latn") : "-";
}

function money(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export default async function NalogDetailPage({
  params,
  searchParams
}: NalogDetailPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const query = await searchParams;
  const message =
    query?.poruka === "partner_obavezan" && query.detalj
      ? `Analitika za konto ${query.detalj} je obavezna.`
      : query?.poruka
        ? poruke[query.poruka]
        : null;

  if (!user.agencija_id) {
    return null;
  }

  const nalog = await prisma.nalog.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            }
          })
    },
    select: {
      id: true,
      firma_id: true,
      sifra: true,
      broj: true,
      datum: true,
      datum_knjizenja: true,
      opis: true,
      status: true,
      created_at: true,
      proknjizen_at: true,
      firma: {
        select: {
          naziv: true,
          pib: true
        }
      },
      poslovna_godina: {
        select: {
          godina: true,
          zakljucena: true
        }
      },
      vrsta_naloga: {
        select: {
          naziv: true,
          prefiks: true
        }
      },
      kreirao_korisnik: {
        select: {
          korisnicko_ime: true
        }
      },
      stavke: {
        orderBy: {
          redni_broj: "asc"
        },
        select: {
          id: true,
          redni_broj: true,
          duguje: true,
          potrazuje: true,
          opis: true,
          firma_konto: {
            select: {
              sifra: true,
              naziv: true
            }
          },
          komitent: {
            select: {
              id: true,
              naziv: true,
              pib: true
            }
          }
        }
      }
    }
  });

  if (!nalog) {
    notFound();
  }

  const totalDebit = nalog.stavke.reduce(
    (sum, line) => sum + Number(line.duguje),
    0
  );
  const totalCredit = nalog.stavke.reduce(
    (sum, line) => sum + Number(line.potrazuje),
    0
  );
  const balanced = Math.round(totalDebit * 100) === Math.round(totalCredit * 100);
  const code =
    nalog.sifra ||
    formatJournalCode(nalog.vrsta_naloga.prefiks, nalog.poslovna_godina.godina, nalog.broj);
  const [baseAccounts, companyOverrides, partners] =
    nalog.status === journalStatuses.draft && !nalog.poslovna_godina.zakljucena
      ? await Promise.all([
          prisma.konto.findMany({
            where: {
              aktivan: true,
              tip_konta: "analiticko"
            },
            orderBy: {
              sifra: "asc"
            },
            select: {
              id: true,
              sifra: true,
              naziv: true,
              klasa: true,
              tip_konta: true,
              analitika_obavezna: true,
              sinteticki_konto: true,
              normalni_saldo: true,
              koristi_radnu_jedinicu: true,
              aktivan: true
            }
          }),
          prisma.firmaKonto.findMany({
            where: {
              firma_id: nalog.firma_id
            },
            orderBy: {
              sifra: "asc"
            },
            select: {
              id: true,
              konto_id: true,
              sifra: true,
              naziv: true,
              tip_konta: true,
              analitika_obavezna: true,
              sinteticki_konto: true,
              normalni_saldo: true,
              koristi_radnu_jedinicu: true,
              override_type: true,
              napomena: true,
              aktivan: true
            }
          }),
          prisma.firmaKomitent.findMany({
            where: {
              firma_id: nalog.firma_id,
              aktivan: true
            },
            orderBy: {
              komitent: {
                naziv: "asc"
              }
            },
            select: {
              komitent: {
                select: {
                  id: true,
                  naziv: true,
                  pib: true
                }
              }
            }
          })
        ])
      : [[], [], []];
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const requiredAnalyticsAccounts = accounts
    .filter((account) => account.analitika_obavezna)
    .map((account) => account.sifra);
  const initialLines: JournalLineInitialValue[] = nalog.stavke.map((stavka) => ({
    accountCode: stavka.firma_konto.sifra,
    credit: Number(stavka.potrazuje) > 0 ? Number(stavka.potrazuje).toFixed(2) : "",
    debit: Number(stavka.duguje) > 0 ? Number(stavka.duguje).toFixed(2) : "",
    description: stavka.opis ?? "",
    partnerId: stavka.komitent?.id ?? ""
  }));

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Nalog</p>
          <h2>{code}</h2>
        </div>
        <Link className="table-link" href="/agencija/nalozi">
          Pregled naloga
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="metric-grid">
        <div className="metric">
          <span>Status</span>
          <strong className="metric-text">{journalStatusLabel(nalog.status)}</strong>
        </div>
        <div className="metric">
          <span>Duguje</span>
          <strong className="metric-text">{money(totalDebit)}</strong>
        </div>
        <div className="metric">
          <span>Potražuje</span>
          <strong className="metric-text">{money(totalCredit)}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Zaglavlje</h3>
          <span>{balanced ? "Izbalansiran" : "Nije izbalansiran"}</span>
        </div>
        <div className="journal-detail-grid">
          <div>
            <span>Firma</span>
            <strong>{nalog.firma.naziv}</strong>
            <small>{nalog.firma.pib ?? "Bez PIB-a"}</small>
          </div>
          <div>
            <span>Godina</span>
            <strong>{nalog.poslovna_godina.godina}</strong>
            <small>{nalog.poslovna_godina.zakljucena ? "Zakljucena" : "Otvorena"}</small>
          </div>
          <div>
            <span>Vrsta</span>
            <strong>{nalog.vrsta_naloga.naziv}</strong>
            <small>{nalog.vrsta_naloga.prefiks ?? "-"}</small>
          </div>
          <div>
            <span>Datum</span>
            <strong>{formatDate(nalog.datum)}</strong>
            <small>Knjiženje: {formatDate(nalog.datum_knjizenja)}</small>
          </div>
          <div>
            <span>Kreirao</span>
            <strong>{nalog.kreirao_korisnik?.korisnicko_ime ?? "-"}</strong>
            <small>{formatDate(nalog.created_at)}</small>
          </div>
          <div>
            <span>Opis</span>
            <strong>{nalog.opis ?? "-"}</strong>
            <small>Proknjižen: {formatDate(nalog.proknjizen_at)}</small>
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Stavke naloga</h3>
          <span>{nalog.stavke.length} stavki</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Konto</th>
                <th>Partner</th>
                <th>Opis</th>
                <th>Duguje</th>
                <th>Potražuje</th>
              </tr>
            </thead>
            <tbody>
              {nalog.stavke.map((stavka) => (
                <tr key={stavka.id}>
                  <td>{stavka.redni_broj}</td>
                  <td>
                    <strong>{stavka.firma_konto.sifra}</strong>
                    <small>{stavka.firma_konto.naziv}</small>
                  </td>
                  <td>
                    {stavka.komitent?.naziv ?? "-"}
                    <small>{stavka.komitent?.pib ?? ""}</small>
                  </td>
                  <td>{stavka.opis ?? "-"}</td>
                  <td>{money(Number(stavka.duguje))}</td>
                  <td>{money(Number(stavka.potrazuje))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {nalog.status === journalStatuses.draft && !nalog.poslovna_godina.zakljucena ? (
        <section className="admin-panel">
          <div className="panel-header">
            <h3>Izmijeni stavke</h3>
            <span>Dodajte redove i sačuvajte nacrt</span>
          </div>
          <JournalEntryForm
            action={updateDraftJournalLines}
            requiredAnalyticsAccounts={requiredAnalyticsAccounts}
          >
            <input name="nalog_id" type="hidden" value={nalog.id} />
            <JournalLinesEditor
              accounts={accounts}
              datalistId="konto-options"
              initialLines={initialLines}
              partners={partners.map(({ komitent }) => komitent)}
            />
            <div className="journal-actions">
              <button type="submit">Sačuvaj stavke</button>
            </div>
          </JournalEntryForm>
        </section>
      ) : null}

      {!nalog.poslovna_godina.zakljucena ? (
        <section className="admin-panel">
          <div className="panel-header">
            <h3>Akcije</h3>
            <span>Zaključana godina blokira izmjene</span>
          </div>
          <div className="journal-actions">
            {nalog.status === journalStatuses.draft ? (
              <form action={postJournal}>
                <input name="nalog_id" type="hidden" value={nalog.id} />
                <button type="submit">Proknjiži nalog</button>
              </form>
            ) : null}
            {nalog.status === journalStatuses.posted ? (
              <form action={reopenJournal}>
                <input name="nalog_id" type="hidden" value={nalog.id} />
                <button className="secondary-button" type="submit">
                  Vrati u nacrt
                </button>
              </form>
            ) : null}
            <form action={deleteJournal} className="journal-delete-form">
              <input name="nalog_id" type="hidden" value={nalog.id} />
              <input
                name="delete_reason"
                placeholder="Razlog brisanja"
                type="text"
              />
              <button className="table-button" type="submit">
                Obriši
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}
