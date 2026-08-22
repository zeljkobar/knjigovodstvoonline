import Link from "next/link";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { normalizeWarehouseSalesType, selectPosPrice } from "@/lib/pos-pricing";
import { PosTerminal } from "./PosTerminal";

function validationMessage(code: string) {
  const messages: Record<string, string> = {
    magacin: "Naplata nije pokrenuta. Izabrana kasa nema povezan magacin za robu koja prati zalihe.",
    lager: "Naplata nije pokrenuta. Nema dovoljno robe na stanju, a negativan lager je blokiran.",
    smjena: "Otvorite svoju smjenu na izabranoj kasi prije naplate.",
    u_toku: "Zahtjev je već primljen. Provjerite status računa prije novog pokušaja."
  };

  return messages[code] ?? "Naplata nije pokrenuta. Provjerite artikle, cijene i podešavanje kase.";
}

export default async function PosPage({ searchParams }: { searchParams: Promise<{ poruka?: string; uspjeh?: string; greska?: string; obrada?: string; racun?: string }> }) {
  const [params, ctx] = await Promise.all([searchParams, getPosContext("create")]);
  if (!ctx.firma || !ctx.year) return <section className="admin-panel"><p>Izaberite firmu i poslovnu godinu.</p></section>;
  if (!ctx.allowed) return <section className="admin-panel"><p>Nemate pravo izdavanja POS računa za ovu firmu.</p></section>;
  const vatEnabled = ctx.firma.pdv_obveznik;
  const now = new Date();
  const [settings, registers, sourceItems, successInvoice, failedInvoice] = await Promise.all([
    prisma.posPodesavanje.findUnique({ where: { firma_id: ctx.firma.id } }),
    prisma.posRegister.findMany({
      where: { agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, aktivan: true, is_deleted: false },
      include: {
        magacin: { select: { naziv: true, tip_prodaje: true } },
        smjene: {
          where: {
            poslovna_godina_id: ctx.year.id,
            opened_by: ctx.user.id,
            status: "OPEN"
          },
          select: { id: true },
          take: 1
        }
      },
      orderBy: { naziv: "asc" }
    }),
    prisma.artikal.findMany({ where: { firma_id: ctx.firma.id, aktivan: true, is_deleted: false }, include: { grupa_artikla: true, jedinica_mjere: true, pdv_stopa: true, cijene: { where: { aktivna: true, is_deleted: false, tip: { in: ["RETAIL", "MALOPRODAJNA", "WHOLESALE", "VELEPRODAJNA"] }, OR: [{ vazi_od: null }, { vazi_od: { lte: now } }], AND: [{ OR: [{ vazi_do: null }, { vazi_do: { gte: now } }] }] }, orderBy: [{ vazi_od: "desc" }, { created_at: "desc" }] } }, orderBy: { naziv: "asc" } }),
    params.uspjeh ? prisma.fiskalniIzlazniRacun.findFirst({ where: { id: params.uspjeh, firma_id: ctx.firma.id, sales_channel: "POS" }, select: { id: true, broj_racuna: true, ukupno_sa_pdv: true } }) : null,
    params.greska ? prisma.fiskalniIzlazniRacun.findFirst({ where: { id: params.greska, firma_id: ctx.firma.id, sales_channel: "POS" }, select: { id: true, interni_broj: true, fiscal_error_message: true, correlation_id: true } }) : null
  ]);
  const items = sourceItems.flatMap((item) => registers.flatMap((register) => {
    const warehouseType = normalizeWarehouseSalesType(register.magacin?.tip_prodaje);
    const price = selectPosPrice(item.cijene, register.magacin_id, warehouseType);
    return price ? [{ id: item.id, registerId: register.id, code: item.sifra, name: item.naziv, barcode: item.barkod, group: item.grupa_artikla?.naziv ?? "Ostalo", unit: item.jedinica_mjere.oznaka, netPrice: Number(price.cijena_bez_pdv), grossPrice: Number(price.cijena_sa_pdv), vatPercent: vatEnabled ? Number(item.pdv_stopa?.procenat ?? 0) : 0, warehouseType }] : [];
  }));
  if (!settings?.aktivan || !registers.length) return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Prodaja</p><h2>SUMMA POS</h2><p className="muted-text">POS još nije povezan sa fiskalnom kasom ove firme.</p></div></header><section className="admin-panel"><Link className="primary-button" href="/agencija/pos/podesavanja">Poveži kasu</Link></section></div>;
  return <div className="admin-stack pos-page"><header className="admin-header pos-page-header"><div><p className="eyebrow">Mobilna prodaja</p><h2>SUMMA POS</h2><p className="muted-text">{ctx.firma.naziv} · dodirnite artikal, izaberite plaćanje i naplatite.</p></div><div className="header-actions"><Link className="secondary-button" href="/agencija/pos/racuni">Računi</Link><Link className="secondary-button" href="/agencija/pos/izvjestaji">Izvještaji</Link><Link className="secondary-button" href="/agencija/pos/smjene">Smjene</Link><Link className="secondary-button" href="/agencija/pos/obrada">Zbirna obrada</Link><Link className="secondary-button" href="/agencija/pos/podesavanja">Podešavanja</Link></div></header>
    {successInvoice ? <div className="status-banner success">Račun {successInvoice.broj_racuna} je fiskalizovan. <Link href={`/stampa/robno/izlazne-fakture/${successInvoice.id}`}>Otvori štampu</Link></div> : null}
    {params.obrada ? <div className="status-banner error">Fiskalizacija je uspješna, ali virman račun još nije pripremljen za KIF. Otvorite <Link href="/agencija/pos/racuni">Fiskalne račune</Link> i izaberite „Završi knjiženje“.</div> : null}
    {failedInvoice ? <div className="status-banner error">Račun {failedInvoice.interni_broj} je sačuvan, ali fiskalizacija nije uspjela: {failedInvoice.fiscal_error_message} {failedInvoice.correlation_id ? `(ID: ${failedInvoice.correlation_id})` : ""}</div> : null}
    {params.poruka ? <p className={`status-banner ${params.poruka === "u_toku" ? "warning" : "error"}`}>{validationMessage(params.poruka)}{params.poruka === "u_toku" ? <> <Link href="/agencija/pos/racuni">Otvori fiskalne račune</Link>.</> : null}</p> : null}
    <PosTerminal
      items={items}
      registers={registers.map((register) => ({
        id: register.id,
        name: register.naziv,
        code: register.sifra,
        defaultPayment: register.podrazumijevano_placanje,
        warehouseType: normalizeWarehouseSalesType(register.magacin?.tip_prodaje),
        warehouseName: register.magacin?.naziv ?? null,
        shiftOpen: register.smjene.length > 0
      }))}
      requiresShift={settings.zahtijeva_smjenu}
    />
  </div>;
}
