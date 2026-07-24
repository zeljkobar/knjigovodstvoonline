import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  buildIoppdMonthData,
  buildIoppdReportLines,
  getIoppdCalculationsForMonth,
  totalIoppdReportLines
} from "@/lib/payroll-ioppd";
import { money } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    godina?: string;
    mjesec?: string;
  }>;
};

function displayDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function parseIntParam(value: string | undefined) {
  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : null;
}

function digitCharacters(value: string | number | null | undefined, length: number) {
  const raw = String(value ?? "").replace(/\D/g, "");
  const padded = raw.length > length ? raw.slice(0, length) : raw.padEnd(length, " ");

  return padded.split("");
}

function DigitBoxes({
  value,
  length,
  className = ""
}: {
  value: string | number | null | undefined;
  length: number;
  className?: string;
}) {
  return (
    <span className={`ioppd-digit-boxes ${className}`}>
      {digitCharacters(value, length).map((digit, index) => (
        <span key={index}>{digit.trim() ? digit : "\u00a0"}</span>
      ))}
    </span>
  );
}

export default async function IoppdPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const godina = parseIntParam(params?.godina);
  const mjesec = parseIntParam(params?.mjesec);
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId || !godina || !mjesec) {
    return (
      <main className="print-page">
        <section className="ioppd-document ioppd-document-portrait">
          <p>Izaberite firmu, poslovnu godinu i mjesec prije štampe.</p>
        </section>
      </main>
    );
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "plate",
    akcija: "view"
  });

  if (!allowed) {
    return (
      <main className="print-page">
        <section className="ioppd-document ioppd-document-portrait">
          <p>Nemate pravo za štampu IOPPD obrasca.</p>
        </section>
      </main>
    );
  }

  const [firma, poslovnaGodina, calculations] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
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
        naziv: true,
        pib: true,
        maticni_broj: true,
        adresa: true,
        opstina: true,
        grad: true,
        telefon: true,
        email: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId,
        godina
      },
      select: {
        godina: true
      }
    }),
    getIoppdCalculationsForMonth({
      agencijaId: user.agencija_id,
      firmaId: workContext.firmaId,
      poslovnaGodinaId: workContext.poslovnaGodinaId,
      godina,
      mjesec
    })
  ]);

  if (!firma || !poslovnaGodina) {
    return null;
  }

  const report = buildIoppdMonthData(godina, mjesec, calculations);
  const reportLines = buildIoppdReportLines(report);
  const reportTotals = totalIoppdReportLines(reportLines);
  const agencyUnit = (firma.opstina ?? firma.grad ?? "").toUpperCase();
  const companyTaxId = firma.pib ?? firma.maticni_broj ?? "";
  const submitterTaxId = report.lines[0]?.jmbg ?? "";

  return (
    <main className="print-page ioppd-print-page">
      <div className="print-toolbar ioppd-print-toolbar">
        <Link className="print-button print-link-button" href="/agencija/plate/obrasci/ioppd">
          Nazad
        </Link>
        <PrintButton label="Štampaj IOPPD" />
      </div>

      <section className="ioppd-document ioppd-document-portrait">
        <header className="ioppd-official-header">
          <div className="ioppd-office-block">
            <p>Crna Gora</p>
            <p>Poreska uprava</p>
            <p>
              Područna jedinica <span>{agencyUnit}</span>
            </p>
          </div>
          <div className="ioppd-official-title">
            <strong>Obrazac IOPPD</strong>
            <span>Opšti dio</span>
          </div>
        </header>

        <h1 className="ioppd-main-title">Izvještaj o obračunatim i plaćenim porezima i doprinosima</h1>

        <section className="ioppd-official-period">
          <div className="ioppd-numbered-label">
            <span>0.1.</span>
            <strong>OBRAČUNSKI PERIOD</strong>
          </div>
          <div className="ioppd-period-boxes">
            <label>
              Mjesec
              <DigitBoxes value={String(mjesec).padStart(2, "0")} length={2} />
            </label>
            <label>
              Godina
              <DigitBoxes value={godina} length={4} />
            </label>
          </div>
        </section>

        <section className="ioppd-report-type">
          <div className="ioppd-numbered-label">
            <span>0.2.</span>
            <strong>Osnovni</strong>
          </div>
          <span className="ioppd-small-check">x</span>
          <div className="ioppd-numbered-label">
            <span>0.3.</span>
            <strong>Izmijenjeni</strong>
          </div>
          <span className="ioppd-small-check"></span>
        </section>

        <section className="ioppd-employer-section">
          <h2>1. PODACI O POSLODAVCU / ISPLATIOCU</h2>

          <div className="ioppd-form-row">
            <span>1.1.</span>
            <label>PIB:</label>
            <DigitBoxes value={companyTaxId} length={13} className="ioppd-pib-boxes" />
          </div>

          <div className="ioppd-form-row ioppd-wide-line-row">
            <span>1.2.</span>
            <label>Naziv / Prezime i ime:</label>
            <strong>{firma.naziv.toUpperCase()}</strong>
          </div>

          <div className="ioppd-form-row ioppd-wide-line-row">
            <span>1.3.</span>
            <label>Telefon kontakt osobe:</label>
            <strong>{firma.telefon ?? ""}</strong>
          </div>

          <div className="ioppd-form-row ioppd-wide-line-row">
            <span>1.4.</span>
            <label>e-mail:</label>
            <strong>{firma.email ?? ""}</strong>
          </div>
        </section>

        <section className="ioppd-declaration-box">
          <h3>Pod krivičnom odgovornošću izjavljujem da su podaci navedeni u izvještaju tačni i potpuni.</h3>
          <div className="ioppd-declaration-grid">
            <div className="ioppd-declaration-left">
              <p>
                PIB: <DigitBoxes value={submitterTaxId} length={13} />
              </p>
              <p>Potpis podnosioca/ovlašćenog lica:</p>
              <div className="ioppd-sign-line"></div>
            </div>
            <div>
              <p>Mjesto za pečat:</p>
            </div>
            <div>
              <p>Datum:</p>
              <div className="ioppd-date-line">____/____/________</div>
            </div>
          </div>
        </section>

        <section className="ioppd-tax-office-box">
          <h3>POPUNJAVA PORESKI ORGAN:</h3>
          <div className="ioppd-tax-office-grid">
            <div>
              <p>Broj dokumenta:</p>
              <div>____/____ - ____________</div>
            </div>
            <div>
              <p>Datum prijema:</p>
              <div>____/____/____________</div>
            </div>
            <div>
              <p>Datum obrade:</p>
              <div>____/____/____________</div>
            </div>
            <div>
              <p>Prezime i ime ovlašćenog službenika:</p>
              <div className="ioppd-sign-line"></div>
            </div>
          </div>
        </section>
      </section>

      <section className="ioppd-document ioppd-document-landscape">
        <header className="ioppd-landscape-official-header">
          <h1>2. POJEDINAČNI OBRAČUN POREZA I DOPRINOSA</h1>
          <span>Posebni dio</span>
        </header>

        <table className="ioppd-lines-table">
          <colgroup>
            <col className="ioppd-col-rbr" />
            <col className="ioppd-col-pib" />
            <col className="ioppd-col-name" />
            <col className="ioppd-col-code" />
            <col className="ioppd-col-date" />
            <col className="ioppd-col-date" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
            <col className="ioppd-col-money" />
          </colgroup>
          <thead>
            <tr>
              <th className="ioppd-empty-head" colSpan={8}></th>
              <th colSpan={3}>Iznos obračunatih i plaćenih doprinosa na teret osiguranika</th>
              <th colSpan={4}>Iznos obračunatih i plaćenih doprinosa na teret isplatioca</th>
            </tr>
            <tr>
              <th>Red. broj</th>
              <th>PIB lica</th>
              <th>Prezime i ime</th>
              <th>Šifra osnova za obračun</th>
              <th>Period od</th>
              <th>Period do</th>
              <th>Iznos osnovice za obračun</th>
              <th>Iznos poreza</th>
              <th>Za PIO</th>
              <th>Za zdravstveno osiguranje</th>
              <th>Za osiguranje od nezaposlenosti</th>
              <th>Za PIO</th>
              <th>Za zdravstveno osiguranje</th>
              <th>Za osiguranje od nezaposlenosti</th>
              <th>Za Fond rada</th>
            </tr>
            <tr className="ioppd-column-numbers">
              {Array.from({ length: 15 }, (_, index) => (
                <th key={index}>({index + 1})</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reportLines.map((line) => (
              <tr key={`${line.redniBroj}-${line.jmbg}-${line.sifra}`}>
                <td>{line.redniBroj}</td>
                <td>{line.jmbg}</td>
                <td>{line.imePrezime}</td>
                <td>{line.sifra}</td>
                <td>{displayDate(line.periodOd)}</td>
                <td>{displayDate(line.periodDo)}</td>
                <td>{money(line.osnovicaCent)}</td>
                <td>{money(line.porezCent)}</td>
                <td>{money(line.zaposleniPioCent)}</td>
                <td>{money(line.zaposleniZdravstvoCent)}</td>
                <td>{money(line.zaposleniNezaposleniCent)}</td>
                <td>{money(line.poslodavacPioCent)}</td>
                <td>{money(line.poslodavacZdravstvoCent)}</td>
                <td>{money(line.poslodavacNezaposleniCent)}</td>
                <td>{money(line.fondRadaCent)}</td>
              </tr>
            ))}
            {reportLines.length === 0 ? (
              <tr>
                <td colSpan={15}>Nema stavki za izabrani mjesec.</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <section className="ioppd-landscape-totals-row">
          <strong>Ukupni iznosi :</strong>
          <table>
            <tbody>
              <tr>
                <td>{money(reportTotals.osnovicaCent)}</td>
                <td>{money(reportTotals.porezCent)}</td>
                <td>{money(reportTotals.zaposleniPioCent)}</td>
                <td>{money(reportTotals.zaposleniZdravstvoCent)}</td>
                <td>{money(reportTotals.zaposleniNezaposleniCent)}</td>
                <td>{money(reportTotals.poslodavacPioCent)}</td>
                <td>{money(reportTotals.poslodavacZdravstvoCent)}</td>
                <td>{money(reportTotals.poslodavacNezaposleniCent)}</td>
                <td>{money(reportTotals.fondRadaCent)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="ioppd-invalid-contribution-section">
          <h2>Doprinos zbog nezapošljavanja lica sa invaliditetom:</h2>
          <table className="ioppd-invalid-table">
            <thead>
              <tr>
                <th>Ukupan broj zaposlenih</th>
                <th>Broj zaposlenih invalida</th>
                <th>Osnovica</th>
                <th>Stopa</th>
                <th>Iznos</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{report.employeeCount}</td>
                <td>{report.invalidEmployeeCount}</td>
                <td>0,00</td>
                <td>0%</td>
                <td>0,00</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
