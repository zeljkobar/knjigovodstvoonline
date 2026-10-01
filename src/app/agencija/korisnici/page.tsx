import {
  assignCompanyToUser,
  createAgencyUser,
  removeCompanyFromUser,
  saveUserPermissionMatrix,
  toggleAgencyUser
} from "../actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { configurablePermissionActions } from "@/lib/permission-policy";
import { prisma } from "@/lib/prisma";
import { clientPermissionGroups } from "@/lib/client-permission-policy";

type KorisniciPageProps = {
  searchParams?: Promise<{
    tip?: string;
    firma?: string;
    korisnik?: string;
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  korisnik_kreiran: "Korisnik je kreiran i pozivnica je poslata.",
  korisnik_obavezno: "Korisnicko ime i email su obavezni.",
  korisnik_greska: "Korisnik nije sacuvan. Provjerite korisnicko ime ili email.",
  email_greska: "Korisnik je sacuvan, ali email nije poslat.",
  firma_dodijeljena: "Firma je dodijeljena korisniku.",
  firma_uklonjena: "Pristup firmi je uklonjen.",
  dodjela_obavezna: "Korisnik i firma su obavezni za dodjelu.",
  dodjela_greska: "Dodjela firme nije uspjela.",
  prava_sacuvana: "Prava korisnika su sacuvana.",
  prava_obavezna: "Korisnik, firma i modul su obavezni za prava.",
  prava_greska: "Prava nisu sacuvana.",
  rola_nevalidna: "Izabrana rola nije dozvoljena."
};

const moduli = [
  "pos",
  "nalozi",
  "robno",
  "kalkulacije",
  "izlazni_racuni",
  "ulazni_racuni",
  "izvodi",
  "virmani",
  "plate",
  "osnovna_sredstva",
  "pdv",
  "zavrsni_racun",
  "izvjestaji"
];

const akcije = configurablePermissionActions;

function roleLabel(rola: string) {
  if (rola === "korisnik_agencije") {
    return "Radnik";
  }

  if (rola === "klijent") {
    return "Klijent";
  }

  return rola;
}

function actionLabel(akcija: string) {
  const labels: Record<string, string> = {
    view: "Pregled",
    create: "Unos",
    update: "Izmjena",
    delete: "Brisanje",
    post: "Knjiženje",
    cancel: "Storniranje",
    export: "Izvoz",
    manage: "Administracija"
  };

  return labels[akcija] ?? akcija;
}

export default async function AgencijskiKorisniciPage({
  searchParams
}: KorisniciPageProps) {
  const admin = await requireRole("admin_agencije");
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const selectedUserId = params?.korisnik ?? null;
  const requestedFirmaId = params?.firma ?? null;

  if (!admin.agencija_id) {
    return null;
  }

  const [korisnici, firme] = await Promise.all([
    prisma.korisnik.findMany({
      where: {
        agencija_id: admin.agencija_id,
        rola: {
          in: ["korisnik_agencije", "klijent"]
        },
        is_deleted: false
      },
      orderBy: {
        created_at: "desc"
      },
      select: {
        id: true,
        korisnicko_ime: true,
        email: true,
        rola: true,
        aktivan: true,
        zadnja_prijava_at: true,
        firme: {
          where: {
            is_deleted: false
          },
          orderBy: {
            created_at: "desc"
          },
          select: {
            id: true,
            glavni_radnik: true,
            firma: {
              select: {
                id: true,
                naziv: true,
                pib: true
              }
            }
          }
        },
        prava: {
          orderBy: [
            {
              modul: "asc"
            },
            {
              akcija: "asc"
            }
          ],
          select: {
            id: true,
            firma_id: true,
            modul: true,
            akcija: true,
            dozvoljeno: true
          }
        }
      }
    }),
    prisma.firma.findMany({
      where: {
        agencija_id: admin.agencija_id,
        is_deleted: false,
        aktivan: true
      },
      orderBy: {
        naziv: "asc"
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    })
  ]);

  const selectedUser = korisnici.find((korisnik) => korisnik.id === selectedUserId) ?? null;
  if (selectedUser?.rola === "klijent" && params?.tip !== "klijenti") {
    const query = new URLSearchParams({ ...params, tip: "klijenti" });
    redirect(`/agencija/korisnici?${query}#podesavanja-korisnika`);
  }
  const clients = params?.tip === "klijenti";
  const visibleUsers = korisnici.filter((user) => user.rola === (clients ? "klijent" : "korisnik_agencije"));
  const typeQuery = clients ? "tip=klijenti&" : "";
  const selectedAssignment =
    selectedUser?.firme.find((dodjela) => dodjela.firma.id === requestedFirmaId) ??
    (!requestedFirmaId && selectedUser?.firme.length === 1 ? selectedUser.firme[0] : null);
  const selectedFirmaId = selectedAssignment?.firma.id ?? "";
  const selectedPermissionActions = new Set(
    selectedUser?.prava
      .filter((pravo) => pravo.firma_id === selectedFirmaId && pravo.dozvoljeno)
      .map((pravo) => `${pravo.modul}:${pravo.akcija}`) ?? []
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{clients ? "Klijenti" : "Radnici"}</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-form-section">
        <h3>{clients ? "Novi klijent" : "Novi radnik"}</h3>
        <form className="admin-form" action={createAgencyUser}>
          <label>
            <span>Korisnicko ime</span>
            <input name="korisnicko_ime" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" required type="email" />
          </label>
          <input type="hidden" name="rola" value={clients ? "klijent" : "korisnik_agencije"} />
          <button type="submit">Posalji pozivnicu</button>
        </form>
      </section>

      <section className="admin-panel" id="lista-korisnika" style={{ scrollMarginTop: "24px" }}>
        <div className="panel-header">
          <h3>{clients ? "Klijenti" : "Radnici"}</h3>
          <span>{visibleUsers.length} ukupno</span>
        </div>

        {visibleUsers.length === 0 ? (
          <p className="empty-state">{clients ? "Nema klijenata." : "Nema radnika."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Korisnik</th>
                  <th>Tip</th>
                  <th>Email</th>
                  <th>Firmi</th>
                  <th>Prava</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((korisnik) => {
                  const isSelected = selectedUser?.id === korisnik.id;

                  return (
                    <tr className={isSelected ? "selected-row" : ""} key={korisnik.id}>
                      <td>
                        <strong>{korisnik.korisnicko_ime}</strong>
                        <small>
                          {korisnik.zadnja_prijava_at
                            ? `Zadnja prijava: ${korisnik.zadnja_prijava_at.toLocaleDateString("sr-Latn")}`
                            : "Bez prijave"}
                        </small>
                      </td>
                      <td>{roleLabel(korisnik.rola)}</td>
                      <td>{korisnik.email ?? "-"}</td>
                      <td>{korisnik.firme.length}</td>
                      <td>{korisnik.prava.length}</td>
                      <td>{korisnik.aktivan ? "Aktivan" : "Neaktivan"}</td>
                      <td>
                        <div className="table-actions">
                          <Link
                            className="table-link"
                            href={`/agencija/korisnici?${typeQuery}korisnik=${korisnik.id}#${korisnik.firme.length === 1 ? "prava-korisnika" : "podesavanja-korisnika"}`}
                          >
                            Otvori
                          </Link>
                          <form action={toggleAgencyUser}>
                            <input name="id" type="hidden" value={korisnik.id} />
                            <input
                              name="aktivan"
                              type="hidden"
                              value={String(!korisnik.aktivan)}
                            />
                            <button className="table-button" type="submit">
                              {korisnik.aktivan ? "Deaktiviraj" : "Aktiviraj"}
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedUser ? (
        <section className="admin-panel" id="podesavanja-korisnika" style={{ scrollMarginTop: "24px" }}>
          <div className="panel-header">
            <div>
              <h3>{selectedUser.korisnicko_ime}</h3>
              <span>
                {roleLabel(selectedUser.rola)}
                {selectedUser.email ? ` · ${selectedUser.email}` : ""}
              </span>
            </div>
            <span className="status-pill">
              {selectedUser.aktivan ? "Aktivan" : "Neaktivan"}
            </span>
          </div>

          <div className="user-company-grid">
            <section className="embedded-panel">
              <div className="panel-header compact-panel-header">
                <h4>Firme korisnika</h4>
                <span>{selectedUser.firme.length} ukupno</span>
              </div>

              {selectedUser.firme.length === 0 ? (
                <p className="empty-state">Korisnik nema dodijeljene firme.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Firma</th>
                        <th>Uloga</th>
                        <th>Prava</th>
                        <th>Akcija</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUser.firme.map((dodjela) => {
                        const isSelected = selectedFirmaId === dodjela.firma.id;
                        const pravaCount = selectedUser.prava.filter(
                          (pravo) => pravo.firma_id === dodjela.firma.id
                        ).length;

                        return (
                          <tr
                            className={isSelected ? "selected-row" : ""}
                            key={dodjela.id}
                          >
                            <td>
                              <strong>{dodjela.firma.naziv}</strong>
                              <small>{dodjela.firma.pib ?? "Bez PIB-a"}</small>
                            </td>
                            <td>{dodjela.glavni_radnik ? "Glavni radnik" : "Pristup"}</td>
                            <td>{pravaCount}</td>
                            <td>
                              <div className="table-actions">
                                <Link
                                  className="table-link"
                                  href={`/agencija/korisnici?${typeQuery}korisnik=${selectedUser.id}&firma=${dodjela.firma.id}#prava-korisnika`}
                                >
                                  Prava
                                </Link>
                                <form action={removeCompanyFromUser}>
                                  <input name="id" type="hidden" value={dodjela.id} />
                                  <button className="table-button" type="submit">
                                    Ukloni
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="embedded-panel">
              <h4>Dodaj firmu</h4>
              <form className="compact-form" action={assignCompanyToUser}>
                <input name="korisnik_id" type="hidden" value={selectedUser.id} />
                <label>
                  <span>Firma</span>
                  <select name="firma_id" required>
                    <option value="">Izaberite firmu</option>
                    {firme.map((firma) => (
                      <option key={firma.id} value={firma.id}>
                        {firma.naziv}
                        {firma.pib ? ` (${firma.pib})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedUser.rola === "korisnik_agencije" ? (
                  <label className="single-checkbox">
                    <input name="glavni_radnik" type="checkbox" />
                    Glavni radnik
                  </label>
                ) : (
                  <p className="compact-note">
                    Klijent dobija pristup firmi, a prava se podešavaju u matrici.
                  </p>
                )}
                <button type="submit">Dodijeli firmu</button>
              </form>
            </section>
          </div>
        </section>
      ) : null}

      {selectedUser && selectedAssignment ? (
        <section className="admin-panel permission-panel" id="prava-korisnika" style={{ scrollMarginTop: "24px" }}>
          <div className="panel-header">
            <div>
              <h3>Prava za {selectedAssignment.firma.naziv}</h3>
              <p className="muted-text">{selectedUser.rola === "klijent" ? "Prava klijenta — izaberite preglede koje može da vidi. Unos i izmjene nijesu omogućeni." : "Prava radnika — podesite dozvoljene radnje po modulima."}</p>
              <span>{selectedUser.korisnicko_ime}</span>
            </div>
            <span>{selectedUser.rola === "klijent" ? "Klijentski portal" : "Radnik agencije"}</span>
          </div>

          {selectedUser.rola !== "klijent" ? <p className="admin-note">
            Pravo <strong>Pregled</strong> određuje da li radnik vidi modul u
            glavnom meniju za izabranu firmu. KIF/KUF se prikazuje kada radnik
            ima pregled ulaznih ili izlaznih računa.
          </p> : <p className="admin-note">Fiskalizacija se podešava zasebno. Ove opcije uređuju knjigovodstvene preglede klijenta.</p>}

          <form key={`${selectedUser.id}:${selectedFirmaId}`} className="compact-form" action={saveUserPermissionMatrix}>
            <input name="korisnik_id" type="hidden" value={selectedUser.id} />
            <input name="firma_id" type="hidden" value={selectedFirmaId} />
            {selectedUser.rola === "klijent" ? <>
              <input name="matrica" type="hidden" value="klijent" />
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Pregled</th><th>Dozvoljen pristup</th></tr></thead>
                  <tbody>{clientPermissionGroups.map((group) => <tr key={group.id}>
                    <td><strong>{group.label}</strong><small>{group.description}</small></td>
                    <td><label className="single-checkbox">
                      <input type="checkbox" name="pregledi" value={group.id}
                        defaultChecked={group.modules.every((module) => selectedPermissionActions.has(`${module}:view`))} />
                      {group.label}
                    </label></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </> : <>
              <input name="matrica" type="hidden" value="radnik" />
            <div className="permission-matrix-wrap">
              <table className="permission-matrix">
                <thead>
                  <tr>
                    <th>Pravo</th>
                    {moduli.map((modul) => (
                      <th key={modul}>{modul.replaceAll("_", " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {akcije.map((akcija) => (
                    <tr key={akcija}>
                      <th>{actionLabel(akcija)}</th>
                      {moduli.map((modul) => {
                        const value = `${modul}:${akcija}`;

                        return (
                          <td key={value}>
                            <label className="matrix-checkbox">
                              <input
                                defaultChecked={selectedPermissionActions.has(value)}
                                name="prava"
                                type="checkbox"
                                value={value}
                              />
                              <span>{modul} {akcija}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>}
            <button type="submit">Sačuvaj prava</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
