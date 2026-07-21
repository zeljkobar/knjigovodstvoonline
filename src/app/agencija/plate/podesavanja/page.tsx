import { getPlateContext, MissingPlateContext } from "../_shared";
import { savePayrollBasisRule } from "../actions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

function dateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function percentValue(value: unknown, multiplier = 1) {
  const numeric = Number(value ?? 0) * multiplier;

  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

export default async function PayrollSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
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

  const payrollBases = await prisma.plateOsnovaObracuna.findMany({
    where: {
      aktivan: true
    },
    include: {
      pravila: {
        where: {
          aktivan: true
        },
        include: {
          stope: {
            where: {
              aktivan: true
            },
            orderBy: {
              tip: "asc"
            }
          }
        },
        orderBy: {
          valid_from: "desc"
        },
        take: 1
      }
    },
    orderBy: {
      sifra: "asc"
    }
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja plata</h2>
          <p>Osnove za obračun plata i pravila po IOPPD šiframa.</p>
        </div>
      </header>

      {params?.poruka === "osnova_sacuvana" ? (
        <section className="status-banner success">Osnova za obračun je sačuvana.</section>
      ) : null}
      {params?.poruka === "osnova_nevalidna" ? (
        <section className="status-banner error">Unesite šifru, naziv i datum važenja osnove.</section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Osnove za obračun</h3>
          <span>{payrollBases.length} aktivno</span>
        </div>
        <p className="muted-text">
          Matrica iz specifikacije povezuje IOPPD šifru sa osnovicom, stopama i rokom. Originalni red iz
          zvaničnog dokumenta se čuva uz pravilo, a strukturisana polja služe za obračun i kontrole.
        </p>
        <div className="settings-grid">
          {payrollBases.map((basis) => {
            const rule = basis.pravila[0];
            const taxRate = rule?.stope.find((rate) => rate.tip === "POREZ");

            return (
              <details className="settings-card" key={basis.id}>
                <summary>
                  <strong>
                    {basis.sifra} - {basis.naziv}
                  </strong>
                  <span>
                    {basis.kategorija ?? "OSTALO"} / {rule?.osnovica_porez_tip ?? "bez poreza"}{" "}
                    {taxRate ? `/ porez ${percentValue(taxRate.stopa, 100)}%` : ""}
                  </span>
                </summary>
                <form action={savePayrollBasisRule}>
                  <input type="hidden" name="osnova_id" value={basis.id} />
                  <input type="hidden" name="pravilo_id" value={rule?.id ?? ""} />
                  <label className="checkbox-card compact">
                    <input type="checkbox" name="aktivan" defaultChecked={basis.aktivan} />
                    Aktivan
                  </label>

                  <div className="admin-form compact-form">
                    <label>
                      <span>Naziv</span>
                      <input name="naziv" defaultValue={basis.naziv} />
                    </label>
                    <label>
                      <span>Kategorija</span>
                      <input name="kategorija" defaultValue={basis.kategorija ?? ""} />
                    </label>
                    <label>
                      <span>Važi od</span>
                      <input type="date" name="valid_from" defaultValue={dateInput(rule?.valid_from ?? basis.valid_from)} />
                    </label>
                    <label>
                      <span>Važi do</span>
                      <input type="date" name="valid_to" defaultValue={dateInput(rule?.valid_to ?? basis.valid_to)} />
                    </label>
                    <label>
                      <span>Tip porezne osnovice</span>
                      <select name="osnovica_porez_tip" defaultValue={rule?.osnovica_porez_tip ?? ""}>
                        <option value="">Nema porezne osnovice</option>
                        <option value="BRUTO">Bruto</option>
                        <option value="NETO">Neto</option>
                        <option value="PROCENAT_BRUTO">Procenat bruto iznosa</option>
                        <option value="PROCENAT_NETO">Procenat neto iznosa</option>
                        <option value="OPISNO">Opisno pravilo</option>
                      </select>
                    </label>
                    <label>
                      <span>Osnovica poreza %</span>
                      <input
                        name="osnovica_porez_proc"
                        inputMode="decimal"
                        defaultValue={percentValue(rule?.osnovica_porez_proc)}
                      />
                    </label>
                    <label>
                      <span>Stopa poreza %</span>
                      <input name="porez_stopa" inputMode="decimal" defaultValue={percentValue(taxRate?.stopa, 100)} />
                    </label>
                    <label>
                      <span>Rok</span>
                      <input name="porez_rok" defaultValue={rule?.porez_rok ?? ""} />
                    </label>
                    <label className="form-span-2">
                      <span>Opis</span>
                      <textarea name="opis" defaultValue={basis.opis ?? ""} />
                    </label>
                    <label className="form-span-2">
                      <span>Napomena pravila</span>
                      <textarea name="napomena" defaultValue={rule?.napomena ?? ""} />
                    </label>
                    <label className="checkbox-card compact">
                      <input type="checkbox" name="pravilo_aktivan" defaultChecked={rule?.aktivan ?? true} />
                      Pravilo aktivno
                    </label>
                    <button type="submit">Sačuvaj osnovu</button>
                  </div>
                </form>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
