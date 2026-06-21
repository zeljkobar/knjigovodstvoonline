import Link from "next/link";
import {
  createCompanyBankAccount,
  setPrimaryCompanyBankAccount,
  toggleCompanyBankAccount
} from "../../actions";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type BankovniRacuniPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    firma?: string;
  }>;
};

const poruke: Record<string, string> = {
  racun_kreiran: "Bankovni racun je dodat.",
  racun_obavezno: "Naziv banke i broj racuna su obavezni.",
  racun_postoji: "Ovaj broj racuna vec postoji za firmu.",
  racun_greska: "Bankovni racun nije sacuvan. Provjerite podatke.",
  racun_glavni: "Racun je oznacen kao glavni.",
  racun_aktiviran: "Racun je aktiviran.",
  racun_deaktiviran: "Racun je deaktiviran.",
  valuta_nevalidna: "Valuta nije validna."
};

const valute = ["EUR", "USD", "GBP", "RSD"];

export default async function BankovniRacuniPage({
  searchParams
}: BankovniRacuniPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const selectedCompanyId = params?.firma ?? "";
  const canManage = user.rola === "admin_agencije";

  if (!user.agencija_id) {
    return null;
  }

  const firme = await prisma.firma.findMany({
    where: {
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(canManage
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
    orderBy: {
      naziv: "asc"
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      bankovni_racuni: {
        where: {
          is_deleted: false
        },
        orderBy: [{ glavni: "desc" }, { naziv_banke: "asc" }],
        select: {
          id: true,
          naziv_banke: true,
          broj_racuna: true,
          valuta: true,
          glavni: true,
          aktivan: true,
          napomena: true
        }
      }
    }
  });

  const selectedCompany = firme.find((firma) => firma.id === selectedCompanyId) ?? firme[0];
  const racuni = firme.flatMap((firma) =>
    firma.bankovni_racuni.map((racun) => ({
      ...racun,
      firma
    }))
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Bankovni racuni</h2>
        </div>
        <Link className="table-link" href="/agencija/firme">
          Lista firmi
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {canManage ? (
        <section className="admin-form-section">
          <h3>Dodaj bankovni racun</h3>
          <form className="admin-form" action={createCompanyBankAccount}>
            <label>
              <span>Firma</span>
              <select name="firma_id" required defaultValue={selectedCompany?.id ?? ""}>
                <option value="">Izaberite firmu</option>
                {firme.map((firma) => (
                  <option key={firma.id} value={firma.id}>
                    {firma.naziv}
                    {firma.pib ? ` (${firma.pib})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Banka</span>
              <input name="naziv_banke" placeholder="npr. CKB" required />
            </label>
            <label>
              <span>Broj racuna</span>
              <input name="broj_racuna" placeholder="510-..." required />
            </label>
            <label>
              <span>Valuta</span>
              <select name="valuta" defaultValue="EUR" required>
                {valute.map((valuta) => (
                  <option key={valuta} value={valuta}>
                    {valuta}
                  </option>
                ))}
              </select>
            </label>
            <label className="single-checkbox form-checkbox">
              <input name="glavni" type="checkbox" />
              <span>Glavni racun</span>
            </label>
            <label className="form-wide">
              <span>Napomena</span>
              <textarea name="napomena" />
            </label>
            <button type="submit">Dodaj racun</button>
          </form>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Pregled bankovnih racuna</h3>
          <span>{racuni.length} ukupno</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Firma</th>
                <th>Banka</th>
                <th>Broj racuna</th>
                <th>Valuta</th>
                <th>Status</th>
                {canManage ? <th>Akcija</th> : null}
              </tr>
            </thead>
            <tbody>
              {racuni.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5}>Nema unesenih bankovnih racuna.</td>
                </tr>
              ) : (
                racuni.map((racun) => (
                  <tr key={racun.id}>
                    <td>
                      <Link className="inline-link" href={`/agencija/firme/${racun.firma.id}`}>
                        {racun.firma.naziv}
                      </Link>
                      <small>{racun.firma.pib ?? "Bez PIB-a"}</small>
                    </td>
                    <td>
                      <strong>{racun.naziv_banke}</strong>
                      {racun.napomena ? <small>{racun.napomena}</small> : null}
                    </td>
                    <td>{racun.broj_racuna}</td>
                    <td>{racun.valuta}</td>
                    <td>
                      {racun.glavni ? "Glavni" : racun.aktivan ? "Aktivan" : "Neaktivan"}
                    </td>
                    {canManage ? (
                      <td className="table-actions">
                        {!racun.glavni && racun.aktivan ? (
                          <form action={setPrimaryCompanyBankAccount}>
                            <input name="racun_id" type="hidden" value={racun.id} />
                            <button className="table-button" type="submit">
                              Glavni
                            </button>
                          </form>
                        ) : null}
                        <form action={toggleCompanyBankAccount}>
                          <input name="racun_id" type="hidden" value={racun.id} />
                          <input name="aktivan" type="hidden" value={String(!racun.aktivan)} />
                          <button className="table-button" type="submit">
                            {racun.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
