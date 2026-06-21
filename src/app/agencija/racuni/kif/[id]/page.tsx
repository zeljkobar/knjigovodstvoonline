import Link from "next/link";
import { createKifEntry } from "../../actions";
import { KifTaxLinesForm } from "@/components/KifTaxLinesForm";
import {
  invoicePostingAccountSources,
  invoicePostingFields,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KifBookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kif_knjiga_sacuvana: "KIF knjiga je otvorena.",
  kif_sacuvan: "Račun je dodat u KIF.",
  kif_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kif_obavezno: "Kupac, broj računa, datum računa i ukupan iznos su obavezni.",
  kif_konto_obavezan: "Konto prihoda je obavezno jer šema koristi konto iz unosa računa.",
  kif_iznosi: "Provjerite osnovice i PDV iznose.",
  kif_ukupno: "Ukupno računa se ne slaže sa zbirom osnovica i PDV-a.",
  kif_konto: "Konto prihoda mora biti aktivno analitičko konto.",
  kif_knjiga: "KIF knjiga nije otvorena za unos.",
  kif_greska: "Račun nije dodat u KIF. Provjerite podatke."
};

const mjeseci = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function decimalText(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  return numeric.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export default async function KifBookPage({ params, searchParams }: KifBookPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const query = await searchParams;
  const message = query?.poruka ? poruke[query.poruka] : null;
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <p className="admin-message">Izaberite firmu i godinu u gornjoj traci.</p>
      </div>
    );
  }

  const activeCompany = await prisma.firma.findFirst({
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
      pdv_obveznik: true
    }
  });

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

  if (!activeCompany || !activeYear) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KIF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const [kifBook, partners, vatRates, baseAccounts, companyOverrides] = await Promise.all([
    prisma.kifBook.findFirst({
      where: {
        id,
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false
      },
      select: {
        id: true,
        internal_kif_number: true,
        mjesec: true,
        kif_date: true,
        status: true,
        racun_vrsta: {
          select: {
            naziv: true,
            dokument_tip: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              select: {
                polje_sifra: true,
                konto_izvor: true,
                sifra_konta: true
              }
            }
          }
        },
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "desc"
          },
          select: {
            id: true,
            internal_kif_number: true,
            customer_invoice_number: true,
            invoice_date: true,
            total_base: true,
            total_output_vat: true,
            total_gross: true,
            status: true,
            posting_status: true,
            revenue_account: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            kupac: {
              select: {
                naziv: true,
                pib: true
              }
            },
            tax_lines: {
              orderBy: {
                vat_rate_percent: "desc"
              },
              select: {
                id: true,
                vat_rate_percent: true,
                tax_base: true,
                output_vat_amount: true
              }
            }
          }
        }
      }
    }),
    prisma.komitent.findMany({
      where: {
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
      orderBy: {
        naziv: "asc"
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
        aktivna: true
      },
      orderBy: [
        {
          procenat: "desc"
        },
        {
          redosljed: "asc"
        }
      ],
      select: {
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    }),
    prisma.konto.findMany({
      where: {
        aktivan: true
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
        firma_id: activeCompany.id
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
    })
  ]);

  if (!kifBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KIF knjiga nije pronađena.</p>
      </div>
    );
  }

  const isLocked = activeYear.zakljucena || kifBook.status !== "OPEN";
  const revenueAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides)
    .filter(
      (account) =>
        account.aktivan && account.tip_konta === "analiticko" && account.sifra.startsWith("6")
    )
    .sort((a, b) => a.sifra.localeCompare(b.sifra));
  const fields = invoicePostingFields(kifBook.racun_vrsta.dokument_tip, vatRates);
  const ruleByField = new Map(
    kifBook.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
  );
  const baseFields = fields.filter(
    (field) => field.code.startsWith("OSNOVICA_") || field.code.startsWith("OSLOBODJENO_")
  );
  const revenueAccountRequired = baseFields.some((field) => {
    const rule = ruleByField.get(field.code);

    return (rule?.konto_izvor ?? field.accountSource) === invoicePostingAccountSources.inputExpense;
  });
  const fixedRevenueAccounts = Array.from(
    new Set(
      baseFields
        .map((field) => ruleByField.get(field.code))
        .filter((rule) => rule?.konto_izvor === invoicePostingAccountSources.fixed)
        .map((rule) => rule?.sifra_konta)
        .filter((code): code is string => Boolean(code))
    )
  );
  const defaultRevenueAccount = revenueAccountRequired ? "" : fixedRevenueAccounts[0] ?? "";
  const totals = kifBook.entries.reduce(
    (sum, entry) => ({
      base: sum.base + Number(entry.total_base.toString()),
      vat: sum.vat + Number(entry.total_output_vat.toString()),
      gross: sum.gross + Number(entry.total_gross.toString())
    }),
    {
      base: 0,
      vat: 0,
      gross: 0
    }
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kifBook.internal_kif_number}</h2>
          <p>
            {mjeseci[kifBook.mjesec - 1] ?? kifBook.mjesec} {activeYear.godina} · datum KIF-a{" "}
            {displayDate(kifBook.kif_date)} · {kifBook.racun_vrsta.naziv}
          </p>
        </div>
        <Link className="secondary-button" href="/agencija/racuni/kif">
          Novi KIF
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kifBook.entries.length}</strong>
          <small>{kifBook.status}</small>
        </div>
        <div className="metric">
          <span>Osnovica</span>
          <strong>{decimalText(totals.base)}</strong>
          <small>zbir poreskih osnovica</small>
        </div>
        <div className="metric">
          <span>PDV / Ukupno</span>
          <strong>{decimalText(totals.vat)} / {decimalText(totals.gross)}</strong>
          <small>izlazni PDV i bruto iznos</small>
        </div>
      </section>

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>Unos izlaznog računa</h3>
          <span>
            {revenueAccountRequired
              ? "Konto prihoda je obavezno po šemi"
              : "Konto prihoda je preuzet iz šeme ako je podešen"}
          </span>
        </div>

        {vatRates.length === 0 ? (
          <p className="admin-message">
            Nema aktivnih PDV stopa. Prvo ih podesite u podešavanjima.
          </p>
        ) : null}

        <form id="kif-entry-form" className="admin-form kuf-entry-form" action={createKifEntry}>
          <input name="kif_book_id" type="hidden" value={kifBook.id} />
          <label>
            <span>Kupac</span>
            <select name="kupac_id" required disabled={isLocked} autoFocus>
              <option value="">Izaberite kupca</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.naziv}
                  {partner.pib ? ` (${partner.pib})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Broj izlaznog računa</span>
            <input name="customer_invoice_number" required disabled={isLocked} />
          </label>
          <label>
            <span>Datum računa</span>
            <input name="invoice_date" type="date" defaultValue={inputDate()} required disabled={isLocked} />
          </label>
          <label>
            <span>Datum dospijeća</span>
            <input name="due_date" type="date" disabled={isLocked} />
          </label>
          <label>
            <span>Konto prihoda/osnovice</span>
            <select
              name="revenue_account_code"
              defaultValue={defaultRevenueAccount}
              required={revenueAccountRequired}
              disabled={isLocked}
            >
              <option value="">-</option>
              {revenueAccounts.map((account) => (
                <option key={`${account.source}-${account.id}`} value={account.sifra}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
          <label className="form-wide">
            <span>Napomena</span>
            <input name="note" placeholder="Opis ili interna napomena" disabled={isLocked} />
          </label>

          <KifTaxLinesForm
            disabled={isLocked}
            rates={vatRates.map((rate) => ({
              id: rate.id,
              naziv: rate.naziv,
              procenat: rate.procenat.toString()
            }))}
          />

          <button type="submit" disabled={isLocked || vatRates.length === 0}>
            Unesi u KIF
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Računi u KIF knjizi</h3>
          <span>{kifBook.entries.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>KIF broj</th>
                <th>Kupac</th>
                <th>Račun</th>
                <th>Konto prihoda</th>
                <th>Datum</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {kifBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={10}>Nema unesenih računa u ovoj KIF knjizi.</td>
                </tr>
              ) : (
                kifBook.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kif_number}</strong>
                    </td>
                    <td>
                      {entry.kupac.naziv}
                      <small>{entry.kupac.pib ?? "-"}</small>
                    </td>
                    <td>{entry.customer_invoice_number}</td>
                    <td>
                      {entry.revenue_account
                        ? `${entry.revenue_account.sifra} - ${entry.revenue_account.naziv}`
                        : "Iz šeme"}
                    </td>
                    <td>{displayDate(entry.invoice_date)}</td>
                    <td>{decimalText(entry.total_base)}</td>
                    <td>{decimalText(entry.total_output_vat)}</td>
                    <td>{decimalText(entry.total_gross)}</td>
                    <td>
                      {entry.tax_lines.map((line) => (
                        <small key={line.id}>
                          {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                          {decimalText(line.output_vat_amount)}
                        </small>
                      ))}
                    </td>
                    <td>
                      {entry.status}
                      <small>{entry.posting_status}</small>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
