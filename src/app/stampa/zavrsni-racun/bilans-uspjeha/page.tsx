import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { calculateIncomeStatement } from "@/lib/financial-reports";
import { hasPermission } from "@/lib/permissions";
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

export default async function BilansUspjehaPrintPage() {
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

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "view"
  });

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
        maticni_broj: true,
        sifra_djelatnosti: true,
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
        datum_od: true,
        datum_do: true
      }
    }),
    calculateIncomeStatement({
      agencijaId: user.agencija_id,
      firmaId: workContext.firmaId,
      poslovnaGodinaId: workContext.poslovnaGodinaId
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <PrintButton label="Štampaj" />
      </div>
      <section className="financial-print-document">
        <header className="income-print-header">
          <div className="income-title-block">
            <h1>ISKAZ O UKUPNOM REZULTATU /BILANS USPJEHA/</h1>
            <p>
              u periodu od {displayDate(godina.datum_od)} do {displayDate(godina.datum_do)} godine
            </p>
          </div>
          <div className="income-report-number">Broj iskaza</div>
        </header>

        <section className="income-legal-box">
          <div>Popunjava pravno lice</div>
          <div className="income-legal-grid">
            <span>Matični broj: {firma.maticni_broj ?? ""}</span>
            <span>Šifra djelatnosti: {firma.sifra_djelatnosti ?? ""}</span>
          </div>
          <div>Popunjava:</div>
        </section>

        <section className="income-legal-box income-company-box">
          <div>Naziv: {firma.naziv}</div>
          <div>Sjedište: {firma.grad ?? firma.opstina ?? firma.drzava ?? ""}</div>
        </section>

        <table className="income-print-table">
          <thead>
            <tr>
              <th>Grupa računa, račun</th>
              <th>POZICIJA</th>
              <th>Redni broj</th>
              <th>Napomena - broj</th>
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
                <td>{row.aop?.replace(/^A/, "") ?? ""}</td>
                <td>{row.aop ?? ""}</td>
                <td>{amount(row.tekucaGodina)}</td>
                <td>{amount(row.prethodnaGodina)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="income-print-footer">
          <p>
            Obrazac usklađen sa članom 4. Zakona o računovodstvu („Sl. list CG” broj
            052/16) i DIREKTIVOM 2013/34/EU EVROPSKOG PARLAMENTA I VIJEĆA
          </p>
          <div className="income-signatures">
            <div>
              <span>U</span>
              <span className="signature-line" />
              <p>Dana&nbsp;&nbsp; {displayDate(new Date())}</p>
            </div>
            <div>
              <p>Lice odgovorno za sastavljanje finansijskih iskaza</p>
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
