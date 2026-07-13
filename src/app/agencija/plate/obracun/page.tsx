import {
  addPayrollCalculationLine,
  calculatePayrollCalculation,
  createPayrollCalculation,
  preparePayrollCalculation,
  updatePayrollCalculationLine
} from "../actions";
import { getPlateContext, MissingPlateContext } from "../_shared";
import { dateInputValue, money, payrollStatuses, payrollStatusLabel } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    obracun?: string;
    poruka?: string;
    radnik?: string;
  }>;
};

const messages: Record<string, string> = {
  obracun_dodat: "Obračun je dodat.",
  obracun_pripremljen: "Radnici su pripremljeni za obračun. Sada možete mijenjati stavke prije obrade.",
  obracun_obradjen: "Obračun je obrađen.",
  obracun_nevalidan: "Podaci obračuna nisu ispravni.",
  obracun_obavezan: "Izaberite obračun.",
  obracun_zakljucan: "Zaključan ili proknjižen obračun nije moguće mijenjati.",
  radnici_prazno: "Nema aktivnih zaposlenih za obračun.",
  stavka_sacuvana: "Stavka je sačuvana. Obračun je vraćen u nacrt dok ga ponovo ne obradite.",
  stavka_dodata: "Dodatna stavka je dodata.",
  stavka_nevalidna: "Podaci stavke nisu ispravni.",
  kontekst: "Izaberite firmu i poslovnu godinu.",
  prava: "Nemate pravo za rad sa platama.",
  godina_zakljucena: "Poslovna godina je zaključana."
};

function monthDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function moneyInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function decimalInput(value: { toString(): string } | null | undefined) {
  return value?.toString() ?? "";
}

export default async function PayrollCalculationPage({ searchParams }: PageProps) {
  const context = await getPlateContext("view");
  const params = await searchParams;
  const message = params?.poruka ? messages[params.poruka] : null;

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="Obračun plata" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled obračuna plata.</p>
      </section>
    );
  }

  const [calculations, incomeTypes, calculationTypes] = await Promise.all([
    prisma.plateObracun.findMany({
      where: {
        agencija_id: context.user.agencija_id,
        firma_id: context.firma.id,
        poslovna_godina_id: context.godina.id,
        is_deleted: false
      },
      orderBy: [
        {
          godina: "desc"
        },
        {
          mjesec: "desc"
        },
        {
          broj: "desc"
        }
      ],
      include: {
        _count: {
          select: {
            stavke: true,
            radnici: true
          }
        }
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
    prisma.plateVrstaObracuna.findMany({
      where: {
        aktivan: true
      },
      orderBy: {
        naziv: "asc"
      }
    })
  ]);
  const selected = calculations.find((item) => item.id === params?.obracun) ?? calculations[0] ?? null;
  const [lines, employees, calculationWorkers] = selected
    ? await Promise.all([
        prisma.plateObracunStavka.findMany({
          where: {
            obracun_id: selected.id,
            agencija_id: context.user.agencija_id,
            firma_id: context.firma.id
          },
          orderBy: [
            {
              redni_broj: "asc"
            },
            {
              created_at: "asc"
            }
          ]
        }),
        prisma.plateRadnik.findMany({
          where: {
            agencija_id: context.user.agencija_id,
            firma_id: context.firma.id,
            is_deleted: false
          },
          select: {
            id: true,
            ime: true,
            prezime: true,
            jmbg: true,
            radno_mjesto: true
          }
        }),
        prisma.plateObracunRadnik.findMany({
          where: {
            obracun_id: selected.id,
            agencija_id: context.user.agencija_id,
            firma_id: context.firma.id
          },
          orderBy: {
            created_at: "asc"
          }
        })
      ])
    : [[], [], []];
  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const selectedWorkerId =
    params?.radnik && lines.some((line) => line.radnik_id === params.radnik)
      ? params.radnik
      : lines[0]?.radnik_id ?? calculationWorkers[0]?.radnik_id ?? null;
  const selectedWorker = selectedWorkerId ? employeesById.get(selectedWorkerId) : null;
  const selectedLines = selectedWorkerId ? lines.filter((line) => line.radnik_id === selectedWorkerId) : [];
  const editable = selected
    ? ![payrollStatuses.posted, payrollStatuses.locked].includes(selected.status as never)
    : false;
  const totals = lines.reduce(
    (sum, line) => ({
      neto: sum.neto + line.neto_cent,
      bruto: sum.bruto + line.bruto_cent,
      porez: sum.porez + line.porez_cent,
      doprinosiZaposleni: sum.doprinosiZaposleni + line.doprinosi_zaposleni_cent,
      doprinosiPoslodavac: sum.doprinosiPoslodavac + line.doprinosi_poslodavac_cent,
      trosak: sum.trosak + line.ukupni_trosak_cent
    }),
    {
      neto: 0,
      bruto: 0,
      porez: 0,
      doprinosiZaposleni: 0,
      doprinosiPoslodavac: 0,
      trosak: 0
    }
  );
  const defaultMonth = new Date().getUTCMonth() + 1;
  const defaultYear = context.godina.godina;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Obračun plata</h2>
          <p>
            {context.firma.naziv} / {context.godina.godina}
          </p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>Novi obračun</h3>
        <form className="admin-form" action={createPayrollCalculation}>
          <label>
            <span>Vrsta obračuna</span>
            <input name="oznaka" defaultValue="Redovan rad" />
          </label>
          <label>
            <span>Mjesec</span>
            <input name="mjesec" type="number" defaultValue={defaultMonth} min="1" max="12" required />
          </label>
          <label>
            <span>Godina</span>
            <input name="godina" type="number" defaultValue={defaultYear} required />
          </label>
          <label>
            <span>Datum od</span>
            <input name="datum_od" type="date" defaultValue={monthDate(defaultYear, defaultMonth, 1)} required />
          </label>
          <label>
            <span>Datum do</span>
            <input name="datum_do" type="date" defaultValue={monthDate(defaultYear, defaultMonth + 1, 0)} required />
          </label>
          <label>
            <span>Datum obračuna</span>
            <input name="datum_obracuna" type="date" defaultValue={monthDate(defaultYear, defaultMonth + 1, 0)} required />
          </label>
          <label>
            <span>Datum isplate</span>
            <input name="datum_isplate" type="date" />
          </label>
          <label>
            <span>Fond sati</span>
            <input name="fond_sati" type="number" defaultValue="176" min="1" required />
          </label>
          <label className="single-checkbox form-checkbox">
            <input name="koristi_minuli_rad" type="checkbox" />
            <span>Koristi minuli rad</span>
          </label>
          <label>
            <span>Napomena</span>
            <textarea name="napomena" rows={3} />
          </label>
          <button type="submit">Kreiraj obračun</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Obračuni</h3>
          <span>{calculations.length} ukupno</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Broj</th>
                <th>Period</th>
                <th>Vrsta</th>
                <th>Fond sati</th>
                <th>Status</th>
                <th>Radnici</th>
                <th>Stavke</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {calculations.length === 0 ? (
                <tr>
                  <td colSpan={8}>Nema obračuna.</td>
                </tr>
              ) : (
                calculations.map((calculation) => (
                  <tr key={calculation.id}>
                    <td>{calculation.broj}</td>
                    <td>
                      {calculation.mjesec}/{calculation.godina}
                      <small>
                        {dateInputValue(calculation.datum_od)} - {dateInputValue(calculation.datum_do)}
                      </small>
                    </td>
                    <td>{calculation.oznaka ?? calculation.kategorija}</td>
                    <td>{calculation.fond_sati}</td>
                    <td>{payrollStatusLabel(calculation.status)}</td>
                    <td>{calculation._count.radnici}</td>
                    <td>{calculation._count.stavke}</td>
                    <td>
                      <a className="table-link" href={`/agencija/plate/obracun?obracun=${calculation.id}`}>
                        Otvori
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h3>
                Obračun {selected.broj} / {selected.godina}
              </h3>
              <span>
                {selected.oznaka ?? selected.kategorija} - {payrollStatusLabel(selected.status)}
              </span>
            </div>
            <div className="button-row">
              {lines.length === 0 && editable ? (
                <form action={preparePayrollCalculation}>
                  <input name="obracun_id" type="hidden" value={selected.id} />
                  <button className="secondary-button" type="submit">
                    Pripremi radnike
                  </button>
                </form>
              ) : null}
              {editable ? (
                <form action={calculatePayrollCalculation}>
                  <input name="obracun_id" type="hidden" value={selected.id} />
                  <button className="primary-button" type="submit">
                    Obradi
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span>Neto</span>
              <strong>{money(totals.neto)}</strong>
            </div>
            <div className="stat-card">
              <span>Bruto</span>
              <strong>{money(totals.bruto)}</strong>
            </div>
            <div className="stat-card">
              <span>Porez</span>
              <strong>{money(totals.porez)}</strong>
            </div>
            <div className="stat-card">
              <span>Dopr. zaposleni</span>
              <strong>{money(totals.doprinosiZaposleni)}</strong>
            </div>
            <div className="stat-card">
              <span>Dopr. poslodavac</span>
              <strong>{money(totals.doprinosiPoslodavac)}</strong>
            </div>
            <div className="stat-card">
              <span>Ukupan trošak</span>
              <strong>{money(totals.trosak)}</strong>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="empty-state">
              Obračun još nema radnike. Kliknite Pripremi radnike da napravite mjesečne stavke za korekcije.
            </p>
          ) : (
            <div className="payroll-workspace">
              <aside className="payroll-worker-list">
                <h4>Radnici u obračunu</h4>
                {calculationWorkers.map((worker) => {
                  const employee = employeesById.get(worker.radnik_id);
                  const workerLines = lines.filter((line) => line.radnik_id === worker.radnik_id);
                  const workerTotal = workerLines.reduce((sum, line) => sum + line.neto_cent, 0);
                  const isSelected = worker.radnik_id === selectedWorkerId;

                  return (
                    <a
                      className={`payroll-worker-link${isSelected ? " active" : ""}`}
                      href={`/agencija/plate/obracun?obracun=${selected.id}&radnik=${worker.radnik_id}`}
                      key={worker.id}
                    >
                      <strong>{employee ? `${employee.prezime} ${employee.ime}` : "Radnik"}</strong>
                      <span>
                        {workerLines.length} stavki / {worker.status === payrollStatuses.calculated ? "obračunat" : "nacrt"}
                      </span>
                      <small>Neto {money(workerTotal)}</small>
                    </a>
                  );
                })}
              </aside>

              <div className="payroll-worker-detail">
                <div className="panel-header compact-panel-header">
                  <div>
                    <h4>{selectedWorker ? `${selectedWorker.prezime} ${selectedWorker.ime}` : "Radnik"}</h4>
                    <span>{selectedWorker?.radno_mjesto ?? selectedWorker?.jmbg ?? "Mjesečne stavke"}</span>
                  </div>
                </div>

                <div className="payroll-line-stack">
                  {selectedLines.map((line) => (
                    <section className="embedded-panel" key={line.id}>
                      <div className="panel-header compact-panel-header">
                        <div>
                          <h4>
                            {line.sifra_primanja} - {line.naziv_primanja}
                          </h4>
                          <span>{line.status === payrollStatuses.calculated ? "Obračunato" : "Nacrt / izmjena"}</span>
                        </div>
                        <strong>{money(line.neto_cent || line.input_neto_cent)}</strong>
                      </div>
                      <form className="admin-form payroll-line-form" action={updatePayrollCalculationLine}>
                        <input name="obracun_id" type="hidden" value={selected.id} />
                        <input name="stavka_id" type="hidden" value={line.id} />
                        <label>
                          <span>Šifra primanja</span>
                          <select name="sifra_primanja_id" defaultValue={line.sifra_primanja_id}>
                            {incomeTypes.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.sifra} - {type.naziv}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Vrsta obračuna</span>
                          <select name="vrsta_obracuna_id" defaultValue={line.vrsta_obracuna_id}>
                            {calculationTypes.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.naziv}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Sati</span>
                          <input name="ukupno_sati" type="number" defaultValue={line.ukupno_sati} min="0" />
                        </label>
                        <label>
                          <span>Neto input</span>
                          <input name="input_neto" defaultValue={moneyInput(line.input_neto_cent)} />
                        </label>
                        <label>
                          <span>Bruto input</span>
                          <input name="input_bruto" defaultValue={moneyInput(line.input_bruto_cent)} />
                        </label>
                        <label>
                          <span>Fiksni dio</span>
                          <input name="fiksni_dio" defaultValue={moneyInput(line.fiksni_dio_cent)} />
                        </label>
                        <label>
                          <span>Koeficijent</span>
                          <input
                            name="koeficijent_slozenosti"
                            type="number"
                            step="0.000001"
                            defaultValue={decimalInput(line.koeficijent_slozenosti)}
                          />
                        </label>
                        <label>
                          <span>Koef. minulog rada</span>
                          <input
                            name="koeficijent_minuli_rad"
                            type="number"
                            step="0.0001"
                            defaultValue={decimalInput(line.koeficijent_minuli_rad)}
                          />
                        </label>
                        <label className="single-checkbox form-checkbox">
                          <input name="koristi_minuli_rad" type="checkbox" defaultChecked={line.koristi_minuli_rad} />
                          <span>Minuli rad</span>
                        </label>
                        <button type="submit">Sačuvaj izmjenu</button>
                      </form>

                      <div className="table-wrap payroll-result-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Bruto</th>
                              <th>Porez</th>
                              <th>PIO</th>
                              <th>Nezaposl.</th>
                              <th>Poslodavac</th>
                              <th>Trošak</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>{money(line.bruto_cent)}</td>
                              <td>{money(line.porez_cent)}</td>
                              <td>{money(line.zaposleni_pio_cent)}</td>
                              <td>{money(line.zaposleni_nezaposleni_cent)}</td>
                              <td>{money(line.doprinosi_poslodavac_cent)}</td>
                              <td>{money(line.ukupni_trosak_cent)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>

                {selectedWorkerId && editable ? (
                  <section className="embedded-panel">
                    <h4>Dodaj stavku radniku</h4>
                    <form className="admin-form payroll-line-form" action={addPayrollCalculationLine}>
                      <input name="obracun_id" type="hidden" value={selected.id} />
                      <input name="radnik_id" type="hidden" value={selectedWorkerId} />
                      <label>
                        <span>Šifra primanja</span>
                        <select name="sifra_primanja_id">
                          {incomeTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.sifra} - {type.naziv}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Vrsta obračuna</span>
                        <select name="vrsta_obracuna_id">
                          {calculationTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.naziv}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Sati</span>
                        <input name="ukupno_sati" type="number" defaultValue={selected.fond_sati} min="0" />
                      </label>
                      <label>
                        <span>Neto input</span>
                        <input name="input_neto" defaultValue="0.00" />
                      </label>
                      <label>
                        <span>Bruto input</span>
                        <input name="input_bruto" defaultValue="0.00" />
                      </label>
                      <label>
                        <span>Fiksni dio</span>
                        <input name="fiksni_dio" defaultValue="0.00" />
                      </label>
                      <label>
                        <span>Koeficijent</span>
                        <input name="koeficijent_slozenosti" type="number" step="0.000001" />
                      </label>
                      <label>
                        <span>Koef. minulog rada</span>
                        <input name="koeficijent_minuli_rad" type="number" step="0.0001" defaultValue="0" />
                      </label>
                      <label className="single-checkbox form-checkbox">
                        <input name="koristi_minuli_rad" type="checkbox" />
                        <span>Minuli rad</span>
                      </label>
                      <button type="submit">Dodaj stavku</button>
                    </form>
                  </section>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
