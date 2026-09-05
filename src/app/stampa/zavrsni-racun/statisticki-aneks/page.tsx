import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { calculateStatisticalAnnex } from "@/lib/financial-reports";
import { hasAllPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function displayDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME");
}

function amount(value: number) {
  if (Math.abs(value) < 0.005) {
    return "";
  }

  return Math.round(value).toLocaleString("sr-Latn");
}

function digits(value: string | null | undefined, length: number) {
  const clean = (value ?? "").replace(/\D/g, "").slice(0, length);
  return Array.from({ length }, (_, index) => clean[index] ?? "");
}

export default async function StatistickiAneksPrintPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <main className="print-page">
        <section className="financial-print-document">
          <p>Izaberite firmu i poslovnu godinu prije štampe.</p>
        </section>
      </main>
    );
  }

  const allowed = await hasAllPermissions(user, [
    { firmaId: workContext.firmaId, modul: "zavrsni_racun", akcija: "view" },
    { firmaId: workContext.firmaId, modul: "zavrsni_racun", akcija: "export" }
  ]);

  if (!allowed) {
    return (
      <main className="print-page">
        <section className="financial-print-document">
          <p>Nemate pravo za štampu završnog računa.</p>
        </section>
      </main>
    );
  }

  const [firma, godina, result] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false
      },
      select: {
        naziv: true,
        pib: true,
        maticni_broj: true,
        sifra_djelatnosti: true,
        pravna_forma: true,
        grad: true,
        opstina: true,
        drzava: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        datum_do: true
      }
    }),
    calculateStatisticalAnnex({
      agencijaId: user.agencija_id,
      firmaId: workContext.firmaId,
      poslovnaGodinaId: workContext.poslovnaGodinaId
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const registrationDigits = digits(firma.maticni_broj, 13);
  const activityDigits = digits(firma.sifra_djelatnosti, 4);
  const pibDigits = digits(firma.pib, 9);
  const formLabel = firma.pravna_forma ?? "";

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <PrintButton label="Štampaj" />
      </div>
      <section className="financial-print-document statistical-print-document">
        <header className="statistical-print-header">
          <div className="statistical-emblem">CG</div>
          <div>
            <h1>STATISTIČKI ANEKS</h1>
            <p>na dan {displayDate(godina.datum_do)} godine</p>
          </div>
          <span>OBRAZAC</span>
        </header>

        <h2>STATISTIČKI ANEKS</h2>
        <section className="statistical-legal-box">
          <div>Popunjava pravno lice</div>
          <div className="statistical-code-row">
            <div className="statistical-code-cells">
              {registrationDigits.map((digit, index) => (
                <span key={`mb-${index}`}>{digit}</span>
              ))}
            </div>
            <div className="statistical-code-cells short">
              {activityDigits.map((digit, index) => (
                <span key={`sd-${index}`}>{digit}</span>
              ))}
            </div>
            <div className="statistical-code-cells medium">
              {pibDigits.map((digit, index) => (
                <span key={`pib-${index}`}>{digit}</span>
              ))}
            </div>
          </div>
          <div className="statistical-label-row">
            <span>Matični broj</span>
            <span>Šifra djelatnosti</span>
            <span>PIB</span>
          </div>
          <div>Popunjava:</div>
        </section>

        <section className="statistical-company-box">
          <p>Naziv: {firma.naziv}</p>
          <p>Sjedište: {firma.grad ?? firma.opstina ?? firma.drzava ?? ""}</p>
          <p>Navesti tekstualno pretežnu djelatnost kojom se bavili tokom godine:</p>
        </section>

        <section className="statistical-options">
          {["AD", "DOO", "KD", "OD", "DSD", "preduzetnik", "ostalo"].map((label) => (
            <span key={label}>
              <i>{formLabel.toUpperCase().includes(label.toUpperCase()) ? "x" : ""}</i>
              {label}
            </span>
          ))}
        </section>
        <section className="statistical-size-options">
          {["malo pravno lice", "srednje pravno lice", "veliko pravno lice"].map((label) => (
            <span key={label}>
              <i />
              {label}
            </span>
          ))}
        </section>

        <table className="income-print-table statistical-annex-table">
          <thead>
            <tr>
              <th>Grupa računa, račun</th>
              <th>POZICIJA</th>
              <th>Red. broj</th>
              <th>Napomena broj</th>
              <th colSpan={2}>Iznos</th>
            </tr>
            <tr>
              <th />
              <th />
              <th />
              <th />
              <th>Tekuća godina</th>
              <th>Prethodna godina</th>
            </tr>
            <tr className="income-print-column-numbers">
              <th>1</th>
              <th>2</th>
              <th>3</th>
              <th>4</th>
              <th>5</th>
              <th>6</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id} className={row.bold ? "income-bold-row" : undefined}>
                <td>{row.uslov ?? ""}</td>
                <td>{row.pozicija}</td>
                <td>{row.aop ?? ""}</td>
                <td>{row.aop ?? ""}</td>
                <td>{amount(row.tekucaGodina)}</td>
                <td>{amount(row.prethodnaGodina)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="income-print-footer statistical-print-footer">
          <div className="income-signatures">
            <div>
              <span>U</span>
              <span className="signature-line" />
              <p>Dana&nbsp;&nbsp; {displayDate(new Date())}</p>
            </div>
            <div>
              <p>Lice odgovorno za sastavljanje finansijskih iskaza</p>
              <p>------------------------------------------</p>
            </div>
            <div className="stamp-box">M.P.</div>
            <div>
              <p>Odgovorno lice</p>
              <strong>&nbsp;</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
