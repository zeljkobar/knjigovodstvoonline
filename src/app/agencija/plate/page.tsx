import { createPayrollEmployee, updatePayrollEmployee } from "./actions";
import { getPlateContext, MissingPlateContext } from "./_shared";
import { dateInputValue, money } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    novi?: string;
    poruka?: string;
    tab?: string;
    edit?: string;
  }>;
};

const messages: Record<string, string> = {
  radnik_dodat: "Zaposleni je dodat.",
  radnik_izmijenjen: "Podaci zaposlenog su sačuvani.",
  radnik_nevalidan: "Ime, prezime i ispravni iznosi su obavezni.",
  kontekst: "Izaberite firmu i poslovnu godinu.",
  prava: "Nemate pravo za rad sa platama.",
  godina_zakljucena: "Poslovna godina je zaključana."
};

function moneyInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function decimalInput(value: { toString(): string } | null | undefined) {
  return value?.toString() ?? "";
}

export default async function PlatePage({ searchParams }: PageProps) {
  const context = await getPlateContext("view");
  const params = await searchParams;
  const message = params?.poruka ? messages[params.poruka] : null;

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="Plate" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled modula plate.</p>
      </section>
    );
  }

  const [employees, incomeTypes, calculationTypes] = await Promise.all([
    prisma.plateRadnik.findMany({
      where: {
        agencija_id: context.user.agencija_id,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [
        {
          prezime: "asc"
        },
        {
          ime: "asc"
        }
      ]
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
  const editedEmployee = params?.edit
    ? employees.find((employee) => employee.id === params.edit) ?? null
    : null;
  const showForm = params?.novi === "1" || Boolean(editedEmployee);
  const activeEmployees = employees.filter((employee) => employee.aktivan && employee.zaposlen);
  const inactiveEmployees = employees.filter((employee) => !employee.aktivan || !employee.zaposlen);
  const activeTab = params?.tab === "neaktivni" ? "neaktivni" : "aktivni";
  const formQuery = showForm && !editedEmployee ? "&novi=1" : "";
  const closeFormHref = `/agencija/plate?tab=${activeTab}`;
  const openCreateHref = `/agencija/plate?tab=${activeTab}&novi=1`;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Plate - zaposleni</h2>
          <p>
            {context.firma.naziv} / {context.godina.godina}
          </p>
        </div>
        <a className="primary-button" href={showForm ? closeFormHref : openCreateHref}>
          {showForm ? "Zatvori formu" : "Dodaj radnika"}
        </a>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {showForm ? (
        <section className="admin-form-section">
          <div className="panel-header compact-panel-header">
            <h3>{editedEmployee ? "Izmjena zaposlenog" : "Novi zaposleni"}</h3>
            {editedEmployee ? (
              <a className="table-link" href={closeFormHref}>
                Odustani
              </a>
            ) : null}
          </div>
          <form className="admin-form" action={editedEmployee ? updatePayrollEmployee : createPayrollEmployee}>
            {editedEmployee ? <input name="radnik_id" type="hidden" value={editedEmployee.id} /> : null}
            <label>
              <span>Ime</span>
              <input name="ime" defaultValue={editedEmployee?.ime ?? ""} required />
            </label>
            <label>
              <span>Prezime</span>
              <input name="prezime" defaultValue={editedEmployee?.prezime ?? ""} required />
            </label>
            <label>
              <span>Ime roditelja</span>
              <input name="ime_roditelja" defaultValue={editedEmployee?.ime_roditelja ?? ""} />
            </label>
            <label>
              <span>JMBG</span>
              <input name="jmbg" defaultValue={editedEmployee?.jmbg ?? ""} />
            </label>
            <label>
              <span>Opština</span>
              <input name="opstina" placeholder="npr. BAR" defaultValue={editedEmployee?.opstina ?? ""} />
            </label>
            <label>
              <span>Poreska opština</span>
              <input name="poreska_opstina" placeholder="npr. BAR" defaultValue={editedEmployee?.poreska_opstina ?? ""} />
            </label>
            <label>
              <span>Tekući račun</span>
              <input name="tekuci_racun" defaultValue={editedEmployee?.tekuci_racun ?? ""} />
            </label>
            <label>
              <span>Datum zaposlenja</span>
              <input name="datum_pocetka" type="date" defaultValue={dateInputValue(editedEmployee?.datum_pocetka)} />
            </label>
            <label>
              <span>Radno mjesto</span>
              <input name="radno_mjesto" defaultValue={editedEmployee?.radno_mjesto ?? ""} />
            </label>
            <label>
              <span>Radno vrijeme %</span>
              <input
                name="procenat_radnog_vremena"
                type="number"
                defaultValue={decimalInput(editedEmployee?.procenat_radnog_vremena) || "100"}
                min="1"
                max="100"
                step="0.01"
              />
            </label>
            <label>
              <span>Mjesecni sati</span>
              <input name="mjesecni_sati" type="number" placeholder="prazno = fond x %" defaultValue={editedEmployee?.mjesecni_sati ?? ""} />
            </label>
            <label>
              <span>Neto iznos</span>
              <input name="neto_iznos" defaultValue={editedEmployee ? moneyInput(editedEmployee.neto_iznos_cent) : "0,00"} />
            </label>
            <label>
              <span>Bruto iznos</span>
              <input name="bruto_iznos" defaultValue={editedEmployee ? moneyInput(editedEmployee.bruto_iznos_cent) : "0,00"} />
            </label>
            <label>
              <span>Fiksni dio</span>
              <input name="fiksni_dio" defaultValue={editedEmployee ? moneyInput(editedEmployee.fiksni_dio_cent) : "0,00"} />
            </label>
            <label>
              <span>Koeficijent složenosti</span>
              <input
                name="koeficijent_slozenosti"
                type="number"
                step="0.000001"
                defaultValue={decimalInput(editedEmployee?.koeficijent_slozenosti)}
              />
            </label>
            <label>
              <span>Minuli rad godina</span>
              <input name="minuli_rad_godina" type="number" defaultValue={editedEmployee?.minuli_rad_godina ?? 0} min="0" />
            </label>
            <label>
              <span>Koef. minulog rada</span>
              <input
                name="koeficijent_minuli_rad"
                type="number"
                step="0.0001"
                defaultValue={decimalInput(editedEmployee?.koeficijent_minuli_rad) || "0"}
              />
            </label>
            <label>
              <span>Šifra primanja</span>
              <select name="podrazumijevana_sifra_id" defaultValue={editedEmployee?.podrazumijevana_sifra_id ?? ""}>
                <option value="">Podrazumijevano: 001 Zarada</option>
                {incomeTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.sifra} - {type.naziv}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Vrsta obračuna</span>
              <select name="podrazumijevana_vrsta_id" defaultValue={editedEmployee?.podrazumijevana_vrsta_id ?? ""}>
                <option value="">Podrazumijevano iz šifre primanja</option>
                {calculationTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.naziv}
                  </option>
                ))}
              </select>
            </label>
            {editedEmployee ? (
              <label>
                <span>Datum prestanka</span>
                <input name="datum_prestanka" type="date" defaultValue={dateInputValue(editedEmployee.datum_prestanka)} />
              </label>
            ) : null}
            <label className="single-checkbox form-checkbox">
              <input name="koristi_minuli_rad" type="checkbox" defaultChecked={editedEmployee?.koristi_minuli_rad ?? false} />
              <span>Koristi minuli rad</span>
            </label>
            {editedEmployee ? (
              <>
                <label className="single-checkbox form-checkbox">
                  <input name="aktivan" type="checkbox" defaultChecked={editedEmployee.aktivan} />
                  <span>Aktivan</span>
                </label>
                <label className="single-checkbox form-checkbox">
                  <input name="zaposlen" type="checkbox" defaultChecked={editedEmployee.zaposlen} />
                  <span>Trenutno zaposlen</span>
                </label>
              </>
            ) : null}
            <button type="submit">{editedEmployee ? "Sačuvaj izmjene" : "Dodaj zaposlenog"}</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Zaposleni</h3>
          <span>
            {activeEmployees.length + inactiveEmployees.length} ukupno
          </span>
        </div>

        <div className="tabs-row">
          <a
            className={activeTab === "aktivni" ? "tab-link active" : "tab-link"}
            href={`/agencija/plate?tab=aktivni${formQuery}`}
          >
            Aktivni ({activeEmployees.length})
          </a>
          <a
            className={activeTab === "neaktivni" ? "tab-link active" : "tab-link"}
            href={`/agencija/plate?tab=neaktivni${formQuery}`}
          >
            Neaktivni / bivši ({inactiveEmployees.length})
          </a>
        </div>

        <div className="table-wrap">
          {activeTab === "aktivni" ? (
            <table>
              <thead>
                <tr>
                  <th>Prezime i ime</th>
                  <th>JMBG</th>
                  <th>Datum zaposlenja</th>
                  <th>Opština</th>
                  <th>Sati/%</th>
                  <th>Neto</th>
                  <th>Bruto</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {activeEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={9}>Nema aktivnih zaposlenih za aktivnu firmu.</td>
                  </tr>
                ) : (
                  activeEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <strong>
                          {employee.prezime} {employee.ime}
                        </strong>
                        <small>{employee.radno_mjesto ?? "-"}</small>
                      </td>
                      <td>{employee.jmbg ?? "-"}</td>
                      <td>{dateInputValue(employee.datum_pocetka) || "-"}</td>
                      <td>{employee.poreska_opstina ?? employee.opstina ?? "-"}</td>
                      <td>
                        {employee.mjesecni_sati ?? "-"} / {employee.procenat_radnog_vremena.toString()}%
                      </td>
                      <td>{money(employee.neto_iznos_cent)}</td>
                      <td>{money(employee.bruto_iznos_cent)}</td>
                      <td>Aktivan</td>
                      <td>
                        <a className="table-button" href={`/agencija/plate?tab=aktivni&edit=${employee.id}`}>
                          Izmijeni
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Prezime i ime</th>
                  <th>JMBG</th>
                  <th>Datum zaposlenja</th>
                  <th>Datum prestanka</th>
                  <th>Opština</th>
                  <th>Zadnji neto</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {inactiveEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Nema bivših ili neaktivnih radnika.</td>
                  </tr>
                ) : (
                  inactiveEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <strong>
                          {employee.prezime} {employee.ime}
                        </strong>
                        <small>{employee.radno_mjesto ?? "-"}</small>
                      </td>
                      <td>{employee.jmbg ?? "-"}</td>
                      <td>{dateInputValue(employee.datum_pocetka) || "-"}</td>
                      <td>{dateInputValue(employee.datum_prestanka) || "-"}</td>
                      <td>{employee.poreska_opstina ?? employee.opstina ?? "-"}</td>
                      <td>{money(employee.neto_iznos_cent)}</td>
                      <td>{employee.zaposlen ? "Neaktivan" : "Bivši radnik"}</td>
                      <td>
                        <a className="table-button" href={`/agencija/plate?tab=neaktivni&edit=${employee.id}`}>
                          Izmijeni
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
