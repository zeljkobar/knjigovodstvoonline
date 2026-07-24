import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { findMunicipalitySurtax } from "@/lib/municipalities";
import { hasPermission } from "@/lib/permissions";
import {
  buildOppndMonthData,
  getOppndCalculationsForMonth
} from "@/lib/payroll-oppnd";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    godina?: string;
    mjesec?: string;
  }>;
};

function parseIntParam(value: string | undefined) {
  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : null;
}

function formMoney(cents: number) {
  if (!cents) {
    return "";
  }

  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false
  });
}

function formRate(value: number | null, hasTax: boolean) {
  if (value === null || !hasTax) {
    return "";
  }

  return `${(value * 100).toLocaleString("sr-Latn-ME", {
    maximumFractionDigits: 2
  })}%`;
}

function cityName(value: string | null | undefined) {
  return String(value ?? "")
    .split(",")[0]
    ?.trim()
    .toUpperCase();
}

export default async function OppndPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const godina = parseIntParam(params?.godina);
  const mjesec = parseIntParam(params?.mjesec);
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (
    !user.agencija_id ||
    !workContext.firmaId ||
    !workContext.poslovnaGodinaId ||
    !godina ||
    !mjesec ||
    mjesec < 1 ||
    mjesec > 12
  ) {
    return (
      <main className="print-page">
        <p>Izaberite firmu, poslovnu godinu i mjesec prije pregleda OPP-ND.</p>
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
        <p>Nemate pravo za štampu OPP-ND obrasca.</p>
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
        sifra_djelatnosti: true,
        adresa: true,
        opstina: true,
        grad: true,
        telefon: true,
        odgovorna_lica: {
          where: {
            uloga: "IZVRSNI_DIREKTOR",
            aktivan: true,
            is_deleted: false
          },
          orderBy: [
            {
              primarno: "desc"
            },
            {
              created_at: "asc"
            }
          ],
          take: 1,
          select: {
            ime_prezime: true,
            jmbg: true,
            telefon: true
          }
        }
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
    getOppndCalculationsForMonth({
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

  const municipality = await findMunicipalitySurtax(
    firma.opstina ?? firma.grad,
    new Date(Date.UTC(godina, mjesec, 0))
  );
  const report = buildOppndMonthData(
    godina,
    mjesec,
    calculations,
    municipality ? Number(municipality.stopa) : null
  );
  const director = firma.odgovorna_lica[0] ?? null;
  const city = cityName(firma.grad ?? firma.opstina);
  const phone = director?.telefon ?? firma.telefon ?? "";
  const activityCode = String(firma.sifra_djelatnosti ?? "").replace(/\D/g, "");

  return (
    <main className="print-page oppnd-print-page">
      <div className="print-toolbar">
        <Link
          className="print-button print-link-button"
          href="/agencija/plate/obrasci/opp-nd"
        >
          Nazad
        </Link>
        <PrintButton label="Štampaj OPP-ND" />
      </div>

      <section className="oppnd-document">
        <div className="oppnd-form-code">Obrazac OPP-ND</div>

        <h1>
          MJESEČNA PRIJAVA ZA OBRAČUN PRIREZA POREZU NA DOHODAK FIZIČKIH LICA
        </h1>

        <table className="oppnd-company-table">
          <tbody>
            <tr>
              <th>1.</th>
              <td>
                <span>Obračunski period</span>
                <div className="oppnd-period-line">
                  <span>
                    Mjesec: <strong>{String(mjesec).padStart(2, "0")}</strong>
                  </span>
                  <span>
                    Godina: <strong>{godina}</strong>
                  </span>
                </div>
              </td>
              <th>2.</th>
              <td>
                <span>Poreski identifikacioni broj</span>
                <strong>{firma.pib ?? ""}</strong>
              </td>
            </tr>
            <tr>
              <th>3.</th>
              <td>
                <span>Naziv (pravno lice), prezime i ime (fizičko lice)</span>
                <strong>{firma.naziv.toUpperCase()}</strong>
              </td>
              <th>4.</th>
              <td>
                <span>Šifra djelatnosti</span>
                <strong>{activityCode}</strong>
              </td>
            </tr>
            <tr>
              <th>5.</th>
              <td colSpan={3}>
                <span>Adresa</span>
                <div className="oppnd-address-line">
                  <span>
                    Ulica: <strong>{(firma.adresa ?? "").toUpperCase()}</strong>
                  </span>
                  <span>Broj:</span>
                  <span>
                    Grad: <strong>{city}</strong>
                  </span>
                  <span>
                    Telefon: <strong>{firma.telefon ?? ""}</strong>
                  </span>
                </div>
              </td>
            </tr>
            <tr>
              <th>6.</th>
              <td colSpan={3}>
                <div className="oppnd-authorized-line">
                  <span>Ovlašćeno lice</span>
                  <span>
                    PIB: <strong>{director?.jmbg ?? ""}</strong>
                  </span>
                </div>
                <div className="oppnd-authorized-line">
                  <span>
                    Prezime i ime:
                    <strong>{director?.ime_prezime.toUpperCase() ?? ""}</strong>
                  </span>
                  <span>
                    Adresa: <strong>{(firma.adresa ?? "").toUpperCase()}</strong>
                  </span>
                  <span>
                    Telefon: <strong>{phone}</strong>
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="oppnd-tax-table">
          <thead>
            <tr>
              <th>Rb</th>
              <th>VRSTA POREZA</th>
              <th>IZNOS POREZA</th>
              <th>
                Stopa prireza
                <br />
                {city}
              </th>
              <th>IZNOS PRIREZA</th>
            </tr>
            <tr>
              <th>1</th>
              <th>2</th>
              <th>3</th>
              <th>4</th>
              <th>5 (3*4)</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.redniBroj}>
                <th>{row.redniBroj}.</th>
                <td>{row.naziv}</td>
                <td>{formMoney(row.porezCent)}</td>
                <td>{formRate(row.stopaPrireza, row.porezCent > 0)}</td>
                <td>{formMoney(row.prirezCent)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="oppnd-declaration">
          <strong>
            Izjavljujem pod punom materijalnom i krivičnom odgovornošću da su
            navedeni podaci tačni.
          </strong>
          <div className="oppnd-signature-row">
            <span>
              Datum podnošenja prijave:
              <i />
            </span>
            <b>M.P.</b>
            <span className="oppnd-signature">
              <i />
              <small>(potpis ovlašćenog lica)</small>
            </span>
          </div>
        </section>

        <section className="oppnd-tax-office">
          <strong>Popunjava poreski organ</strong>
          <div>
            <span>Broj dokumenta: <i /></span>
            <span>Datum prijema: <i /></span>
            <span>Datum obrade: <i /></span>
          </div>
          <div>
            <span>Prezime i ime ovlašćenog službenika: <i /></span>
            <span>Potpis: <i /></span>
          </div>
        </section>
      </section>
    </main>
  );
}
