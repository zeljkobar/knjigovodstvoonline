import Link from "next/link";
import { posPaymentLabels } from "@/lib/pos-reports";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { closePosShift, openPosShift } from "./actions";

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function PosShiftsPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const [{ poruka }, ctx] = await Promise.all([searchParams, getPosContext("create")]);
  if (!ctx.firma || !ctx.year || !ctx.allowed || !ctx.user.agencija_id) {
    return <section className="admin-panel"><p>Nemate pravo upravljanja POS smjenama.</p></section>;
  }

  const [registers, shifts] = await Promise.all([
    prisma.posRegister.findMany({
      where: { agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, aktivan: true, is_deleted: false },
      orderBy: { naziv: "asc" }
    }),
    prisma.posSmjena.findMany({
      where: { agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id },
      include: {
        pos_register: { select: { naziv: true, sifra: true } },
        opened_by_user: { select: { korisnicko_ime: true } },
        closed_by_user: { select: { korisnicko_ime: true } }
      },
      orderBy: { opened_at: "desc" },
      take: 100
    })
  ]);
  const openRegisterIds = new Set(shifts.filter((shift) => shift.status === "OPEN").map((shift) => shift.pos_register_id));
  const messages: Record<string, string> = {
    otvorena: "Smjena je otvorena.",
    zatvorena: "Presjek je sačuvan i smjena je zatvorena. Novi radnik sada može otvoriti novu smjenu.",
    vec_otvorena: "Na izabranoj kasi već postoji otvorena smjena.",
    nije_otvorena: "Smjena više nije otvorena.",
    iznos: "Unesite ispravan početni iznos gotovine.",
    kasa: "Izabrana kasa nije dostupna."
  };

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS / Smjene</p><h2>Presjek i predaja kase</h2><p className="muted-text">Zatvaranje smjene čuva promet od njenog otvaranja do presjeka. Ne mijenja dnevni ili mjesečni KIF zbir.</p></div><div className="header-actions"><Link className="secondary-button" href="/agencija/pos">Prodaja</Link><Link className="secondary-button" href="/agencija/pos/izvjestaji">Izvještaji</Link></div></header>
    {poruka && messages[poruka] ? <p className={`status-banner ${["otvorena", "zatvorena"].includes(poruka) ? "success" : "error"}`}>{messages[poruka]}</p> : null}
    <section className="admin-panel"><div className="panel-header"><h3>Otvaranje smjene</h3><span>Jedna otvorena po kasi</span></div><form action={openPosShift} className="form-grid"><label>Kasa<select name="register_id" required defaultValue=""><option value="" disabled>Izaberite kasu</option>{registers.map((register) => <option key={register.id} value={register.id} disabled={openRegisterIds.has(register.id)}>{register.naziv}{openRegisterIds.has(register.id) ? " — smjena otvorena" : ""}</option>)}</select></label><label>Gotovina pri preuzimanju (€)<input name="opening_cash_amount" inputMode="decimal" defaultValue="0,00" required /></label><button className="primary-button" type="submit">Otvori smjenu</button></form></section>
    <section className="admin-panel"><div className="panel-header"><h3>Smjene i presjeci</h3><span>{shifts.length} prikazano</span></div>{shifts.length === 0 ? <p className="muted-text">Još nema evidentiranih smjena.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Kasa / radnik</th><th>Period</th><th>Računa</th><th>Gotovina</th><th>Kartica</th><th>Virman</th><th>Ukupno</th><th>Očekivano u kasi</th><th>Status / akcija</th></tr></thead><tbody>{shifts.map((shift) => <tr key={shift.id}><td><strong>{shift.pos_register.naziv}</strong><br/><span className="muted-text">{shift.opened_by_user.korisnicko_ime}{shift.closed_by_user ? ` → ${shift.closed_by_user.korisnicko_ime}` : ""}</span></td><td>{shift.opened_at.toLocaleString("sr-Latn-ME")}<br/><span className="muted-text">{shift.closed_at?.toLocaleString("sr-Latn-ME") ?? "u toku"}</span></td><td>{shift.status === "OPEN" ? "—" : shift.invoice_count}</td><td>{shift.status === "OPEN" ? "—" : `${money(shift.cash_total)} €`}</td><td>{shift.status === "OPEN" ? "—" : `${money(shift.card_total)} €`}</td><td>{shift.status === "OPEN" ? "—" : `${money(shift.bank_transfer_total)} €`}</td><td>{shift.status === "OPEN" ? "—" : `${money(shift.gross_total)} €`}</td><td>{shift.status === "OPEN" ? `${money(shift.opening_cash_amount)} € početno` : `${money(shift.expected_cash_amount)} €`}</td><td>{shift.status === "OPEN" ? <form action={closePosShift}><input type="hidden" name="shift_id" value={shift.id}/><input type="hidden" name="note" value="Presjek pri predaji kase"/><button className="primary-button" type="submit">Napravi presjek i zatvori</button></form> : <span className="status-pill success">Zatvorena</span>}</td></tr>)}</tbody></table></div>}</section>
    <p className="muted-text">Na presjeku se posebno čuvaju {posPaymentLabels.CASH.toLowerCase()}, {posPaymentLabels.CARD.toLowerCase()} i {posPaymentLabels.BANK_TRANSFER.toLowerCase()}. Storno računi umanjuju iznose jer su sačuvani kao negativni dokumenti.</p>
  </div>;
}
