import { getPlateContext, MissingPlateContext } from "../_shared";
import { prisma } from "@/lib/prisma";

export default async function PayrollSettingsPage() {
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="Podešavanja plata" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled podešavanja plata.</p>
      </section>
    );
  }

  const [ioppdCodes, calculationTypes, incomeTypes, taxBrackets, contributionRates, surtaxRates] =
    await Promise.all([
      prisma.plateIoppdSifra.findMany({
        where: {
          aktivan: true
        },
        orderBy: {
          sifra: "asc"
        }
      }),
      prisma.plateVrstaObracuna.findMany({
        where: {
          aktivan: true
        },
        orderBy: {
          naziv: "asc"
        }
      }),
      prisma.plateSifraPrimanja.findMany({
        where: {
          aktivan: true,
          OR: [
            {
              agencija_id: context.user.agencija_id,
              firma_id: context.firma.id
            },
            {
              agencija_id: context.user.agencija_id,
              firma_id: null
            },
            {
              agencija_id: null,
              firma_id: null
            }
          ]
        },
        orderBy: {
          sifra: "asc"
        }
      }),
      prisma.platePorezRazred.findMany({
        where: {
          aktivan: true
        },
        orderBy: {
          bruto_od: "asc"
        }
      }),
      prisma.plateDoprinosStopa.findMany({
        where: {
          aktivan: true
        },
        orderBy: {
          sifra: "asc"
        }
      }),
      prisma.platePrirezStopa.findMany({
        where: {
          aktivan: true
        },
        orderBy: {
          opstina: "asc"
        }
      })
    ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja plata</h2>
          <p>Početni sistemski šifarnici za MVP obračun zarade 001.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Šifre primanja</h3>
          <span>{incomeTypes.length} aktivno</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Kategorija</th>
                <th>Osnovica</th>
                <th>IOPPD</th>
              </tr>
            </thead>
            <tbody>
              {incomeTypes.map((item) => (
                <tr key={item.id}>
                  <td>{item.sifra}</td>
                  <td>{item.naziv}</td>
                  <td>{item.kategorija}</td>
                  <td>{item.osnovica_tip}</td>
                  <td>{item.prikazi_na_ioppd ? "Da" : "Ne"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Vrste obračuna</h3>
          <span>{calculationTypes.length} aktivno</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Ulaz</th>
                <th>Algoritam</th>
                <th>Minuli rad</th>
              </tr>
            </thead>
            <tbody>
              {calculationTypes.map((item) => (
                <tr key={item.id}>
                  <td>{item.sifra}</td>
                  <td>{item.naziv}</td>
                  <td>{item.input_type}</td>
                  <td>{item.algoritam}</td>
                  <td>{item.koristi_minuli_rad ? "Da" : "Ne"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>IOPPD šifre</h3>
          <span>{ioppdCodes.length} seed</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Šifra</th>
                <th>Naziv</th>
                <th>Kategorija</th>
              </tr>
            </thead>
            <tbody>
              {ioppdCodes.map((item) => (
                <tr key={item.id}>
                  <td>{item.sifra}</td>
                  <td>{item.naziv}</td>
                  <td>{item.kategorija ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Porezi i doprinosi</h3>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tip</th>
                <th>Šifra/opština</th>
                <th>Naziv</th>
                <th>Osnovica</th>
                <th>Stopa</th>
              </tr>
            </thead>
            <tbody>
              {taxBrackets.map((item) => (
                <tr key={item.id}>
                  <td>Porez</td>
                  <td>{item.sifra}</td>
                  <td>{item.naziv}</td>
                  <td>
                    {(item.bruto_od / 100).toFixed(2)} -{" "}
                    {item.bruto_do ? (item.bruto_do / 100).toFixed(2) : "∞"}
                  </td>
                  <td>{(Number(item.stopa) * 100).toFixed(2)}%</td>
                </tr>
              ))}
              {contributionRates.map((item) => (
                <tr key={item.id}>
                  <td>{item.payer_type}</td>
                  <td>{item.sifra}</td>
                  <td>{item.naziv}</td>
                  <td>Bruto</td>
                  <td>{(Number(item.stopa) * 100).toFixed(2)}%</td>
                </tr>
              ))}
              {surtaxRates.map((item) => (
                <tr key={item.id}>
                  <td>Prirez</td>
                  <td>{item.opstina}</td>
                  <td>Prirez po opštini</td>
                  <td>Porez</td>
                  <td>{(Number(item.stopa) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
