import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { posPaymentLabels } from "@/lib/pos-reports";
import { prisma } from "@/lib/prisma";
import { closePortalPosShift, openPortalPosShift } from "./actions";

type SearchParams = { poruka?: string };

const dateTimeFormatter = new Intl.DateTimeFormat("sr-Latn-ME", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Podgorica"
});

function money(value: { toString(): string }) {
  const raw = value.toString();
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const formattedWhole = BigInt(whole || "0").toLocaleString("sr-Latn-ME");

  return `${negative ? "-" : ""}${formattedWhole},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function formatDate(value: Date) {
  return dateTimeFormatter.format(value);
}

export default async function PortalPosShiftsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    requireDirectPortalContext(
      { modul: "pos", akcija: "create" },
      "/portal/pos/smjene"
    )
  ]);
  const agencijaId = context.user.agencija_id!;
  const [settings, registers, shifts] = await Promise.all([
    prisma.posPodesavanje.findFirst({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id
      },
      select: { zahtijeva_smjenu: true }
    }),
    prisma.posRegister.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false
      },
      include: {
        smjene: {
          where: {
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            status: "OPEN"
          },
          select: { opened_by: true },
          take: 1
        }
      },
      orderBy: { naziv: "asc" }
    }),
    prisma.posSmjena.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        poslovna_godina_id: context.year.id,
        opened_by: context.user.id,
        pos_register: {
          agencija_id: agencijaId,
          firma_id: context.firma.id,
          aktivan: true,
          is_deleted: false
        }
      },
      include: {
        pos_register: { select: { naziv: true, sifra: true } }
      },
      orderBy: { opened_at: "desc" },
      take: 100
    })
  ]);

  const messages: Record<string, string> = {
    otvorena: "Smjena je otvorena.",
    zatvorena: "Presjek je sačuvan i smjena je zatvorena.",
    vec_otvorena: "Već imate otvorenu smjenu na izabranoj kasi.",
    kasa_zauzeta: "Na izabranoj kasi smjenu je otvorio drugi korisnik.",
    nije_otvorena:
      "Smjena nije otvorena, nije vaša ili kasa više nije aktivna.",
    iznos: "Unesite ispravan početni iznos gotovine.",
    kasa: "Izabrana kasa nije dostupna.",
    prava: "Poslovna godina je zaključana ili nemate pravo na ovu akciju.",
    pokusaj: "Stanje smjene se promijenilo. Osvježite stranicu i pokušajte ponovo."
  };
  const successfulMessage = ["otvorena", "zatvorena"].includes(
    params.poruka ?? ""
  );
  const locked = context.year.zakljucena;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">POS / Smjene</p>
          <h2>Moja smjena</h2>
          <p className="muted-text">
            Otvorite smjenu prije naplate i napravite presjek pri predaji kase.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/pos">
            Nazad na prodaju
          </Link>
          <Link className="secondary-button" href="/portal/racuni">
            Računi
          </Link>
        </div>
      </header>

      {params.poruka && messages[params.poruka] ? (
        <p
          className={`status-banner ${successfulMessage ? "success" : "error"}`}
        >
          {messages[params.poruka]}
        </p>
      ) : null}
      {locked ? (
        <p className="status-banner error">
          Poslovna godina je zaključana. Otvaranje i zatvaranje smjena nije
          dozvoljeno.
        </p>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Otvaranje smjene</h3>
            <p className="muted-text">
              {settings?.zahtijeva_smjenu
                ? "Smjena je obavezna za naplatu na izabranoj kasi."
                : "Smjena je opciona, ali omogućava presjek prometa po radniku."}
            </p>
          </div>
          <span>Jedna otvorena po kasi</span>
        </div>

        {registers.length === 0 ? (
          <p className="muted-text">
            Nema aktivne kase. Kontaktirajte podršku da provjeri POS podešavanje.
          </p>
        ) : (
          <form action={openPortalPosShift} className="form-grid">
            <label>
              Kasa
              <select name="register_id" required defaultValue="" disabled={locked}>
                <option value="" disabled>
                  Izaberite kasu
                </option>
                {registers.map((register) => {
                  const openShift = register.smjene[0];
                  const ownShift = openShift?.opened_by === context.user.id;

                  return (
                    <option
                      key={register.id}
                      value={register.id}
                      disabled={Boolean(openShift)}
                    >
                      {register.naziv}
                      {ownShift
                        ? " — vaša smjena je otvorena"
                        : openShift
                          ? " — kasa je zauzeta"
                          : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Gotovina pri preuzimanju (€)
              <input
                name="opening_cash_amount"
                inputMode="decimal"
                defaultValue="0,00"
                required
                disabled={locked}
              />
            </label>
            <button className="primary-button" type="submit" disabled={locked}>
              Otvori smjenu
            </button>
          </form>
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Moje smjene i presjeci</h3>
            <p className="muted-text">
              Prikazane su samo smjene koje ste vi otvorili u ovoj poslovnoj
              godini.
            </p>
          </div>
          <span>{shifts.length} prikazano</span>
        </div>

        {shifts.length === 0 ? (
          <p className="muted-text">Još nemate evidentiranih smjena.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kasa</th>
                  <th>Period</th>
                  <th>Računa</th>
                  <th>Gotovina</th>
                  <th>Kartica</th>
                  <th>Virman</th>
                  <th>Ukupno</th>
                  <th>Očekivano u kasi</th>
                  <th>Status / akcija</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id}>
                    <td>
                      <strong>{shift.pos_register.naziv}</strong>
                      <br />
                      <span className="muted-text">
                        {shift.pos_register.sifra}
                      </span>
                    </td>
                    <td>
                      {formatDate(shift.opened_at)}
                      <br />
                      <span className="muted-text">
                        {shift.closed_at ? formatDate(shift.closed_at) : "u toku"}
                      </span>
                    </td>
                    <td>{shift.status === "OPEN" ? "—" : shift.invoice_count}</td>
                    <td>
                      {shift.status === "OPEN"
                        ? "—"
                        : `${money(shift.cash_total)} €`}
                    </td>
                    <td>
                      {shift.status === "OPEN"
                        ? "—"
                        : `${money(shift.card_total)} €`}
                    </td>
                    <td>
                      {shift.status === "OPEN"
                        ? "—"
                        : `${money(shift.bank_transfer_total)} €`}
                    </td>
                    <td>
                      {shift.status === "OPEN"
                        ? "—"
                        : `${money(shift.gross_total)} €`}
                    </td>
                    <td>
                      {shift.status === "OPEN"
                        ? `${money(shift.opening_cash_amount)} € početno`
                        : `${money(shift.expected_cash_amount)} €`}
                    </td>
                    <td>
                      {shift.status === "OPEN" ? (
                        <form action={closePortalPosShift}>
                          <input type="hidden" name="shift_id" value={shift.id} />
                          <input
                            type="hidden"
                            name="note"
                            value="Presjek pri predaji kase"
                          />
                          <button
                            className="primary-button"
                            type="submit"
                            disabled={locked}
                          >
                            Napravi presjek i zatvori
                          </button>
                        </form>
                      ) : (
                        <span className="status-pill success">Zatvorena</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="muted-text">
        Presjek odvojeno čuva {posPaymentLabels.CASH.toLowerCase()},{" "}
        {posPaymentLabels.CARD.toLowerCase()} i{" "}
        {posPaymentLabels.BANK_TRANSFER.toLowerCase()}. Storno dokumenti umanjuju
        iznose.
      </p>
    </div>
  );
}
