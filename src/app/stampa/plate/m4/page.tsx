import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { findMunicipalitySurtax } from "@/lib/municipalities";
import { hasPermission } from "@/lib/permissions";
import { formatM4Date, formatM4Money, getM4Data, type M4MonthRow, type M4WorkerRow } from "@/lib/payroll-m4";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    tip?: string;
    radnik?: string;
  }>;
};

function digits(value: string | number | null | undefined, length: number) {
  const normalized = String(value ?? "").replace(/\D/g, "").slice(0, length).padEnd(length, " ");
  return normalized.split("");
}

function DigitLine({ value, length }: { value: string | number | null | undefined; length: number }) {
  return (
    <span className="m4-digit-line">
      {digits(value, length).map((digit, index) => (
        <span key={index}>{digit.trim() ? digit : "\u00a0"}</span>
      ))}
      <sup>{length}</sup>
    </span>
  );
}

function moneyDigits(cents: number) {
  return cents ? String(Math.round(cents)) : "";
}

function printDate() {
  const today = new Date();

  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}

function CompanyHeader({ naziv, pib, table }: { naziv: string; pib: string; table: string }) {
  return (
    <header className="m4-table-company-header">
      <div>
        <strong>{naziv.toUpperCase()}</strong>
        <span>PIB: &nbsp; {pib}</span>
      </div>
      <b>{table}</b>
    </header>
  );
}

function Signature({ place, date, authorized }: { place: string; date: Date | null; authorized: string }) {
  return (
    <footer className="m4-table-signature">
      <div>
        U&nbsp;&nbsp; <strong>{place.toUpperCase()}</strong>&nbsp;&nbsp;,&nbsp;&nbsp; {formatM4Date(date) || "____________"}. god.
      </div>
      <span>M.P.</span>
      <div className="m4-authorized-line">
        <span>Ovlašćeno lice,</span>
        <b>{authorized}</b>
      </div>
    </footer>
  );
}

function M4Form({
  worker,
  firma,
  godina,
  place,
  date,
  authorized,
  municipalityName,
  municipalityCode
}: {
  worker: M4WorkerRow;
  firma: { naziv: string; pib: string | null; adresa: string | null; opstina: string | null; grad: string | null };
  godina: number;
  place: string;
  date: Date;
  authorized: string;
  municipalityName: string;
  municipalityCode: string;
}) {
  const municipality = municipalityName.toUpperCase();
  const address = (firma.adresa ?? "").toUpperCase();

  return (
    <section className="m4-official-document m4-page-portrait">
      <div className="m4-form-code">Obrazac M-4</div>
      <h1>PRIJAVA PODATAKA</h1>
      <h2>
        ZA UTVRĐIVANJE STAŽA OSIGURANJA, ZARADE, NAKNADE ZARADE, ODNOSNO
        <br />OSNOVICE OSIGURANJA I VISINE UPLAĆENOG DOPRINOSA ZA&nbsp;&nbsp;
        <u>{godina}</u>&nbsp;&nbsp; GODINU
      </h2>

      <table className="m4-form-table m4-employer-table">
        <thead>
          <tr><th>Redni<br />broj</th><th>Naziv obilježja</th><th>Prostor za odgovore</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>1.</td>
            <td><strong>Poreski identifikacioni broj</strong><small>obveznika plaćanja doprinosa</small></td>
            <td><DigitLine value={firma.pib} length={13} /></td>
          </tr>
          <tr>
            <td>2.</td>
            <td><strong>Redni broj organizacione jedinice</strong></td>
            <td><DigitLine value="0000" length={4} /></td>
          </tr>
          <tr>
            <td>3.</td>
            <td><strong>Opština</strong></td>
            <td><b className="m4-answer-line">{municipality}</b><DigitLine value={municipalityCode} length={3} /></td>
          </tr>
          <tr>
            <td>4.</td>
            <td><strong>Naziv (prezime i ime) i sjedište</strong><small>obveznika plaćanja doprinosa</small></td>
            <td className="m4-company-answer"><b>{firma.naziv.toUpperCase()}</b><b>{municipality}</b><b>{address || "\u00a0"}</b></td>
          </tr>
        </tbody>
      </table>

      <h3 className="m4-section-title">PODACI O OSIGURANIKU</h3>
      <table className="m4-form-table m4-insured-table">
        <tbody>
          <tr>
            <td>5.</td>
            <td><strong>Jedinstveni matični broj građanina</strong><small>(Lični broj osiguranika ukoliko nema JMBG)</small></td>
            <td><DigitLine value={worker.identifikator} length={13} /></td>
          </tr>
          <tr>
            <td>6.</td>
            <td><strong>Prezime i ime osiguranika</strong></td>
            <td className="m4-company-answer"><b>{worker.imePrezime}</b><b>&nbsp;</b></td>
          </tr>
        </tbody>
      </table>

      <h3 className="m4-section-title m4-service-title">
        PODACI O STAŽU OSIGURANJA, ZARADI, NAKNADI ZARADE, ODNOSNO OSNOVICI OSIGURANJA I<br />VISINI UPLAĆENOG DOPRINOSA
      </h3>
      <table className="m4-form-table m4-service-table">
        <tbody>
          <tr>
            <td>7.</td><td><strong>Podaci o stažu osiguranja</strong></td>
            <td className="m4-service-box"><span>Mjeseci</span><b>{String(worker.stazMjeseci).padStart(2, "0")}</b></td>
            <td className="m4-service-box"><span>Dani</span><b>{String(worker.stazDani).padStart(2, "0")}</b></td>
            <td><DigitLine value={worker.oznakaStaza} length={2} /></td>
          </tr>
          <tr className="m4-two-line-row">
            <td>8.<br /><small>a)</small><br /><small>b)</small></td>
            <td><strong>Podaci o zaradi, osnovici osiguranja<br />i doprinosu</strong><small>Zarada, osnovica osiguranja</small><small>Uplaćeni doprinos</small></td>
            <td colSpan={3}><span><DigitLine value={moneyDigits(worker.zaradaOsnovicaCent)} length={9} /></span><span><DigitLine value={moneyDigits(worker.zaradaPioUplacenoCent)} length={8} /></span></td>
          </tr>
          <tr className="m4-two-line-row">
            <td>9.<br /><small>a)</small><br /><small>b)</small></td>
            <td><strong>Podaci o naknadi zarade, po osnovu<br />zdravstvenog osiguranja, odnosno<br />porodiljskog odsustva, i doprinosu:</strong><small>Zarada, osnovica osiguranja</small><small>Uplaćeni doprinos</small></td>
            <td colSpan={3}><span><DigitLine value={moneyDigits(worker.naknadaOsnovicaCent)} length={9} /></span><span><DigitLine value={moneyDigits(worker.naknadaPioUplacenoCent)} length={8} /></span></td>
          </tr>
          <tr>
            <td>10.</td><td><strong>Oznaka staža</strong></td><td colSpan={3}><DigitLine value={worker.oznakaStaza} length={2} /></td>
          </tr>
        </tbody>
      </table>

      <table className="m4-form-table m4-increased-service-table">
        <colgroup>
          <col className="m4-increased-number-column" />
          <col className="m4-increased-duration-column" />
          <col className="m4-increased-duration-column" />
          <col />
          <col className="m4-increased-code-column" />
        </colgroup>
        <thead><tr><th rowSpan={2}>11.</th><th colSpan={2}>Efektivno trajanje</th><th rowSpan={2}>Radna mjesta-poslovi odnosno osnov za računanje staža<br />osiguranja sa uvećanim trajanjem</th><th rowSpan={2}>Š i f r a</th></tr><tr><th>Mjeseci</th><th>Dani</th></tr></thead>
        <tbody>
          {[1, 2, 3, 4].map((row) => <tr key={row}><td>11.{row}</td><td colSpan={2}><DigitLine value="" length={4} /></td><td></td><td><DigitLine value="" length={4} /></td></tr>)}
          <tr><td>12.</td><td colSpan={2}>Uplaćeni doprinos</td><td colSpan={2}><DigitLine value="" length={8} /></td></tr>
        </tbody>
      </table>

      <footer className="m4-form-footer">
        <table><tbody><tr><td>Datum prijema prijave:</td></tr><tr><td>Primio:</td></tr><tr><td>Unio:</td></tr></tbody></table>
        <div className="m4-stamp">(M.P.)</div>
        <div className="m4-submitter">
          <p>U&nbsp;&nbsp; <b>{place.toUpperCase()}</b>&nbsp;&nbsp;, dana&nbsp;&nbsp; <b>{formatM4Date(date)}</b>&nbsp;&nbsp; god.</p>
          <strong>PODNOSILAC PRIJAVE</strong>
          <span>{authorized.toUpperCase()}</span><small>(potpis ovlašćenog lica)</small>
        </div>
      </footer>
    </section>
  );
}

function Table1({
  naziv,
  pib,
  godina,
  months,
  totals,
  place,
  date,
  authorized
}: {
  naziv: string;
  pib: string;
  godina: number;
  months: M4MonthRow[];
  totals: M4MonthRow;
  place: string;
  date: Date | null;
  authorized: string;
}) {
  const row = (month: M4MonthRow, label = month.naziv) => (
    <tr key={label}>
      <td>{label}</td><td>{formatM4Money(month.osnovicaCent)}</td><td>{formatM4Money(month.porezCent)}</td>
      <td>{formatM4Money(month.zaposleniPioCent)}</td><td>{formatM4Money(month.zaposleniZdravstvoCent)}</td>
      <td>{formatM4Money(month.zaposleniNezaposleniCent)}</td><td>{formatM4Money(month.poslodavacPioCent)}</td>
      <td>{formatM4Money(month.poslodavacZdravstvoCent)}</td><td>{formatM4Money(month.poslodavacNezaposleniCent)}</td>
      <td>{formatM4Money(month.fondRadaCent)}</td><td>{formatM4Money(month.invalidiCent)}</td>
      <td>{formatM4Money(month.ukupnoObracunatoCent)}</td><td>{formatM4Money(month.ukupnoUplacenoCent)}</td>
    </tr>
  );

  return (
    <section className="m4-table-document m4-page-landscape">
      <CompanyHeader naziv={naziv} pib={pib} table="TABELA 1" />
      <h1>TABELARNI PRIKAZ OBRAČUNATIH I UPLAĆENIH POREZA I DOPRINOSA ZA&nbsp;&nbsp; <u>{godina}</u>&nbsp;&nbsp; GODINU</h1>
      <table className="m4-table-1">
        <thead>
          <tr><th rowSpan={2}>M J E S E C I</th><th rowSpan={2}>Iznos<br />osnovice<br />za obračun</th><th rowSpan={2}>Porez</th><th colSpan={3}>Iznos obračunatih i plaćenih doprinosa<br />na teret zaposlenog</th><th colSpan={5}>Iznos obračunatih i plaćenih doprinosa na teret isplatioca</th><th rowSpan={2}>Ukupno<br />obračunato</th><th rowSpan={2}>Ukupno<br />uplaćeno</th></tr>
          <tr><th>Doprinos za<br />PIO</th><th>Doprinos za<br />zdravstv.<br />osiguranje</th><th>Doprinos za<br />osigur. od<br />nezaposl.</th><th>Doprinos za<br />PIO</th><th>Doprinos za<br />zdravstv.<br />osiguranje</th><th>Doprinos za<br />osigur. od<br />nezaposl.</th><th>Doprinos za<br />Fond rada</th><th>Doprinos zbog<br />nezapošljavanja<br />invalida</th></tr>
          <tr className="m4-column-numbers">{Array.from({ length: 13 }, (_, index) => <th key={index}>{index + 1}</th>)}</tr>
        </thead>
        <tbody>
          {months.map((month) => row(month))}
          {row(totals, "U K U P N O")}
          <tr><td>Bruto lična primanja<br />koja ulaze u M4</td><td>{formatM4Money(totals.m4BrutoCent)}</td><td>-</td><td>{formatM4Money(totals.zaposleniPioCent)}</td><td>{formatM4Money(totals.zaposleniZdravstvoCent)}</td><td>{formatM4Money(totals.zaposleniNezaposleniCent)}</td><td>{formatM4Money(totals.poslodavacPioCent)}</td><td>{formatM4Money(totals.poslodavacZdravstvoCent)}</td><td>{formatM4Money(totals.poslodavacNezaposleniCent)}</td><td>{formatM4Money(totals.fondRadaCent)}</td><td>{formatM4Money(totals.invalidiCent)}</td><td>{formatM4Money(totals.ukupnoObracunatoCent)}</td><td>{formatM4Money(totals.ukupnoUplacenoCent)}</td></tr>
          <tr><td>Ostala bruto<br />lična primanja</td><td>{formatM4Money(totals.ostaloBrutoCent)}</td>{Array.from({ length: 11 }, (_, index) => <td key={index}>-</td>)}</tr>
        </tbody>
      </table>
      <Signature place={place} date={date} authorized={authorized} />
    </section>
  );
}

function Table2({ naziv, pib, godina, workers, place, date, authorized }: { naziv: string; pib: string; godina: number; workers: M4WorkerRow[]; place: string; date: Date | null; authorized: string }) {
  const totalGross = workers.reduce((sum, worker) => sum + worker.ukupnaM4OsnovicaCent, 0);
  const totalPio = workers.reduce((sum, worker) => sum + worker.ukupnoPioUplacenoCent, 0);

  return (
    <section className="m4-table-document m4-page-portrait m4-table-2-document">
      <CompanyHeader naziv={naziv} pib={pib} table="TABELA 2" />
      <h1>TABELARNI PRIKAZ M4 PRIJAVA ZA&nbsp;&nbsp; <u>{godina}</u>&nbsp;&nbsp; GODINU</h1>
      <table className="m4-table-2">
        <thead><tr><th>Redni<br />broj</th><th>Prezime i ime</th><th>JMBG</th><th>Za period rada<br />od - do</th><th>Bruto zarada,<br />naknada zarade</th><th>Iznos uplaćenog<br />doprinosa PIO</th></tr><tr className="m4-column-numbers">{Array.from({ length: 6 }, (_, index) => <th key={index}>{index + 1}</th>)}</tr></thead>
        <tbody>
          {workers.map((worker, index) => <tr key={worker.radnikId}><td>{index + 1}.</td><td>{worker.imePrezime}</td><td>{worker.identifikator}</td><td>{formatM4Date(worker.periodOd)} - {formatM4Date(worker.periodDo)}</td><td>{formatM4Money(worker.ukupnaM4OsnovicaCent, false)}</td><td>{formatM4Money(worker.ukupnoPioUplacenoCent, false)}</td></tr>)}
          <tr className="m4-total-row"><td></td><td>UKUPNO:</td><td></td><td></td><td>{formatM4Money(totalGross, false)}</td><td>{formatM4Money(totalPio, false)}</td></tr>
        </tbody>
      </table>
      <Signature place={place} date={date} authorized={authorized} />
    </section>
  );
}

export default async function M4PrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const type = params?.tip === "tabela-1" || params?.tip === "tabela-2" ? params.tip : "obrazac";
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return <main className="print-page"><p>Izaberite firmu i poslovnu godinu prije pregleda M-4.</p></main>;
  }

  const allowed = await hasPermission(user, { firmaId: workContext.firmaId, modul: "plate", akcija: "view" });

  if (!allowed) {
    return <main className="print-page"><p>Nemate pravo za štampu M-4 evidencije.</p></main>;
  }

  const [firma, godina] = await Promise.all([
    prisma.firma.findFirst({
      where: { id: workContext.firmaId, agencija_id: user.agencija_id, is_deleted: false },
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
          select: { ime_prezime: true }
        }
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: workContext.poslovnaGodinaId, firma_id: workContext.firmaId },
      select: { id: true, godina: true }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const data = await getM4Data({ agencijaId: user.agencija_id, firmaId: workContext.firmaId, poslovnaGodinaId: godina.id, godina: godina.godina });
  const municipalitySurtax = await findMunicipalitySurtax(
    firma.opstina ?? firma.grad,
    new Date(Date.UTC(godina.godina, 11, 31))
  );
  const worker = data.report.workers.find((item) => item.radnikId === params?.radnik) ?? data.report.workers[0];
  const municipalityName = municipalitySurtax?.opstina ?? firma.opstina ?? firma.grad ?? "";
  const municipalityCode = municipalitySurtax?.djp_sifra ?? "";
  const place = municipalityName;
  const authorized = firma.odgovorna_lica[0]?.ime_prezime ?? "";
  const date = printDate();
  const buttonLabel = type === "tabela-1" ? "Štampaj Tabelu 1" : type === "tabela-2" ? "Štampaj Tabelu 2" : "Štampaj M-4";
  const companyPrintBlocked = Boolean(
      !firma.pib ||
      !firma.adresa ||
      !(firma.opstina || firma.grad) ||
      !municipalityCode ||
      !authorized
  );
  const workerPrintBlocked =
    type === "obrazac"
      ? !worker || worker.blockers.length > 0
      : type === "tabela-2"
        ? data.report.workers.some((item) => item.blockers.length > 0)
        : false;
  const printBlocked = companyPrintBlocked || workerPrintBlocked;

  return (
    <main className="print-page m4-print-page">
      <div className="print-toolbar m4-print-toolbar">
        <Link className="print-button print-link-button" href="/agencija/plate/obrasci/m4">Nazad</Link>
        {printBlocked ? <span className="status-pill status-pill--warning">Štampa je blokirana dok se ne otklone kontrole.</span> : <PrintButton label={buttonLabel} />}
      </div>
      {type === "tabela-1" ? <Table1 naziv={firma.naziv} pib={firma.pib ?? ""} godina={godina.godina} months={data.report.months} totals={data.report.totals} place={place} date={date} authorized={authorized} /> : null}
      {type === "tabela-2" ? <Table2 naziv={firma.naziv} pib={firma.pib ?? ""} godina={godina.godina} workers={data.report.workers} place={place} date={date} authorized={authorized} /> : null}
      {type === "obrazac" && worker ? <M4Form worker={worker} firma={firma} godina={godina.godina} place={place} date={date} authorized={authorized} municipalityName={municipalityName} municipalityCode={municipalityCode} /> : null}
      {type === "obrazac" && !worker ? <section className="m4-official-document m4-page-portrait"><p>Nema osiguranika sa M-4 stavkama za izabranu godinu.</p></section> : null}
    </main>
  );
}
