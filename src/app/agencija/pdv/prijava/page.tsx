import { postPdvReturn, refreshPdvReturn, savePdvReturn } from "../actions";
import { PdvMonthForm, PdvReturnActions, PdvStatusPill } from "../_components";
import { PdvReturnForm } from "@/components/PdvReturnForm";
import { money, pdvMonths } from "@/lib/pdv";
import { findOrCreatePdvPeriod, normalizePdvMonth, requirePdvContext } from "@/lib/pdv-service";
import { prisma } from "@/lib/prisma";

const poruke: Record<string, string> = {
  period_zakljucan: "PDV period je zaključan.",
  prijava_osvjezena: "PDV prijava je osvježena iz KIF/KUF.",
  prijava_sacuvana: "PDV prijava je sačuvana.",
  prijava_iznos: "Provjerite unesene iznose.",
  prijava_zakljucana: "Prijava je zaključana ili proknjižena.",
  prijava_proknjizena: "PDV prijava je proknjižena.",
  knjizenje_podesavanja: "Podesite vrstu naloga i PDV konta prije knjiženja.",
  knjizenje_prijava: "Prijava ne postoji ili je već proknjižena.",
  knjizenje_nema_iznosa: "Nema iznosa za knjiženje.",
  knjizenje_nebalansirano: "Podešavanja knjiženja daju nebalansiran nalog."
};

type PageProps = {
  searchParams?: Promise<{
    mjesec?: string;
    poruka?: string;
  }>;
};

export default async function PdvPrijavaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = normalizePdvMonth(params?.mjesec);
  const context = await requirePdvContext("view");
  const period = await findOrCreatePdvPeriod({
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.poslovnaGodina.id,
    godina: context.poslovnaGodina.godina,
    mjesec: month,
    userId: context.user.id
  });
  const prijava = await prisma.pdvPrijava.findUnique({
    where: {
      pdv_period_id: period.id
    },
    include: {
      stavke: {
        orderBy: {
          redosljed: "asc"
        }
      },
      journal: {
        select: {
          id: true,
          sifra: true,
          is_deleted: true
        }
      }
    }
  });
  const activeJournal = prijava?.journal && !prijava.journal.is_deleted ? prijava.journal : null;
  const status =
    prijava?.status === "POSTED" && !activeJournal ? period.status : prijava?.status ?? period.status;
  const canPost = Boolean(prijava && !activeJournal && prijava.status !== "LOCKED");

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>PDV prijava</h2>
          <p>Forma prijave za izabrani mjesec, automatski popunjena iz KIF/KUF.</p>
        </div>
        <PdvStatusPill status={status} />
      </header>

      {params?.poruka && poruke[params.poruka] ? (
        <p className="admin-message">{poruke[params.poruka]}</p>
      ) : null}

      <section className="admin-panel">
        <div className="button-row">
          <PdvMonthForm action="/agencija/pdv/prijava" month={month} />
          <form action={refreshPdvReturn}>
            <input name="mjesec" type="hidden" value={month} />
            <button className="secondary-button" type="submit">
              Osvježi iz KIF/KUF
            </button>
          </form>
        </div>
      </section>

      {!prijava ? (
        <section className="admin-panel">
          <h3>{pdvMonths[month - 1]} {context.poslovnaGodina.godina}</h3>
          <p className="empty-state">Prijava još nije generisana. Kliknite “Osvježi iz KIF/KUF”.</p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Izlazni PDV</span>
              <strong>{money(Number(prijava.total_output_vat.toString()))}</strong>
              <small>Red 24</small>
            </div>
            <div className="metric">
              <span>Ulazni PDV</span>
              <strong>{money(Number(prijava.total_input_vat.toString()))}</strong>
              <small>Red 25</small>
            </div>
            <div className="metric">
              <span>Za uplatu</span>
              <strong>{money(Number(prijava.payable_vat.toString()))}</strong>
              <small>Red 28</small>
            </div>
            <div className="metric">
              <span>PDV kredit</span>
              <strong>{money(Number(prijava.credit_vat.toString()))}</strong>
              <small>Red 29</small>
            </div>
          </section>

          {activeJournal ? (
            <p className="admin-message">
              Proknjiženo u nalog <a href={`/agencija/nalozi/${activeJournal.id}`}>{activeJournal.sifra}</a>.
            </p>
          ) : null}

          <form id="pdv-post-form" action={postPdvReturn}>
            <input name="mjesec" type="hidden" value={month} />
            <input name="prijava_id" type="hidden" value={prijava.id} />
          </form>

          <form id="pdv-return-form" action={savePdvReturn}>
            <input name="mjesec" type="hidden" value={month} />
            <input name="prijava_id" type="hidden" value={prijava.id} />
            <section className="admin-panel">
              <div className="admin-header">
                <div>
                  <h3>Obrazac PDV prijave</h3>
                  <p>Polja se mogu dopuniti ručno; zbirna polja i PDV po stopama se preračunavaju automatski.</p>
                </div>
                <PdvReturnActions month={month} prijavaId={prijava.id} canPost={canPost} />
              </div>

              <PdvReturnForm
                locked={Boolean(activeJournal)}
                month={month}
                prijavaId={prijava.id}
                rows={prijava.stavke.map((row) => ({
                  id: row.id,
                  sifra: row.sifra,
                  opis: row.opis,
                  kolona: row.kolona,
                  sistemska_vrijednost: row.sistemska_vrijednost.toString(),
                  rucna_vrijednost: row.rucna_vrijednost?.toString() ?? null
                }))}
              />
            </section>
          </form>
        </>
      )}
    </div>
  );
}
