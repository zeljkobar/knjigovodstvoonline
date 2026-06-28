import Link from "next/link";
import {
  createInvoiceBookType,
  saveImportPostingScheme,
  saveInvoicePostingRules
} from "../actions";
import { InvoicePostingRuleRow } from "@/components/InvoicePostingRuleRow";
import {
  invoicePostingDefaultScope,
  invoicePostingDocumentTypes,
  invoicePostingFields,
  importPostingSchemeFields,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { ensureDefaultInvoiceBookTypes } from "@/lib/invoice-books";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type RacuniPodesavanjaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    vrsta?: string;
  }>;
};

const poruke: Record<string, string> = {
  vrsta_sacuvana: "Vrsta knjige je sačuvana.",
  vrsta_kontekst: "Izaberite aktivnu firmu.",
  vrsta_tip: "Izaberite KIF ili KUF.",
  vrsta_obavezno: "Šifra i naziv vrste su obavezni.",
  vrsta_greska: "Vrsta nije sačuvana. Provjerite podatke.",
  sema_sacuvana: "Šema kontiranja je sačuvana.",
  sema_kontekst: "Izaberite aktivnu firmu.",
  sema_vrsta: "Izaberite vrstu knjige.",
  sema_pdv: "Definišite bar jednu aktivnu PDV stopu.",
  sema_smjer: "Izaberite ispravan smjer knjiženja.",
  sema_izvor: "Izvor konta nije ispravan.",
  sema_vrsta_naloga: "Izaberite vrstu naloga za ovu vrstu knjige.",
  prava: "Nemate pravo za upravljanje podešavanjima KIF/KUF knjiga.",
  sema_konto:
    "Šema nije sačuvana: za svako polje sa izvorom 'Izabrano konto' morate izabrati konto.",
  uvoz_sema_sacuvana: "Šema za uvoz je sačuvana.",
  uvoz_sema_konto: "Šema za uvoz nije sačuvana: izabrano konto ne postoji u kontnom planu firme.",
  uvoz_sema_komitent: "Šema za uvoz nije sačuvana: izabrani partner nije komitent ove firme.",
  uvoz_sema_greska: "Šema za uvoz nije sačuvana. Provjerite podatke."
};

function percentText(value: { toString(): string }) {
  const numeric = Number(value.toString());

  return Number.isFinite(numeric) ? `${numeric.toFixed(2).replace(".", ",")}%` : "0,00%";
}

export default async function RacuniPodesavanjaPage({
  searchParams
}: RacuniPodesavanjaPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
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
          id: true
        }
      })
    : null;

  if (activeCompany) {
    await ensureDefaultInvoiceBookTypes(activeCompany.id, user.agencija_id, user.id);
  }

  const [baseAccounts, companyOverrides, vatRates, invoiceTypes, journalTypes] = activeCompany
    ? await Promise.all([
        prisma.konto.findMany({
          where: {
            aktivan: true
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
            sifra: true,
            naziv: true,
            procenat: true
          }
        }),
        prisma.racunVrsta.findMany({
          where: {
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            aktivna: true
          },
          orderBy: [
            {
              dokument_tip: "desc"
            },
            {
              redosljed: "asc"
            },
            {
              naziv: "asc"
            }
          ],
          select: {
            id: true,
            vrsta_naloga_id: true,
            dokument_tip: true,
            sifra: true,
            naziv: true,
            opis: true,
            sistemska: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              orderBy: {
                redosljed: "asc"
              },
              select: {
                polje_sifra: true,
                smjer: true,
                konto_izvor: true,
                sifra_konta: true
              }
            }
          }
        }),
        prisma.vrstaNaloga.findMany({
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
          orderBy: [
            {
              sistemska: "desc"
            },
            {
              naziv: "asc"
            }
          ],
          select: {
            id: true,
            sifra: true,
            naziv: true,
            prefiks: true
          }
        })
      ])
    : [[], [], [], [], []];

  const accounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan
  );
  const accountOptions = accounts.map((account) => ({
    sifra: account.sifra,
    naziv: account.naziv
  }));
  const importSchemeRows = activeCompany
    ? await prisma.firmaPodrazumijevanoKonto.findMany({
        where: {
          firma_id: activeCompany.id,
          dokument_tip: invoicePostingDocumentTypes.general,
          podvrsta: invoicePostingDefaultScope.subtype,
          pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
          namjena: {
            in: importPostingSchemeFields.map(([purpose]) => purpose)
          }
        },
        select: {
          namjena: true,
          sifra_konta: true,
          smjer: true,
          komitent_id: true
        }
      })
    : [];
  const importKomitenti = activeCompany
    ? await prisma.firmaKomitent.findMany({
        where: {
          firma_id: activeCompany.id,
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
    : [];
  const importKomitentOptions = importKomitenti.map((item) => item.komitent);
  const importSchemeByPurpose = new Map(
    importSchemeRows.map((row) => [row.namjena, row.sifra_konta])
  );
  const importDirectionByPurpose = new Map(
    importSchemeRows.map((row) => [row.namjena, row.smjer])
  );
  const importKomitentByPurpose = new Map(
    importSchemeRows.map((row) => [row.namjena, row.komitent_id])
  );
  const selectedType =
    invoiceTypes.find((type) => type.id === params?.vrsta) ?? invoiceTypes[0] ?? null;
  const fields = selectedType
    ? invoicePostingFields(selectedType.dokument_tip, vatRates)
    : [];
  const rulesByField = new Map(
    selectedType?.kontiranjePravila.map((rule) => [rule.polje_sifra, rule]) ?? []
  );

  return (
    <div className="admin-stack racuni-podesavanja">
      <header className="admin-header">
        <div>
          <h2>Podešavanja računa</h2>
          <p>Vrste KIF/KUF knjiga i šeme kontiranja po poljima.</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany ? (
        <section className="admin-panel">
          <h3>Izaberite firmu</h3>
          <p className="empty-state">
            Vrste i šeme knjiženja se podešavaju za aktivnu firmu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="admin-form-section">
            <div className="panel-header">
              <h3>Nova vrsta KIF/KUF</h3>
              <span>Korisničke vrste se odmah mogu koristiti u unosu</span>
            </div>
            <form className="admin-form" action={createInvoiceBookType}>
              <label>
                <span>Tip</span>
                <select name="dokument_tip" defaultValue={invoicePostingDocumentTypes.kuf}>
                  <option value={invoicePostingDocumentTypes.kuf}>KUF</option>
                  <option value={invoicePostingDocumentTypes.kif}>KIF</option>
                </select>
              </label>
              <label>
                <span>Šifra</span>
                <input name="sifra" placeholder="npr. AVANSI" required />
              </label>
              <label>
                <span>Naziv</span>
                <input name="naziv" placeholder="npr. KUF avansi" required />
              </label>
              <label>
                <span>Opis</span>
                <input name="opis" placeholder="Kratka napomena" />
              </label>
              <button type="submit">Dodaj vrstu</button>
            </form>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Vrste knjiga</h3>
              <span>{invoiceTypes.length} aktivnih</span>
            </div>
            <div className="table-wrap">
              <table className="book-types-table">
                <thead>
                  <tr>
                    <th>Tip</th>
                    <th>Šifra</th>
                    <th>Naziv</th>
                    <th>Opis</th>
                    <th>Vrsta naloga</th>
                    <th>Šema</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceTypes.map((type) => (
                    <tr key={type.id} className={selectedType?.id === type.id ? "selected-row" : ""}>
                      <td>{type.dokument_tip}</td>
                      <td>
                        <strong>{type.sifra}</strong>
                      </td>
                      <td>{type.naziv}</td>
                      <td>{type.opis ?? "-"}</td>
                      <td>
                        {journalTypes.find((journalType) => journalType.id === type.vrsta_naloga_id)
                          ?.naziv ?? "-"}
                      </td>
                      <td>
                        <Link
                          className="table-action"
                          href={`/agencija/racuni/podesavanja?vrsta=${type.id}`}
                        >
                          Otvori
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedType ? (
            <section className="admin-panel">
              <div className="panel-header">
                <div>
                  <h3>Šema kontiranja: {selectedType.naziv}</h3>
                  <span>
                    {selectedType.dokument_tip} · {vatRates.map((rate) => percentText(rate.procenat)).join(", ")}
                  </span>
                </div>
              </div>

              <form action={saveInvoicePostingRules}>
                <input type="hidden" name="racun_vrsta_id" value={selectedType.id} />
                <div className="admin-form single-row-form">
                  <label>
                    <span>Vrsta naloga</span>
                    <select name="vrsta_naloga_id" defaultValue={selectedType.vrsta_naloga_id ?? ""} required>
                      <option value="">Izaberite vrstu naloga</option>
                      {journalTypes.map((journalType) => (
                        <option key={journalType.id} value={journalType.id}>
                          {journalType.naziv}
                          {journalType.prefiks ? ` (${journalType.prefiks})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="table-wrap">
                  <table className="posting-scheme-table">
                    <thead>
                      <tr>
                        <th>Polje</th>
                        <th>D/P</th>
                        <th>Izvor konta</th>
                        <th>Konto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field) => {
                        const savedRule = rulesByField.get(field.code);
                        const direction = savedRule?.smjer ?? field.direction;
                        const source = savedRule?.konto_izvor ?? field.accountSource;
                        const selectedAccount = savedRule?.sifra_konta ?? "";

                        return (
                          <InvoicePostingRuleRow
                            key={`${selectedType.id}-${field.code}`}
                            accountOptions={accountOptions}
                            accountValue={selectedAccount}
                            code={field.code}
                            direction={direction}
                            label={field.label}
                            source={source}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <button type="submit">Sačuvaj šemu</button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="admin-panel">
            <div className="panel-header">
              <div>
                <h3>Šema za uvoz (KUF)</h3>
                <span>
                  Konta za knjiženje uvoznih faktura: roba/trošak, carina, carinski PDV, ino
                  dobavljač i dobavljač carina.
                </span>
              </div>
            </div>

            <form action={saveImportPostingScheme}>
              <div className="table-wrap">
                <table className="import-scheme-table">
                  <thead>
                    <tr>
                      <th>Stavka</th>
                      <th>D/P</th>
                      <th>Konto</th>
                      <th>Partner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPostingSchemeFields.map(([purpose, label, direction]) => (
                      <tr key={purpose}>
                        <td>{label}</td>
                        <td>
                          <select
                            name={`uvoz_smjer_${purpose}`}
                            defaultValue={importDirectionByPurpose.get(purpose) ?? direction}
                          >
                            <option value="D">Duguje</option>
                            <option value="P">Potražuje</option>
                          </select>
                        </td>
                        <td>
                          <select
                            name={`uvoz_konto_${purpose}`}
                            defaultValue={importSchemeByPurpose.get(purpose) ?? ""}
                          >
                            <option value="">— bez konta —</option>
                            {accountOptions.map((account) => (
                              <option key={account.sifra} value={account.sifra}>
                                {account.sifra} · {account.naziv}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            name={`uvoz_komitent_${purpose}`}
                            defaultValue={importKomitentByPurpose.get(purpose) ?? ""}
                          >
                            <option value="">— dobavljač sa računa —</option>
                            {importKomitentOptions.map((komitent) => (
                              <option key={komitent.id} value={komitent.id}>
                                {komitent.naziv}
                                {komitent.pib ? ` (${komitent.pib})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button type="submit">Sačuvaj šemu za uvoz</button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
