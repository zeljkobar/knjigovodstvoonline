import Link from "next/link";
import { saveM4MonthlyPayment } from "../actions";
import { getPlateContext, MissingPlateContext } from "../_shared";
import { findMunicipalitySurtax } from "@/lib/municipalities";
import { formatM4Date, formatM4Money, getM4Data, m4MonthNames } from "@/lib/payroll-m4";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
    mjesec?: string;
  }>;
};

const messages: Record<string, string> = {
  m4_uplata_sacuvana: "Podaci o mjesečnoj uplati su sačuvani.",
  m4_uplata_puna_sacuvana: "Obračunati iznosi su evidentirani kao uplaćeni u cijelosti.",
  m4_uplata_nema_obracuna: "Za izabrani mjesec nema obračunatih obaveza koje se mogu označiti kao uplaćene.",
  m4_uplata_nevalidna: "Mjesec i nenegativni iznosi uplate su obavezni.",
  godina_zakljucena: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za izmjenu M-4 podataka."
};

function moneyInput(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toFixed(2);
}

export default async function PayrollM4Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="M-4" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled M-4 evidencije.</p>
      </section>
    );
  }

  const [firma, data] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: context.firma.id,
        agencija_id: context.user.agencija_id,
        is_deleted: false
      },
      select: {
        naziv: true,
        pib: true,
        adresa: true,
        opstina: true,
        grad: true,
        odgovorna_lica: {
          where: {
            uloga: "IZVRSNI_DIREKTOR",
            aktivan: true,
            is_deleted: false
          },
          orderBy: [{ primarno: "desc" as const }, { created_at: "asc" as const }],
          take: 1,
          select: { id: true }
        }
      }
    }),
    getM4Data({
      agencijaId: context.user.agencija_id,
      firmaId: context.firma.id,
      poslovnaGodinaId: context.godina.id,
      godina: context.godina.godina
    })
  ]);

  if (!firma) {
    return null;
  }

  const municipalitySurtax = await findMunicipalitySurtax(
    firma.opstina ?? firma.grad,
    new Date(Date.UTC(context.godina.godina, 11, 31))
  );

  const selectedMonth = Math.min(12, Math.max(1, Number(params?.mjesec) || 1));
  const selectedPayment = data.payments.find((payment) => payment.mjesec === selectedMonth);
  const selectedMonthReport = data.report.months[selectedMonth - 1];
  const companyBlockers = [
    !firma.pib ? "Firma nema PIB." : null,
    !firma.adresa ? "Firma nema adresu." : null,
    !(firma.opstina || firma.grad) ? "Firma nema opštinu/grad." : null,
    !municipalitySurtax?.djp_sifra ? "Opština firme nije povezana sa DJP šifarnikom prireza." : null,
    !firma.odgovorna_lica.length ? "Firma nema unesenog izvršnog direktora." : null
  ].filter((issue): issue is string => Boolean(issue));
  const blockers = [...companyBlockers, ...data.report.blockers];
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>M-4 evidencija</h2>
          <p>
            {firma.naziv} / {context.godina.godina}
          </p>
        </div>
        <div className="table-actions">
          <Link className="secondary-button" href="/stampa/plate/m4?tip=tabela-1" target="_blank">
            Tabela 1
          </Link>
          <Link className="secondary-button" href="/stampa/plate/m4?tip=tabela-2" target="_blank">
            Tabela 2
          </Link>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>Kontrole prije štampe</h3>
            <p>Obrazac se puni iz podataka firme, obrađenih obračuna i potvrđenih uplata aktivne firme/godine.</p>
          </div>
          <span className={blockers.length ? "status-pill status-pill--warning" : "status-pill status-pill--success"}>
            {blockers.length ? `${blockers.length} blokada` : "Spremno"}
          </span>
        </div>
        {blockers.length ? (
          <div className="control-issues">
            {blockers.map((issue) => (
              <small key={issue}>{issue}</small>
            ))}
          </div>
        ) : null}
        {data.report.warnings.length ? (
          <div className="control-issues m4-warning-list">
            {data.report.warnings.map((issue) => (
              <small className="control-issue-warning" key={issue}>
                {issue}
              </small>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>Potvrđene mjesečne uplate</h3>
            <p>Unesite stvarno uplaćene obaveze iz potvrde/izvoda. Nepotvrđena uplata ne ulazi u službene kolone.</p>
          </div>
          <strong>{data.payments.filter((payment) => payment.potvrdjena).length}/12 potvrđeno</strong>
        </div>

        <div className="tabs-row m4-month-tabs">
          {m4MonthNames.map((name, index) => (
            <Link
              className={selectedMonth === index + 1 ? "tab-link active" : "tab-link"}
              href={`/agencija/plate/m4?mjesec=${index + 1}`}
              key={name}
              scroll={false}
            >
              {index + 1}
            </Link>
          ))}
        </div>

        <form className="admin-form m4-payment-form" action={saveM4MonthlyPayment}>
          <input name="mjesec" type="hidden" value={selectedMonth} />
          <div className="form-span-2 m4-payment-heading">
            <strong>{m4MonthNames[selectedMonth - 1]}</strong>
            <span>Obračunato: {formatM4Money(selectedMonthReport.ukupnoObracunatoCent, false)}</span>
          </div>
          <label><span>Porez</span><input name="porez" defaultValue={moneyInput(selectedPayment?.porez_cent)} /></label>
          <label><span>PIO - zaposleni</span><input name="zaposleni_pio" defaultValue={moneyInput(selectedPayment?.zaposleni_pio_cent)} /></label>
          <label><span>Zdravstvo - zaposleni</span><input name="zaposleni_zdravstvo" defaultValue={moneyInput(selectedPayment?.zaposleni_zdravstvo_cent)} /></label>
          <label><span>Nezaposlenost - zaposleni</span><input name="zaposleni_nezaposleni" defaultValue={moneyInput(selectedPayment?.zaposleni_nezaposleni_cent)} /></label>
          <label><span>PIO - isplatilac</span><input name="poslodavac_pio" defaultValue={moneyInput(selectedPayment?.poslodavac_pio_cent)} /></label>
          <label><span>Zdravstvo - isplatilac</span><input name="poslodavac_zdravstvo" defaultValue={moneyInput(selectedPayment?.poslodavac_zdravstvo_cent)} /></label>
          <label><span>Nezaposlenost - isplatilac</span><input name="poslodavac_nezaposleni" defaultValue={moneyInput(selectedPayment?.poslodavac_nezaposleni_cent)} /></label>
          <label><span>Fond rada</span><input name="fond_rada" defaultValue={moneyInput(selectedPayment?.fond_rada_cent)} /></label>
          <label><span>Nezapošljavanje invalida</span><input name="invalidi" defaultValue={moneyInput(selectedPayment?.invalidi_cent)} /></label>
          <label><span>Datum uplate</span><input name="datum_uplate" type="date" defaultValue={selectedPayment?.datum_uplate?.toISOString().slice(0, 10) ?? ""} /></label>
          <label className="form-span-2"><span>Referenca / broj izvoda</span><input name="referenca" defaultValue={selectedPayment?.referenca ?? ""} /></label>
          <label className="single-checkbox form-checkbox">
            <input name="potvrdjena" type="checkbox" defaultChecked={selectedPayment?.potvrdjena ?? false} />
            <span>Uplata je potvrđena</span>
          </label>
          <button name="nacin" type="submit" value="u_cijelosti">Uplaćeno u cijelosti</button>
          <button className="m4-manual-payment-button" name="nacin" type="submit" value="rucno">Sačuvaj ručni unos</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>M-4 prijave po osiguranicima</h3>
            <p>Redovi Tabele 2 i pojedinačni zvanični obrasci.</p>
          </div>
          <strong>{data.report.workers.length} osiguranika</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prezime i ime</th>
                <th>JMBG / lični broj</th>
                <th>Period rada</th>
                <th>M-4 osnovica</th>
                <th>Uplaćeni PIO</th>
                <th>Status</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {data.report.workers.map((worker) => (
                <tr key={worker.radnikId}>
                  <td><strong>{worker.imePrezime}</strong></td>
                  <td>{worker.identifikator || "-"}</td>
                  <td>{formatM4Date(worker.periodOd)} - {formatM4Date(worker.periodDo)}</td>
                  <td>{formatM4Money(worker.ukupnaM4OsnovicaCent, false)}</td>
                  <td>{formatM4Money(worker.ukupnoPioUplacenoCent, false)}</td>
                  <td>{worker.blockers.length ? "Nedostaju podaci" : "Spremno"}</td>
                  <td>
                    <Link className="table-button" href={`/stampa/plate/m4?tip=obrazac&radnik=${worker.radnikId}`} target="_blank">
                      M-4 obrazac
                    </Link>
                  </td>
                </tr>
              ))}
              {!data.report.workers.length ? (
                <tr><td colSpan={7}>Nema obrađenih stavki koje su označene da ulaze u M-4.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
