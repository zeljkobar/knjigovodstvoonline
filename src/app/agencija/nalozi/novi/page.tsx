import Link from "next/link";
import { createJournal } from "../actions";
import { JournalEntryForm } from "@/components/JournalEntryForm";
import { JournalLinesEditor } from "@/components/JournalLinesEditor";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type NoviNalogPageProps = {
  searchParams?: Promise<{
    detalj?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  nalog_obavezno: "Izaberite firmu, godinu, vrstu naloga i datum.",
  godina_zakljucena: "Poslovna godina je zakljucena.",
  pocetno_postoji: "Za izabranu firmu i godinu već postoji nalog početnog stanja.",
  stavke_obavezne: "Nalog mora imati bar jednu stavku.",
  stavke_nevalidne: "Provjerite konta i iznose na stavkama.",
  stavka_iznos: "Jedna stavka mora imati samo duguje ili samo potrazuje.",
  vrsta_nevalidna: "Vrsta naloga nije validna.",
  konto_nevalidno: "Konto ne postoji ili je deaktivirano za firmu.",
  partner_obavezan: "Za analiticko konto morate izabrati partnera.",
  poslovna_jedinica_nevalidna: "Poslovna jedinica nije dostupna u izabranoj firmi.",
  nalog_greska: "Nalog nije sacuvan."
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default async function NoviNalogPage({ searchParams }: NoviNalogPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message =
    params?.poruka === "partner_obavezan" && params.detalj
      ? `Analitika za konto ${params.detalj} je obavezna.`
      : params?.poruka
        ? poruke[params.poruka]
        : null;
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
          agencija_id: true
        }
      })
    : null;

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

  const [journalTypes, baseAccounts, companyOverrides] =
    activeCompany && activeYear
      ? await Promise.all([
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
            orderBy: {
              naziv: "asc"
            },
            select: {
              id: true,
              sifra: true,
              naziv: true,
              prefiks: true
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
          })
        ])
      : [[], [], []];

  const accounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const requiredAnalyticsAccounts = accounts
    .filter((account) => account.analitika_obavezna)
    .map((account) => account.sifra);
  const businessUnits = activeCompany
    ? await prisma.poslovnaJedinica.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: activeCompany.id,
          aktivna: true,
          is_deleted: false
        },
        select: { id: true, sifra: true, naziv: true },
        orderBy: { sifra: "asc" }
      })
    : [];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Novi nalog</h2>
        </div>
        <Link className="table-link" href="/agencija/nalozi">
          Pregled naloga
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i poslovnu godinu</h3>
          <p className="empty-state">
            Novi nalog se unosi za aktivnu firmu i godinu iz gornje trake.
          </p>
        </section>
      ) : activeYear.zakljucena ? (
        <section className="admin-panel">
          <h3>Godina je zaključena</h3>
          <p className="empty-state">
            Za {activeCompany.naziv} / {activeYear.godina} nije moguće unositi naloge.
          </p>
        </section>
      ) : (
        <JournalEntryForm
          action={createJournal}
          className="journal-form"
          requiredAnalyticsAccounts={requiredAnalyticsAccounts}
        >
          <input name="firma_id" type="hidden" value={activeCompany.id} />
          <input name="poslovna_godina_id" type="hidden" value={activeYear.id} />

          <section className="admin-form-section">
            <h3>Zaglavlje</h3>
            <div className="admin-form journal-header-form">
              <label>
                <span>Vrsta naloga</span>
                <select name="vrsta_naloga_id" required>
                  {journalTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.naziv} {type.prefiks ? `(${type.prefiks})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Datum naloga</span>
                <input defaultValue={todayInputValue()} name="datum" required type="date" />
              </label>
              <label>
                <span>Poslovna jedinica</span>
                <select name="poslovna_jedinica_id">
                  <option value="">Bez poslovne jedinice</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.sifra} · {unit.naziv}</option>
                  ))}
                </select>
              </label>
              <label className="form-wide">
                <span>Opis naloga</span>
                <input name="opis" placeholder="npr. Ručni nalog za korekciju" />
              </label>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Stavke</h3>
              <span>nacrt može biti neizbalansiran</span>
            </div>

            <JournalLinesEditor
              accounts={accounts}
              datalistId="konto-options"
            />

            <div className="journal-actions">
              <button type="submit">Sačuvaj nacrt</button>
            </div>
          </section>
        </JournalEntryForm>
      )}
    </div>
  );
}
