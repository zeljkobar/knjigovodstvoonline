import Link from "next/link";
import {
  createKufEntry,
  deleteKufEntry,
  importCalculationsToKuf,
  postInvoiceBook,
  updateKufEntry
} from "../../actions";
import { FiskalniLinkInput } from "@/components/FiskalniLinkInput";
import { FiskalniUcitajButton } from "@/components/FiskalniUcitajButton";
import { InvoiceQrUpload } from "@/components/InvoiceQrUpload";
import { KufEntryFormShortcuts } from "@/components/KufEntryFormShortcuts";
import { KufTaxLinesForm } from "@/components/KufTaxLinesForm";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { VatTransactionFields } from "@/components/VatTransactionFields";
import { VatTransactionTypeSelect } from "@/components/VatTransactionTypeSelect";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { prisma } from "@/lib/prisma";
import { vatTransactionLabels } from "@/lib/vat-transaction";
import { readWorkContext } from "@/lib/work-context";

type KufBookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    edit?: string;
    poruka?: string;
    detalj?: string;
  }>;
};

const poruke: Record<string, string> = {
  kuf_knjiga_sacuvana: "KUF knjiga je otvorena.",
  kuf_sacuvan: "Račun je dodat u KUF.",
  kuf_izmijenjen: "Račun je izmijenjen.",
  kuf_obrisan: "Račun je obrisan iz KUF-a.",
  kuf_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kuf_obavezno: "Dobavljač, konto troška, ukupan iznos, broj računa, datum računa i datum prijema su obavezni.",
  kuf_iznosi: "Provjerite osnovice i PDV iznose.",
  kuf_ukupno: "Ukupno računa se ne slaže sa zbirom osnovica i PDV-a.",
  kuf_konto: "Konto mora biti aktivno analitičko konto iz kontnog plana.",
  kuf_knjiga: "KUF knjiga nije otvorena za unos.",
  kuf_dupli_broj: "Račun sa istim dobavljačem, brojem i datumom već postoji u KUF-u.",
  kuf_dupli_fiskalni: "Ovaj fiskalni račun je već unesen u KUF za aktivnu firmu.",
  kuf_kalkulacije_preuzete: "Izabrane kalkulacije su preuzete u KUF.",
  kuf_kalkulacije_izbor: "Izaberite najmanje jednu kalkulaciju za preuzimanje.",
  kuf_kalkulacije_mjesec: "Kalkulacija mora pripadati istom mjesecu i poslovnoj godini kao KUF knjiga.",
  kuf_kalkulacije_pdv: "PDV stopa iz kalkulacije više nije aktivna.",
  kuf_kalkulacije_duplikat: "Račun iz izabrane kalkulacije već postoji u KUF-u.",
  kuf_kalkulacije_period: "PDV period ove KUF knjige je zaključan.",
  kuf_kalkulacije_greska: "Kalkulacije nijesu preuzete. Osvježite stranicu i provjerite njihov status.",
  prava: "Nemate pravo za ovu akciju nad ulaznim računima.",
  knjizenje_kreiran: "Nalog je kreiran.",
  knjizenje_dodato: "Novi računi su dodati na postojeći nalog.",
  knjizenje_vrsta_naloga: "Za ovu vrstu KUF knjige prvo izaberite vrstu naloga u podešavanjima.",
  knjizenje_sema: "Šema kontiranja nije kompletna za ovu vrstu knjige.",
  knjizenje_konto: "Neko konto iz šeme nije aktivno analitičko konto.",
  knjizenje_nalog_zakljucan: "Postojeći nalog je već proknjižen i ne može se dopuniti.",
  knjizenje_nema: "Nema neproknjiženih računa za ovu knjigu.",
  knjizenje_razlika_racuna: "KUF nije proknjižen jer jedan račun ima nedozvoljenu razliku.",
  knjizenje_nije_balansiran: "Šema knjiženja ne daje izbalansiran nalog.",
  kuf_greska: "Račun nije sačuvan. Provjerite podatke."
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

function decimalText(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  return numeric.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function decimalInput(value: { toString(): string } | number) {
  const numeric = typeof value === "number" ? value : Number(value.toString());

  if (!Number.isFinite(numeric) || numeric === 0) {
    return "";
  }

  return numeric.toFixed(2);
}

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

function postingStatusLabel(total: number, posted: number, unposted: number) {
  if (total === 0) {
    return "Prazno";
  }

  if (posted > 0 && unposted > 0) {
    return "Djelimično knjižena";
  }

  if (posted > 0 && unposted === 0) {
    return "Knjiženo";
  }

  return "Otvorena";
}

function postingStatusClass(label: string) {
  if (label === "Knjiženo") {
    return "status-pill status-pill--success";
  }

  if (label === "Djelimično knjižena") {
    return "status-pill status-pill--warning";
  }

  if (label === "Prazno") {
    return "status-pill status-pill--muted";
  }

  return "status-pill";
}

export default async function KufBookPage({ params, searchParams }: KufBookPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  const query = await searchParams;
  const baseMessage = query?.poruka ? poruke[query.poruka] : null;
  const message =
    baseMessage && query?.detalj ? `${baseMessage} ${query.detalj}` : baseMessage;
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
        <p className="admin-message">KUF knjiga nije dostupna za aktivni kontekst.</p>
      </div>
    );
  }

  const [kufBook, vatRates, baseAccounts, companyOverrides, businessUnits] = await Promise.all([
    prisma.kufBook.findFirst({
      where: {
        id,
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        is_deleted: false
      },
      select: {
        id: true,
        internal_kuf_number: true,
        racun_vrsta: {
          select: {
            naziv: true
          }
        },
        mjesec: true,
        kuf_date: true,
        status: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "desc"
          },
          select: {
            id: true,
            internal_kuf_number: true,
            supplier_invoice_number: true,
            fiscal_iic: true,
            fiscal_fic: true,
            fiscal_seller_tin: true,
            fiscal_datetime: true,
            fiscal_source_url: true,
            dobavljac_id: true,
            poslovna_jedinica_id: true,
            invoice_date: true,
            receipt_date: true,
            due_date: true,
            vat_transaction_type: true,
            is_import: true,
            customs_declaration_number: true,
            customs_declaration_date: true,
            goods_value: true,
            customs_base_amount: true,
            customs_duty_amount: true,
            customs_vat_rate_percent: true,
            customs_vat_amount: true,
            total_base: true,
            total_input_vat: true,
            deductible_vat: true,
            non_deductible_vat: true,
            total_gross: true,
            status: true,
            posting_status: true,
            source_type: true,
            source_id: true,
            posting_mode: true,
            journal_id: true,
            note: true,
            expense_account: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            dobavljac: {
              select: {
                id: true,
                naziv: true,
                pib: true,
                is_foreign: true
              }
            },
            tax_lines: {
              orderBy: {
                vat_rate_percent: "desc"
              },
              select: {
                id: true,
                vat_rate_id: true,
                vat_rate_percent: true,
                tax_base: true,
                input_vat_amount: true,
                non_deductible_vat_amount: true
              }
            }
          }
        }
      }
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: user.agencija_id,
        aktivna: true
      },
      orderBy: [
        {
          redosljed: "asc"
        },
        {
          procenat: "desc"
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
        firma_id: activeCompany.id
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
    prisma.poslovnaJedinica.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        aktivna: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    })
  ]);

  if (!kufBook) {
    return (
      <div className="admin-stack">
        <p className="admin-message">KUF knjiga nije pronađena.</p>
        <Link className="secondary-button" href="/agencija/racuni/kuf">
          Nazad na KUF
        </Link>
      </div>
    );
  }

  const monthStart = new Date(Date.UTC(activeYear.godina, kufBook.mjesec - 1, 1));
  const monthEnd = new Date(Date.UTC(activeYear.godina, kufBook.mjesec, 1));
  const pendingCalculations = await prisma.kalkulacija.findMany({
    where: {
      agencija_id: user.agencija_id,
      firma_id: activeCompany.id,
      poslovna_godina_id: activeYear.id,
      status: "WAITING_KUF",
      kuf_entry_id: null,
      is_deleted: false,
      datum_racuna_dobavljaca: {
        gte: monthStart,
        lt: monthEnd
      }
    },
    orderBy: [
      {
        datum_racuna_dobavljaca: "asc"
      },
      {
        broj: "asc"
      }
    ],
    select: {
      id: true,
      interni_broj: true,
      broj_racuna_dobavljaca: true,
      datum_racuna_dobavljaca: true,
      ukupno_neto_fakturno: true,
      ukupno_ulazni_pdv: true,
      ukupno_racun_sa_pdv: true,
      nalog_id: true,
      dobavljac: {
        select: {
          naziv: true,
          pib: true
        }
      }
    }
  });

  const expenseAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) =>
      account.aktivan &&
      account.tip_konta === "analiticko"
  );

  const totals = kufBook.entries.reduce(
    (sum, entry) => ({
      base: sum.base + Number(entry.total_base.toString()),
      vat: sum.vat + Number(entry.total_input_vat.toString()),
      gross: sum.gross + Number(entry.total_gross.toString())
    }),
    {
      base: 0,
      vat: 0,
      gross: 0
    }
  );
  const isLocked = activeYear.zakljucena || kufBook.status !== "OPEN";
  const editingEntry = query?.edit
    ? kufBook.entries.find(
        (entry) => entry.id === query.edit && entry.posting_mode === "KUF_RULES"
      )
    : null;
  const formAction = editingEntry ? updateKufEntry : createKufEntry;
  const journalId =
    kufBook.entries.find(
      (entry) => entry.posting_mode === "KUF_RULES" && entry.journal_id
    )?.journal_id ?? null;
  const unpostedCount = kufBook.entries.filter(
    (entry) =>
      entry.posting_mode === "KUF_RULES" &&
      entry.posting_status === "UNPOSTED" &&
      !entry.journal_id
  ).length;
  const postedCount = kufBook.entries.filter((entry) => entry.posting_status === "POSTED").length;
  const postingLabel = postingStatusLabel(kufBook.entries.length, postedCount, unpostedCount);
  const editingSupplier = editingEntry
    ? {
        id: editingEntry.dobavljac.id,
        naziv: editingEntry.dobavljac.naziv,
        pib: editingEntry.dobavljac.pib,
        scope: "RECORDED",
        isForeign: editingEntry.dobavljac.is_foreign,
        label: `${editingEntry.dobavljac.naziv}${editingEntry.dobavljac.pib ? ` (${editingEntry.dobavljac.pib})` : ""}`
      }
    : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{kufBook.internal_kuf_number}</h2>
          <p>
            {mjeseci[kufBook.mjesec - 1] ?? kufBook.mjesec} {activeYear.godina} · datum KUF-a{" "}
            {displayDate(kufBook.kuf_date)} · {kufBook.racun_vrsta.naziv}
          </p>
        </div>
        <Link className="secondary-button" href="/agencija/racuni/pregled-kuf">
          Pregled KUF
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Knjiženje KUF-a</h3>
            <span>
              {journalId
                ? `${unpostedCount} računa čeka dodavanje na postojeći nalog`
                : `${unpostedCount} računa čeka knjiženje`}
            </span>
          </div>
          <div className="button-row">
            <span className={postingStatusClass(postingLabel)}>{postingLabel}</span>
            {journalId ? (
              <Link className="secondary-button" href={`/agencija/nalozi/${journalId}`}>
                Vidi nalog
              </Link>
            ) : null}
            {unpostedCount > 0 ? (
              <form action={postInvoiceBook}>
                <input type="hidden" name="dokument_tip" value="KUF" />
                <input type="hidden" name="book_id" value={kufBook.id} />
                <input type="hidden" name="return_to" value={`/agencija/racuni/kuf/${kufBook.id}`} />
                <button className="primary-button" type="submit">
                  {journalId ? "Dodaj na nalog" : "Proknjiži KUF"}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Preuzmi kalkulacije</h3>
            <span>
              {pendingCalculations.length
                ? `${pendingCalculations.length} završenih kalkulacija čeka prenos u ovu KUF knjigu`
                : "Nema završenih kalkulacija za ovaj mjesec"}
            </span>
          </div>
        </div>

        {pendingCalculations.length ? (
          <form action={importCalculationsToKuf}>
            <input type="hidden" name="kuf_book_id" value={kufBook.id} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Preuzmi</th>
                    <th>Kalkulacija</th>
                    <th>Dobavljač</th>
                    <th>Račun / datum</th>
                    <th>Osnovica</th>
                    <th>PDV</th>
                    <th>Ukupno</th>
                    <th>Nalog</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingCalculations.map((calculation) => (
                    <tr key={calculation.id}>
                      <td>
                        <input
                          aria-label={`Preuzmi ${calculation.interni_broj}`}
                          defaultChecked
                          disabled={isLocked}
                          name="calculation_id"
                          type="checkbox"
                          value={calculation.id}
                        />
                      </td>
                      <td>
                        <Link href={`/agencija/robno/kalkulacije/${calculation.id}`}>
                          <strong>{calculation.interni_broj}</strong>
                        </Link>
                      </td>
                      <td>
                        {calculation.dobavljac.naziv}
                        <small>{calculation.dobavljac.pib ?? ""}</small>
                      </td>
                      <td>
                        {normalizeFiscalInvoiceNumber(calculation.broj_racuna_dobavljaca)}
                        <small>{displayDate(calculation.datum_racuna_dobavljaca)}</small>
                      </td>
                      <td>{decimalText(calculation.ukupno_neto_fakturno)}</td>
                      <td>{decimalText(calculation.ukupno_ulazni_pdv)}</td>
                      <td>{decimalText(calculation.ukupno_racun_sa_pdv)}</td>
                      <td>{calculation.nalog_id ? "Kreiran kroz kalkulaciju" : "Nedostaje"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button className="primary-button" disabled={isLocked} type="submit">
                Preuzmi označene kalkulacije
              </button>
            </div>
          </form>
        ) : (
          <p className="empty-state">
            Završene kalkulacije se ovdje pojavljuju automatski prema mjesecu računa
            dobavljača.
          </p>
        )}
      </section>

      <section className="metric-grid">
        <div className="metric">
          <span>Računa</span>
          <strong>{kufBook.entries.length}</strong>
          <small>{postingLabel}</small>
        </div>
        <div className="metric">
          <span>Osnovica</span>
          <strong>{decimalText(totals.base)}</strong>
          <small>zbir poreskih osnovica</small>
        </div>
        <div className="metric">
          <span>PDV / Ukupno</span>
          <strong>{decimalText(totals.vat)} / {decimalText(totals.gross)}</strong>
          <small>ulazni PDV i bruto iznos</small>
        </div>
      </section>

      <section className="admin-form-section">
        <div className="panel-header">
          <h3>{editingEntry ? "Izmjena ulaznog računa" : "Unos ulaznog računa"}</h3>
          <span>
            {editingEntry ? editingEntry.internal_kuf_number : activeCompany.pdv_obveznik ? "Firma je PDV obveznik" : "Firma nije PDV obveznik"}
          </span>
        </div>

        {isLocked ? (
          <p className="admin-message">KUF knjiga ili poslovna godina su zaključani za unos.</p>
        ) : null}

        {vatRates.length === 0 ? (
          <p className="admin-message">
            Nema aktivnih PDV stopa. Prvo ih podesite u podešavanjima.
          </p>
        ) : null}

        <form
          key={editingEntry?.id ?? "new-kuf-entry"}
          id="kuf-entry-form"
          className="admin-form kuf-entry-form"
          action={formAction}
        >
          <KufEntryFormShortcuts formId="kuf-entry-form" />
          <input name="kuf_book_id" type="hidden" value={kufBook.id} />
          {editingEntry ? <input name="kuf_entry_id" type="hidden" value={editingEntry.id} /> : null}
          <input name="fiscal_iic" type="hidden" defaultValue={editingEntry?.fiscal_iic ?? ""} />
          <input name="fiscal_fic" type="hidden" defaultValue={editingEntry?.fiscal_fic ?? ""} />
          <input
            name="fiscal_seller_tin"
            type="hidden"
            defaultValue={editingEntry?.fiscal_seller_tin ?? ""}
          />
          <input
            name="fiscal_datetime"
            type="hidden"
            defaultValue={editingEntry?.fiscal_datetime?.toISOString() ?? ""}
          />
          <input
            name="fiscal_source_url"
            type="hidden"
            defaultValue={editingEntry?.fiscal_source_url ?? ""}
          />

          {!isLocked ? (
            <>
              <InvoiceQrUpload />
              <FiskalniLinkInput formId="kuf-entry-form" />
            </>
          ) : null}

          <PartnerSearchInput
            disabled={isLocked}
            initialPartner={editingSupplier}
            label="Dobavljač"
            name="dobavljac_id"
            required
          />
          <label>
            <span>Poslovna jedinica (opciono)</span>
            <select
              name="poslovna_jedinica_id"
              defaultValue={editingEntry?.poslovna_jedinica_id ?? ""}
              disabled={isLocked}
            >
              <option value="">Bez poslovne jedinice</option>
              {businessUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.sifra} — {unit.naziv}
                </option>
              ))}
            </select>
          </label>
          <VatTransactionTypeSelect
            disabled={isLocked}
            documentType="KUF"
            initialValue={editingEntry?.vat_transaction_type}
          />
          <VatTransactionFields
            documentType="KUF"
            showFor="IMPORT"
            initialValue={editingEntry?.vat_transaction_type}
          >
            <p className="form-wide admin-hint">
              Uvoz: unesi jedan dokument za cijeli uvoz (faktura dobavljača + carinska
              deklaracija). Program automatski knjiži robu, carinu i carinski PDV.
            </p>
            <label>
              <span>Broj carinske deklaracije</span>
              <input
                name="customs_declaration_number"
                defaultValue={editingEntry?.customs_declaration_number ?? ""}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Datum carinske deklaracije</span>
              <input
                name="customs_declaration_date"
                type="date"
                defaultValue={
                  editingEntry?.customs_declaration_date
                    ? inputDate(editingEntry.customs_declaration_date)
                    : ""
                }
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Vrijednost robe (faktura dobavljača)</span>
              <input
                name="goods_value"
                inputMode="decimal"
                defaultValue={decimalInput(editingEntry?.goods_value ?? 0)}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Carinska osnovica</span>
              <input
                name="customs_base_amount"
                inputMode="decimal"
                defaultValue={decimalInput(editingEntry?.customs_base_amount ?? 0)}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Carina (uvozne dažbine)</span>
              <input
                name="customs_duty_amount"
                inputMode="decimal"
                defaultValue={decimalInput(editingEntry?.customs_duty_amount ?? 0)}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Stopa carinskog PDV-a (%)</span>
              <input
                name="customs_vat_rate_percent"
                inputMode="decimal"
                defaultValue={decimalInput(editingEntry?.customs_vat_rate_percent ?? 0)}
                disabled={isLocked}
              />
            </label>
            <label>
              <span>Carinski PDV (iznos)</span>
              <input
                name="customs_vat_amount"
                inputMode="decimal"
                defaultValue={decimalInput(editingEntry?.customs_vat_amount ?? 0)}
                disabled={isLocked}
              />
            </label>
          </VatTransactionFields>
          <label>
            <span>Broj računa dobavljača</span>
            <input
              name="supplier_invoice_number"
              defaultValue={normalizeFiscalInvoiceNumber(editingEntry?.supplier_invoice_number)}
              required
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Datum računa</span>
            <input
              name="invoice_date"
              type="date"
              defaultValue={editingEntry ? inputDate(editingEntry.invoice_date) : inputDate()}
              required
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Datum prijema</span>
            <input
              name="receipt_date"
              type="date"
              defaultValue={editingEntry ? inputDate(editingEntry.receipt_date) : inputDate()}
              required
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Datum dospijeća</span>
            <input
              name="due_date"
              type="date"
              defaultValue={editingEntry?.due_date ? inputDate(editingEntry.due_date) : ""}
              disabled={isLocked}
            />
          </label>
          <label>
            <span>Konto knjiženja</span>
            <select
              name="expense_account_code"
              defaultValue={editingEntry?.expense_account?.sifra ?? ""}
              required
              disabled={isLocked}
            >
              <option value="">Izaberite konto</option>
              {expenseAccounts.map((account) => (
                <option key={`${account.source}-${account.id}`} value={account.sifra}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
          <label className="form-wide">
            <span>Napomena</span>
            <input
              name="note"
              defaultValue={editingEntry?.note ?? ""}
              placeholder="Opis ili interna napomena"
              disabled={isLocked}
            />
          </label>

          <VatTransactionFields
            documentType="KUF"
            hideFor="IMPORT"
            initialValue={editingEntry?.vat_transaction_type}
          >
            <KufTaxLinesForm
              disabled={isLocked}
              initialInvoiceTotal={editingEntry ? decimalInput(editingEntry.total_gross) : ""}
              initialLines={
                editingEntry
                  ? editingEntry.tax_lines
                      .filter((line) => line.vat_rate_id)
                      .map((line) => ({
                        vatRateId: line.vat_rate_id!,
                        taxBase: decimalInput(line.tax_base),
                        nonDeductibleVat: decimalInput(line.non_deductible_vat_amount)
                      }))
                  : []
              }
              rates={vatRates.map((rate) => ({
                id: rate.id,
                sifra: rate.sifra,
                naziv: rate.naziv,
                procenat: rate.procenat.toString()
              }))}
            />
          </VatTransactionFields>

          <div className="kuf-form-actions">
            {!isLocked ? <FiskalniUcitajButton formId="kuf-entry-form" /> : null}
            <button type="submit" disabled={isLocked || vatRates.length === 0}>
              {editingEntry ? "Sačuvaj izmjenu" : "Unesi u KUF"} F9
            </button>
            {editingEntry ? (
              <Link className="secondary-button" href={`/agencija/racuni/kuf/${kufBook.id}`}>
                Odustani
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Računi u KUF knjizi</h3>
          <span>{kufBook.entries.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>KUF broj</th>
                <th>Dobavljač</th>
                <th>Račun</th>
                <th>Tip prometa</th>
                <th>Konto knjiženja</th>
                <th>Datumi</th>
                <th>Osnovica</th>
                <th>PDV</th>
                <th>Ukupno</th>
                <th>Razrada</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {kufBook.entries.length === 0 ? (
                <tr>
                  <td colSpan={12}>Nema unesenih računa u ovoj KUF knjizi.</td>
                </tr>
              ) : (
                kufBook.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.internal_kuf_number}</strong>
                      {entry.note ? <small>{entry.note}</small> : null}
                    </td>
                    <td>
                      {entry.dobavljac.naziv}
                      <small>{entry.dobavljac.pib ?? ""}</small>
                    </td>
                    <td>{normalizeFiscalInvoiceNumber(entry.supplier_invoice_number)}</td>
                    <td>
                      {vatTransactionLabels[
                        entry.vat_transaction_type as keyof typeof vatTransactionLabels
                      ] ?? entry.vat_transaction_type}
                    </td>
                    <td>
                      {entry.expense_account
                        ? `${entry.expense_account.sifra} - ${entry.expense_account.naziv}`
                        : entry.posting_mode === "SOURCE_DOCUMENT"
                          ? "Šema kalkulacije"
                          : "-"}
                    </td>
                    <td>
                      {displayDate(entry.invoice_date)}
                      <small>prijem {displayDate(entry.receipt_date)}</small>
                    </td>
                    <td>{decimalText(entry.total_base)}</td>
                    <td>
                      {decimalText(entry.total_input_vat)}
                      {Number(entry.non_deductible_vat.toString()) > 0 ? (
                        <small>neodbitni {decimalText(entry.non_deductible_vat)}</small>
                      ) : null}
                    </td>
                    <td>{decimalText(entry.total_gross)}</td>
                    <td>
                      {entry.tax_lines.map((line) => (
                        <small key={line.id}>
                          {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                          {decimalText(line.input_vat_amount)}
                        </small>
                      ))}
                    </td>
                    <td>
                      <span
                        className={
                          entry.posting_status === "POSTED"
                            ? "status-pill status-pill--success"
                            : "status-pill"
                        }
                      >
                        {entry.posting_mode === "SOURCE_DOCUMENT"
                          ? "Knjiženo kroz kalkulaciju"
                          : entry.posting_status === "POSTED"
                            ? "Knjiženo"
                            : "Otvorena"}
                      </span>
                      {entry.source_type === "CALCULATION" && entry.source_id ? (
                        <small>
                          <Link href={`/agencija/robno/kalkulacije/${entry.source_id}`}>
                            Otvori kalkulaciju
                          </Link>
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {entry.posting_mode === "KUF_RULES" &&
                      entry.posting_status === "UNPOSTED" &&
                      !isLocked ? (
                        <div className="table-actions">
                          <Link className="table-button" href={`/agencija/racuni/kuf/${kufBook.id}?edit=${entry.id}#kuf-entry-form`}>
                            Izmijeni
                          </Link>
                          <form action={deleteKufEntry}>
                            <input type="hidden" name="kuf_book_id" value={kufBook.id} />
                            <input type="hidden" name="kuf_entry_id" value={entry.id} />
                            <button className="table-button table-button-danger" type="submit">
                              Obriši
                            </button>
                          </form>
                        </div>
                      ) : (
                        "-"
                      )}
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
