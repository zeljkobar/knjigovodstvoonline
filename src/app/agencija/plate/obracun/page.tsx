import {
  addPayrollWorkerToCalculation,
  addPayrollCalculationLine,
  calculatePayrollCalculation,
  createPayrollCalculation,
  deletePayrollCalculation,
  postPayrollCalculation,
  preparePayrollCalculation,
  removePayrollWorkerFromCalculation,
  updatePayrollCalculationLine
} from "../actions";
import { getPlateContext, MissingPlateContext } from "../_shared";
import { PayrollCalculationForm } from "./PayrollCalculationForm";
import { PayrollPeriodHoursFields } from "./PayrollPeriodHoursFields";
import {
  calculateSeniorityCoefficient,
  effectiveSeniorityYears,
  money,
  payrollCategoryLabel,
  payrollCategoryRequiresEmployment,
  payrollStatuses,
  payrollStatusLabel
} from "@/lib/payroll";
import {
  allowedPayrollPeriod,
  calculateAutomaticPayrollHours,
  employeeMonthlyScheduledHours,
  employmentOverlapsPayrollPeriod,
  isPayrollPeriodAllowed,
  normalizePayrollPeriod,
  payrollDateInputValue
} from "@/lib/payroll-hours";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    obracun?: string;
    novi?: string;
    poruka?: string;
    radnik?: string;
  }>;
};

const messages: Record<string, string> = {
  obracun_dodat: "Obračun je dodat.",
  obracun_pripremljen: "Radnici su pripremljeni za obračun. Sada možete mijenjati stavke prije obrade.",
  obracun_obradjen: "Obračun je obrađen.",
  obracun_proknjizen: "Obračun je proknjižen i nalog je kreiran.",
  obracun_nevalidan: "Podaci obračuna nisu ispravni.",
  obracun_ne_postoji: "Obračun nije pronađen u izabranoj firmi i poslovnoj godini.",
  obracun_vec_proknjizen: "Obračun je već proknjižen.",
  obracun_nije_obradjen: "Prije knjiženja obračun mora biti obrađen.",
  obracun_obavezan: "Izaberite obračun.",
  obracun_zakljucan: "Zaključan ili proknjižen obračun nije moguće mijenjati.",
  obracun_obrisan: "Obračun je obrisan.",
  kontrole_greske: "Obračun nije moguće obraditi dok postoje blokirajuće kontrole.",
  radnici_prazno: "Nema aktivnih zaposlenih za obračun.",
  radnik_dodat_u_obracun: "Radnik je dodat u obračun. Obračun je vraćen u nacrt.",
  radnik_izbacen_iz_obracuna: "Radnik je izbačen iz obračuna. Obračun je vraćen u nacrt.",
  radnik_vec_u_obracunu: "Radnik je već u ovom obračunu.",
  radnik_nevalidan: "Radnik nije ispravan za ovaj obračun.",
  stavka_sacuvana: "Stavka je sačuvana. Obračun je vraćen u nacrt dok ga ponovo ne obradite.",
  stavka_dodata: "Dodatna stavka je dodata.",
  stavka_nevalidna: "Podaci stavke nisu ispravni.",
  period_nevalidan:
    "Period stavke mora biti unutar mjeseca obračuna i trajanja zaposlenja radnika.",
  kontekst: "Izaberite firmu i poslovnu godinu.",
  prava: "Nemate pravo za rad sa platama.",
  godina_zakljucena: "Poslovna godina je zaključana.",
  knjizenje_nema_iznosa: "Obračun nema iznose koji se mogu proknjižiti.",
  knjizenje_vrsta_naloga: "Za ovu kategoriju obračuna nije podešena aktivna vrsta naloga.",
  knjizenje_pravila: "Za ovu kategoriju obračuna nema aktivnih pravila kontiranja.",
  knjizenje_duple_komponente:
    "Podešavanja kontiranja istovremeno sadrže zbirne i pojedinačne komponente.",
  knjizenje_konta:
    "Kontiranje nije završeno jer neko aktivno pravilo nema ispravan analitički konto.",
  knjizenje_nebalansirano: "Nalog nije kreiran jer kontiranje nije izbalansirano.",
  knjizenje_greska: "Obračun nije proknjižen. Provjerite podešavanja kontiranja i pokušajte ponovo."
};

function moneyInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function decimalInput(value: { toString(): string } | null | undefined) {
  return value?.toString() ?? "";
}

function displayDate(date: Date | string | null | undefined) {
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(date));
}

type PayrollControlIssue = {
  level: "error" | "warning";
  message: string;
};

function employeeName(employee: { ime: string; prezime: string }) {
  return `${employee.prezime} ${employee.ime}`;
}

function employeePreparationIssues(employee: {
  ime: string;
  prezime: string;
  jmbg: string | null;
  opstina: string | null;
  poreska_opstina: string | null;
  tekuci_racun: string | null;
  mjesecni_sati: number | null;
  neto_iznos_cent: number;
  bruto_iznos_cent: number;
  fiksni_dio_cent: number;
  koeficijent_slozenosti: { toString(): string } | null;
}) {
  const issues: PayrollControlIssue[] = [];
  const name = employeeName(employee);

  if (!employee.jmbg?.trim()) {
    issues.push({ level: "error", message: `${name}: nedostaje JMBG.` });
  }

  if (!(employee.poreska_opstina ?? employee.opstina)?.trim()) {
    issues.push({ level: "error", message: `${name}: nedostaje poreska opština/opština.` });
  }

  if (!employee.tekuci_racun?.trim()) {
    issues.push({ level: "warning", message: `${name}: nedostaje tekući račun za isplatu.` });
  }

  if (employee.mjesecni_sati !== null && employee.mjesecni_sati <= 0) {
    issues.push({ level: "error", message: `${name}: mjesečni sati moraju biti veći od nule.` });
  }

  if (
    employee.neto_iznos_cent === 0 &&
    employee.bruto_iznos_cent === 0 &&
    employee.fiksni_dio_cent === 0 &&
    Number(employee.koeficijent_slozenosti ?? 0) === 0
  ) {
    issues.push({
      level: "error",
      message: `${name}: nedostaje neto/bruto/fiksni dio ili koeficijent za obračun.`
    });
  }

  return issues;
}

function lineControlIssues({
  employee,
  line,
  calculationDate,
  calculationFrom,
  calculationTo,
  requiresEmployment
}: {
  employee?: {
    ime: string;
    prezime: string;
    jmbg: string | null;
    opstina: string | null;
    poreska_opstina: string | null;
    tekuci_racun: string | null;
    datum_pocetka: Date | null;
    datum_prestanka: Date | null;
    minuli_rad_godina: number;
  };
  line: {
    redni_broj: number;
    datum_od: Date;
    datum_do: Date;
    ukupno_sati: number;
    input_neto_cent: number;
    input_bruto_cent: number;
    fiksni_dio_cent: number;
    koeficijent_slozenosti: { toString(): string } | null;
    sifra_primanja_id: string;
    vrsta_obracuna_id: string;
    koristi_minuli_rad: boolean;
  };
  calculationDate: Date;
  calculationFrom: Date;
  calculationTo: Date;
  requiresEmployment: boolean;
}) {
  const issues: PayrollControlIssue[] = [];
  const name = employee ? employeeName(employee) : `Stavka ${line.redni_broj}`;

  if (!employee) {
    issues.push({ level: "error", message: `${name}: radnik nije pronađen.` });
    return issues;
  }

  if (!employee.jmbg?.trim()) {
    issues.push({ level: "error", message: `${name}: nedostaje JMBG.` });
  }

  if (!(employee.poreska_opstina ?? employee.opstina)?.trim()) {
    issues.push({ level: "error", message: `${name}: nedostaje poreska opština/opština.` });
  }

  if (!employee.tekuci_racun?.trim()) {
    issues.push({ level: "warning", message: `${name}: nedostaje tekući račun za isplatu.` });
  }

  if (!line.sifra_primanja_id || !line.vrsta_obracuna_id) {
    issues.push({ level: "error", message: `${name}: nedostaje šifra primanja ili vrsta obračuna.` });
  }

  if (line.ukupno_sati <= 0) {
    issues.push({ level: "error", message: `${name}: sati za obračun moraju biti veći od nule.` });
  }

  const allowedPeriod = allowedPayrollPeriod({
    calculationFrom,
    calculationTo,
    employmentFrom: requiresEmployment ? employee.datum_pocetka : null,
    employmentTo: requiresEmployment ? employee.datum_prestanka : null
  });

  if (
    !allowedPeriod ||
    !isPayrollPeriodAllowed({ from: line.datum_od, to: line.datum_do, allowed: allowedPeriod })
  ) {
    issues.push({
      level: "error",
      message: `${name}: period stavke mora biti unutar mjeseca obračuna i trajanja zaposlenja.`
    });
  }

  if (
    line.input_neto_cent === 0 &&
    line.input_bruto_cent === 0 &&
    line.fiksni_dio_cent === 0 &&
    Number(line.koeficijent_slozenosti ?? 0) === 0
  ) {
    issues.push({
      level: "error",
      message: `${name}: nedostaje neto/bruto/fiksni dio ili koeficijent za obračun.`
    });
  }

  if (
    line.koristi_minuli_rad &&
    effectiveSeniorityYears({
      manualYears: employee.minuli_rad_godina,
      startDate: employee.datum_pocetka,
      referenceDate: calculationDate
    }) === 0
  ) {
    issues.push({
      level: "error",
      message: `${name}: uključen je minuli rad, ali nema navršenih godina staža.`
    });
  }

  return issues;
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

  const activeFirmaId = context.firma.id;
  const activeAgencijaId = context.user.agencija_id;

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
  const showNewCalculationForm = params?.novi === "1";
  const selected = params?.obracun ? calculations.find((item) => item.id === params.obracun) ?? null : null;
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
  const calculationWorkersByEmployeeId = new Map(
    calculationWorkers.map((calculationWorker) => [calculationWorker.radnik_id, calculationWorker])
  );
  const selectedWorkerId =
    params?.radnik && lines.some((line) => line.radnik_id === params.radnik)
      ? params.radnik
      : lines[0]?.radnik_id ?? calculationWorkers[0]?.radnik_id ?? null;
  const selectedWorker = selectedWorkerId ? employeesById.get(selectedWorkerId) : null;
  const selectedCalculationWorker = selectedWorkerId
    ? calculationWorkersByEmployeeId.get(selectedWorkerId)
    : null;
  const selectedSeniorityYears = effectiveSeniorityYears({
    manualYears: selectedCalculationWorker?.minuli_rad_godina || selectedWorker?.minuli_rad_godina || 0,
    startDate: selectedWorker?.datum_pocetka,
    referenceDate: selected?.datum_do
  });
  const selectedSeniorityCoefficient = calculateSeniorityCoefficient(selectedSeniorityYears);
  const selectedLines = selectedWorkerId ? lines.filter((line) => line.radnik_id === selectedWorkerId) : [];
  const payrollPeriodProps = (
    employee: (typeof employees)[number] | null | undefined,
    line?: (typeof lines)[number]
  ) => {
    if (!selected) {
      return null;
    }

    const calculationFrom = payrollDateInputValue(selected.datum_od);
    const calculationTo = payrollDateInputValue(selected.datum_do);
    const usesEmploymentPeriod = payrollCategoryRequiresEmployment(selected.kategorija);
    const employmentFrom = usesEmploymentPeriod
      ? payrollDateInputValue(employee?.datum_pocetka)
      : "";
    const employmentTo = usesEmploymentPeriod
      ? payrollDateInputValue(employee?.datum_prestanka)
      : "";
    const allowed = allowedPayrollPeriod({
      calculationFrom,
      calculationTo,
      employmentFrom: employmentFrom || null,
      employmentTo: employmentTo || null
    }) ?? { from: calculationFrom, to: calculationTo };
    const period = normalizePayrollPeriod({
      requestedFrom: line?.datum_od,
      requestedTo: line?.datum_do,
      allowed
    });
    const monthlyScheduledHours = employeeMonthlyScheduledHours({
      calculationFundHours: selected.fond_sati,
      employeeMonthlyHours: employee?.mjesecni_sati,
      employmentPercentage: Number(employee?.procenat_radnog_vremena ?? 100)
    });
    const automaticHours = calculateAutomaticPayrollHours({
      calculationFrom,
      calculationTo,
      periodFrom: period.from,
      periodTo: period.to,
      monthlyScheduledHours
    });

    return {
      calculationFrom,
      calculationTo,
      employmentFrom: employmentFrom || null,
      employmentTo: employmentTo || null,
      initialFrom: period.from,
      initialTo: period.to,
      initialHours: line?.ukupno_sati ?? automaticHours,
      monthlyScheduledHours
    };
  };
  const incomeTypePriority = (incomeType: (typeof incomeTypes)[number]) => {
    const categoryPriority = incomeType.kategorija === selected?.kategorija ? 100 : 0;
    const scopePriority =
      incomeType.firma_id === activeFirmaId
        ? 30
        : incomeType.agencija_id === activeAgencijaId
          ? 20
          : 10;

    return categoryPriority + scopePriority;
  };
  const availableIncomeTypes = Array.from(
    incomeTypes.reduce((byCode, incomeType) => {
      const existing = byCode.get(incomeType.sifra);

      if (!existing || incomeTypePriority(incomeType) > incomeTypePriority(existing)) {
        byCode.set(incomeType.sifra, incomeType);
      }

      return byCode;
    }, new Map<string, (typeof incomeTypes)[number]>()).values()
  ).sort((left, right) => left.sifra.localeCompare(right.sifra, "sr-Latn", { numeric: true }));
  const seniorityCoefficientForLine = (line: (typeof lines)[number]) => {
    const employee = employeesById.get(line.radnik_id);
    const calculationWorker = calculationWorkersByEmployeeId.get(line.radnik_id);
    const seniorityYears = effectiveSeniorityYears({
      manualYears: calculationWorker?.minuli_rad_godina || employee?.minuli_rad_godina || 0,
      startDate: employee?.datum_pocetka,
      referenceDate: selected?.datum_do
    });

    return line.koristi_minuli_rad ? calculateSeniorityCoefficient(seniorityYears) : 0;
  };
  const eligibleEmployeesForControls = selected
    ? employees.filter(
        (employee) =>
          employee.aktivan &&
          (!payrollCategoryRequiresEmployment(selected.kategorija) ||
            employmentOverlapsPayrollPeriod({
              calculationFrom: selected.datum_od,
              calculationTo: selected.datum_do,
              employmentFrom: employee.datum_pocetka,
              employmentTo: employee.datum_prestanka
            }))
      )
    : [];
  const availableEmployeesForCalculation = eligibleEmployeesForControls.filter(
    (employee) => !calculationWorkersByEmployeeId.has(employee.id)
  );
  const controlIssues =
    selected && lines.length > 0
      ? lines.flatMap((line) =>
          lineControlIssues({
            employee: employeesById.get(line.radnik_id),
            line,
            calculationDate: selected.datum_do,
            calculationFrom: selected.datum_od,
            calculationTo: selected.datum_do,
            requiresEmployment: payrollCategoryRequiresEmployment(selected.kategorija)
          })
        )
      : eligibleEmployeesForControls.flatMap(employeePreparationIssues);
  const blockingControlCount = controlIssues.filter((issue) => issue.level === "error").length;
  const warningControlCount = controlIssues.filter((issue) => issue.level === "warning").length;
  const editable = selected
    ? !selected.nalog_id &&
      ![payrollStatuses.posted, payrollStatuses.locked].includes(selected.status as never)
    : false;
  const totals = lines.reduce(
    (sum, line) => ({
      neto: sum.neto + line.neto_cent,
      bruto: sum.bruto + line.bruto_cent,
      porez: sum.porez + line.porez_cent,
      prirez: sum.prirez + line.prirez_cent,
      doprinosiZaposleni: sum.doprinosiZaposleni + line.doprinosi_zaposleni_cent,
      doprinosiPoslodavac: sum.doprinosiPoslodavac + line.doprinosi_poslodavac_cent,
      trosak: sum.trosak + line.ukupni_trosak_cent
    }),
    {
      neto: 0,
      bruto: 0,
      porez: 0,
      prirez: 0,
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
        <div className="button-row">
          {showNewCalculationForm ? (
            <a className="secondary-button" href="/agencija/plate/obracun">
              Zatvori unos
            </a>
          ) : (
            <a className="primary-button" href="/agencija/plate/obracun?novi=1">
              Novi obračun
            </a>
          )}
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {showNewCalculationForm ? (
        <section className="admin-form-section">
          <h3>Novi obračun</h3>
          <PayrollCalculationForm
            action={createPayrollCalculation}
            defaultMonth={defaultMonth}
            defaultYear={defaultYear}
          />
        </section>
      ) : null}

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
                calculations.map((calculation) => {
                  const canEditCalculation =
                    !calculation.nalog_id &&
                    ![payrollStatuses.posted, payrollStatuses.locked].includes(
                      calculation.status as never
                    );
                  const canPostCalculation =
                    !calculation.nalog_id &&
                    [payrollStatuses.calculated, payrollStatuses.reviewed].includes(
                      calculation.status as never
                    );

                  return (
                    <tr key={calculation.id}>
                      <td>{calculation.broj}</td>
                      <td>
                        {calculation.mjesec}/{calculation.godina}
                        <small>
                          {displayDate(calculation.datum_od)} - {displayDate(calculation.datum_do)}
                        </small>
                      </td>
                      <td>{calculation.oznaka ?? payrollCategoryLabel(calculation.kategorija)}</td>
                      <td>{calculation.fond_sati}</td>
                      <td>{payrollStatusLabel(calculation.status)}</td>
                      <td>{calculation._count.radnici}</td>
                      <td>{calculation._count.stavke}</td>
                      <td>
                        <div className="table-actions">
                          <a className="table-link" href={`/agencija/plate/obracun?obracun=${calculation.id}`}>
                            Otvori
                          </a>
                          {canPostCalculation ? (
                            <form action={postPayrollCalculation}>
                              <input name="obracun_id" type="hidden" value={calculation.id} />
                              <button className="table-button" type="submit">
                                Proknjiži
                              </button>
                            </form>
                          ) : null}
                          {calculation.nalog_id ? (
                            <a className="table-link" href={`/agencija/nalozi/${calculation.nalog_id}`}>
                              Nalog
                            </a>
                          ) : null}
                          {canEditCalculation ? (
                            <form action={deletePayrollCalculation}>
                              <input name="obracun_id" type="hidden" value={calculation.id} />
                              <button className="table-button table-button-danger" type="submit">
                                Izbriši
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
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
                {selected.oznaka ?? payrollCategoryLabel(selected.kategorija)} - {payrollStatusLabel(selected.status)}
              </span>
            </div>
            <div className="button-row">
              {selected.nalog_id ? (
                <a className="secondary-button" href={`/agencija/nalozi/${selected.nalog_id}`}>
                  Otvori nalog
                </a>
              ) : null}
              {!selected.nalog_id &&
              [payrollStatuses.calculated, payrollStatuses.reviewed].includes(
                selected.status as never
              ) ? (
                <form action={postPayrollCalculation}>
                  <input name="obracun_id" type="hidden" value={selected.id} />
                  <button className="primary-button" type="submit">
                    Proknjiži
                  </button>
                </form>
              ) : null}
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
                  <button className="primary-button" type="submit" disabled={blockingControlCount > 0}>
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
              <span>Prirez</span>
              <strong>{money(totals.prirez)}</strong>
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

          <section className="embedded-panel payroll-controls-panel">
            <div className="panel-header compact-panel-header">
              <div>
                <h4>Kontrole prije obračuna</h4>
                <span>
                  {blockingControlCount} grešaka / {warningControlCount} upozorenja
                </span>
              </div>
              {blockingControlCount === 0 ? (
                <span className="status-pill status-pill--success">Spremno</span>
              ) : (
                <span className="status-pill status-pill--warning">Provjeriti</span>
              )}
            </div>
            {controlIssues.length === 0 ? (
              <p className="empty-state">Nema otvorenih kontrola za ovaj obračun.</p>
            ) : (
              <div className="control-issues">
                {controlIssues.map((issue, index) => (
                  <small className={issue.level === "error" ? "control-issue-error" : "control-issue-warning"} key={`${issue.message}-${index}`}>
                    {issue.level === "error" ? "Greška: " : "Upozorenje: "}
                    {issue.message}
                  </small>
                ))}
              </div>
            )}
          </section>

          {lines.length === 0 ? (
            <div className="embedded-panel payroll-manage-workers-panel">
              <p className="empty-state">
                Obračun još nema radnike. Kliknite Pripremi radnike ili dodajte pojedinačnog radnika.
              </p>
              {editable ? (
                <form className="table-inline-form payroll-add-worker-form" action={addPayrollWorkerToCalculation}>
                  <input name="obracun_id" type="hidden" value={selected.id} />
                  <select name="radnik_id" required>
                    <option value="">Izaberi radnika</option>
                    {availableEmployeesForCalculation.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.prezime} {employee.ime}
                      </option>
                    ))}
                  </select>
                  <button className="table-button" type="submit" disabled={availableEmployeesForCalculation.length === 0}>
                    Dodaj radnika
                  </button>
                </form>
              ) : null}
            </div>
          ) : (
            <div className="payroll-workspace" id="obracun-radnici">
              <aside className="payroll-worker-list">
                <h4>Radnici u obračunu</h4>
                {editable ? (
                  <form className="table-inline-form payroll-add-worker-form" action={addPayrollWorkerToCalculation}>
                    <input name="obracun_id" type="hidden" value={selected.id} />
                    <select name="radnik_id" required>
                      <option value="">Dodaj radnika</option>
                      {availableEmployeesForCalculation.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.prezime} {employee.ime}
                        </option>
                      ))}
                    </select>
                    <button className="table-button" type="submit" disabled={availableEmployeesForCalculation.length === 0}>
                      Dodaj
                    </button>
                  </form>
                ) : null}
                {calculationWorkers.map((worker) => {
                  const employee = employeesById.get(worker.radnik_id);
                  const workerLines = lines.filter((line) => line.radnik_id === worker.radnik_id);
                  const workerTotal = workerLines.reduce((sum, line) => sum + line.neto_cent, 0);
                  const isSelected = worker.radnik_id === selectedWorkerId;

                  return (
                    <div className="payroll-worker-item" key={worker.id}>
                      <a
                        className={`payroll-worker-link${isSelected ? " active" : ""}`}
                        href={`/agencija/plate/obracun?obracun=${selected.id}&radnik=${worker.radnik_id}#obracun-radnici`}
                      >
                        <strong>{employee ? `${employee.prezime} ${employee.ime}` : "Radnik"}</strong>
                        <span>
                          {workerLines.length} stavki / {worker.status === payrollStatuses.calculated ? "obračunat" : "nacrt"}
                        </span>
                        <small>Neto {money(workerTotal)}</small>
                      </a>
                      {editable ? (
                        <form className="payroll-worker-remove-form" action={removePayrollWorkerFromCalculation}>
                          <input name="obracun_id" type="hidden" value={selected.id} />
                          <input name="radnik_id" type="hidden" value={worker.radnik_id} />
                          <button
                            aria-label="Izbriši radnika iz obračuna"
                            className="table-button table-button-danger"
                            title="Izbriši iz obračuna"
                            type="submit"
                          >
                            ×
                          </button>
                        </form>
                      ) : null}
                    </div>
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
                            {availableIncomeTypes.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.sifra} - {type.naziv}
                                {type.koeficijent_tip === "IZNOS" &&
                                Number(type.obracunski_koeficijent) !== 1
                                  ? ` (koef. ${type.obracunski_koeficijent.toString()})`
                                  : ""}
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
                        {payrollPeriodProps(selectedWorker, line) ? (
                          <PayrollPeriodHoursFields {...payrollPeriodProps(selectedWorker, line)!} />
                        ) : null}
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
                          <span>Koef. minulog rada (auto)</span>
                          <input
                            name="koeficijent_minuli_rad"
                            type="number"
                            step="0.0001"
                            defaultValue={seniorityCoefficientForLine(line).toFixed(4)}
                            readOnly
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
                              <th>Osnovica</th>
                              <th>Minuli</th>
                              <th>Bruto</th>
                              <th>Porez</th>
                              <th>Prirez</th>
                              <th>PIO</th>
                              <th>Nezaposl.</th>
                              <th>Poslodavac</th>
                              <th>Trošak</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>{money(line.osnovica_cent)}</td>
                              <td>{money(Math.max(0, line.iznos_za_obracun_cent - line.osnovica_cent))}</td>
                              <td>{money(line.bruto_cent)}</td>
                              <td>{money(line.porez_cent)}</td>
                              <td>{money(line.prirez_cent)}</td>
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
                          {availableIncomeTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.sifra} - {type.naziv}
                              {type.koeficijent_tip === "IZNOS" &&
                              Number(type.obracunski_koeficijent) !== 1
                                ? ` (koef. ${type.obracunski_koeficijent.toString()})`
                                : ""}
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
                      {payrollPeriodProps(selectedWorker) ? (
                        <PayrollPeriodHoursFields {...payrollPeriodProps(selectedWorker)!} />
                      ) : null}
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
                        <span>Koef. minulog rada (auto)</span>
                        <input
                          name="koeficijent_minuli_rad"
                          type="number"
                          step="0.0001"
                          defaultValue={selectedSeniorityCoefficient.toFixed(4)}
                          readOnly
                        />
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
