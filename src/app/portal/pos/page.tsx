import Link from "next/link";
import { PosTerminal } from "@/app/agencija/pos/PosTerminal";
import { PortalAutoPrint } from "@/components/PortalAutoPrint";
import {
  directPortalPaymentMethods,
  hasDirectPortalPermission,
  podgoricaBusinessDate
} from "@/lib/direct-portal-policy";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { fiscalAdminApi } from "@/lib/fiscal-admin-api";
import { normalizeWarehouseSalesType, selectPosPrice } from "@/lib/pos-pricing";
import { prisma } from "@/lib/prisma";
import { createAndFiscalizePortalPosSale } from "./actions";

type SearchParams = {
  obrada?: string;
  poruka?: string;
  uspjeh?: string;
  greska?: string;
  racun?: string;
};

async function loadPaymentProfile(
  fiscalCompanyId: string | null | undefined,
  environment: string | null | undefined,
  actor: { id: string; name: string }
) {
  if (!fiscalCompanyId || !["Test", "Production"].includes(environment ?? "")) {
    return { available: false, paymentPolicy: null as string | null };
  }

  if (environment === "Test") {
    return { available: true, paymentPolicy: null as string | null };
  }

  try {
    const response = await fiscalAdminApi.getProductionProfile(
      fiscalCompanyId,
      actor
    );
    return {
      available: true,
      paymentPolicy: response.data.paymentPolicy ?? null
    };
  } catch {
    return { available: false, paymentPolicy: null as string | null };
  }
}

function invoiceId(value: string | undefined) {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
    ? value
    : null;
}

function validationMessage(code: string) {
  const messages: Record<string, string> = {
    cijena: "Naplata nije pokrenuta. Provjerite aktivne cijene artikala.",
    iznos: "Naplata nije pokrenuta. Ukupan iznos računa nije ispravan.",
    ino_kupac:
      "Strani kupac trenutno nije podržan u POS naplati. Koristite klasičnu fakturu ili kontaktirajte podršku.",
    kupac: "Za izabrano plaćanje odaberite ispravnog kupca.",
    lager:
      "Nema dovoljno robe na stanju, a negativan lager je onemogućen.",
    magacin:
      "Izabrana kasa nema povezani magacin za robu koja prati zalihe.",
    placanje:
      "Izabrani način plaćanja nije dozvoljen aktivnim fiskalnim profilom.",
    podesavanje: "POS trenutno nije spreman. Kontaktirajte podršku.",
    prava: "Nemate pravo za ovu naplatu ili je poslovna godina zaključana.",
    smjena: "Otvorite smjenu na izabranoj kasi prije naplate.",
    stavke: "Provjerite stavke računa i pokušajte ponovo.",
    submission:
      "Naplata nije pokrenuta zbog neispravnog identiteta zahtjeva. Osvježite stranicu."
  };

  return messages[code] ?? "Naplata nije pokrenuta. Provjerite unesene podatke.";
}

export default async function PortalPosPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    requireDirectPortalContext({ modul: "pos", akcija: "view" }, "/portal/pos")
  ]);
  const businessDate = podgoricaBusinessDate();
  const fiscalCompanyId =
    context.firma.fiscalCompanyLink?.fiscal_api_company_id;
  const environment = context.firma.fiscalCompanyLink?.fiscal_environment;
  const successId = invoiceId(params.uspjeh);
  const failedId = invoiceId(params.greska);
  const pendingId =
    params.poruka === "u_toku" ? invoiceId(params.racun) : null;
  const actor = {
    id: context.user.id,
    name: context.user.korisnicko_ime
  };
  const [
    settings,
    registers,
    sourceItems,
    successInvoice,
    failedInvoice,
    pendingInvoice,
    paymentProfile
  ] = await Promise.all([
    prisma.posPodesavanje.findFirst({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id
      }
    }),
    prisma.posRegister.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false
      },
      include: {
        magacin: { select: { naziv: true, tip_prodaje: true } },
        smjene: {
          where: {
            poslovna_godina_id: context.year.id,
            opened_by: context.user.id,
            status: "OPEN"
          },
          select: { id: true },
          take: 1
        }
      },
      orderBy: { naziv: "asc" }
    }),
    prisma.artikal.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        aktivan: true,
        is_deleted: false
      },
      include: {
        grupa_artikla: true,
        jedinica_mjere: true,
        pdv_stopa: true,
        cijene: {
          where: {
            aktivna: true,
            is_deleted: false,
            tip: {
              in: [
                "RETAIL",
                "MALOPRODAJNA",
                "WHOLESALE",
                "VELEPRODAJNA"
              ]
            },
            OR: [{ vazi_od: null }, { vazi_od: { lte: businessDate } }],
            AND: [
              {
                OR: [
                  { vazi_do: null },
                  { vazi_do: { gte: businessDate } }
                ]
              }
            ]
          },
          orderBy: [{ vazi_od: "desc" }, { created_at: "desc" }]
        }
      },
      orderBy: { naziv: "asc" }
    }),
    successId
      ? prisma.fiskalniIzlazniRacun.findFirst({
          where: {
            id: successId,
            agencija_id: context.user.agencija_id!,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            sales_channel: "POS",
            status: "FINALIZED",
            fiscal_status: "Fiscalized",
            iic: { not: null },
            jikr: { not: null },
            qr_code_data: { not: null },
            is_deleted: false
          },
          select: {
            id: true,
            broj_racuna: true,
            ukupno_sa_pdv: true,
            fiscal_environment: true
          }
        })
      : null,
    failedId
      ? prisma.fiskalniIzlazniRacun.findFirst({
          where: {
            id: failedId,
            agencija_id: context.user.agencija_id!,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            sales_channel: "POS",
            fiscal_status: "FiscalizationFailed",
            is_deleted: false
          },
          select: {
            id: true,
            interni_broj: true,
            correlation_id: true
          }
        })
      : null,
    pendingId
      ? prisma.fiskalniIzlazniRacun.findFirst({
          where: {
            id: pendingId,
            agencija_id: context.user.agencija_id!,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            sales_channel: "POS",
            fiscal_status: "FiscalizationPending",
            is_deleted: false
          },
          select: { id: true }
        })
      : null,
    loadPaymentProfile(fiscalCompanyId, environment, actor)
  ]);

  const canCreate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "pos",
    akcija: "create"
  });

  registers.sort((left, right) => {
    if (left.id === settings?.podrazumijevana_kasa_id) return -1;
    if (right.id === settings?.podrazumijevana_kasa_id) return 1;
    return left.naziv.localeCompare(right.naziv, "sr-Latn-ME");
  });

  if (!settings?.aktivan || !registers.length) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <p className="eyebrow">Prodaja</p>
            <h2>SUMMA POS</h2>
            <p className="muted-text">
              POS još nije povezan sa fiskalnom kasom ove firme.
            </p>
          </div>
        </header>
        <section className="admin-panel">
          <p>
            Kontaktirajte podršku da završi povezivanje poslovnog prostora,
            uređaja i kase.
          </p>
          <Link className="secondary-button" href="/portal/pomoc">
            Otvori pomoć
          </Link>
        </section>
      </div>
    );
  }

  const items = sourceItems.flatMap((item) =>
    registers.flatMap((register) => {
      const warehouseType = normalizeWarehouseSalesType(
        register.magacin?.tip_prodaje
      );
      const price = selectPosPrice(
        item.cijene,
        register.magacin_id,
        warehouseType
      );

      return price
        ? [
            {
              id: item.id,
              registerId: register.id,
              code: item.sifra,
              name: item.naziv,
              barcode: item.barkod,
              group: item.grupa_artikla?.naziv ?? "Ostalo",
              unit: item.jedinica_mjere.oznaka,
              netPrice: Number(price.cijena_bez_pdv),
              grossPrice: Number(price.cijena_sa_pdv),
              vatPercent: context.firma.pdv_obveznik
                ? Number(item.pdv_stopa?.procenat ?? 0)
                : 0,
              warehouseType
            }
          ]
        : [];
    })
  );
  const paymentMethods = paymentProfile.available
    ? directPortalPaymentMethods(paymentProfile.paymentPolicy)
    : [];
  const businessDateInYear =
    businessDate >= context.year.datum_od &&
    businessDate <= context.year.datum_do;
  const blockedReason = context.readiness.blocksChanges
    ? context.readiness.label
    : context.year.zakljucena
      ? "Poslovna godina je zaključana. Nova naplata nije dozvoljena."
      : !businessDateInYear
        ? "Poslovni datum nije u rasponu izabrane poslovne godine. Naplata je blokirana."
      : !paymentProfile.available
        ? "Fiskalni profil trenutno nije dostupan. Naplata je bezbjedno blokirana."
        : !paymentMethods.length
          ? "Aktivna politika plaćanja nije podržana. Kontaktirajte podršku."
          : null;

  return (
    <div className="admin-stack pos-page">
      <header className="admin-header pos-page-header">
        <div>
          <p className="eyebrow">Mobilna prodaja</p>
          <h2>SUMMA POS</h2>
          <p className="muted-text">
            Dodirnite artikal, izaberite plaćanje i naplatite.
          </p>
        </div>
        <div className="header-actions">
          {canCreate ? (
            <Link className="secondary-button" href="/portal/pos/smjene">
              Smjene
            </Link>
          ) : null}
          <Link className="secondary-button" href="/portal/racuni">
            Računi
          </Link>
          <Link className="secondary-button" href="/portal/izvjestaji">
            Izvještaji
          </Link>
        </div>
      </header>

      {successInvoice ? (
        <>
          {settings.automatska_stampa ? (
            <PortalAutoPrint invoiceId={successInvoice.id} width={settings.format_stampe === "80" ? "80" : "58"} />
          ) : null}
        <div className="status-banner success">
          Račun {successInvoice.broj_racuna} je fiskalizovan.{" "}
          {successInvoice.fiscal_environment === "Test" ? (
            <strong className="status-pill status-pill--warning">TEST</strong>
          ) : null}{" "}
          <Link href={`/portal/racuni/${successInvoice.id}`}>Otvori detalj</Link>
        </div>
        </>
      ) : null}
      {pendingInvoice ? (
        <div className="status-banner warning">
          Zahtjev je već primljen. Provjerite status računa prije novog pokušaja.{" "}
          <Link href={`/portal/racuni/${pendingInvoice.id}`}>Otvori račun</Link>
        </div>
      ) : null}
      {failedInvoice ? (
        <div className="status-banner error">
          Račun {failedInvoice.interni_broj} je sačuvan, ali fiskalizacija nije
          uspjela. Pokušajte ponovo iz kontrolisanog toka ili kontaktirajte podršku.
          {failedInvoice.correlation_id
            ? ` (ID: ${failedInvoice.correlation_id})`
            : ""}{" "}
          <Link href={`/portal/racuni/${failedInvoice.id}`}>Otvori detalj</Link>
        </div>
      ) : null}
      {params.poruka && params.poruka !== "u_toku" ? (
        <p className="status-banner error">
          {validationMessage(params.poruka)}
        </p>
      ) : null}
      {params.obrada && successInvoice ? (
        <div className="status-banner warning">
          Fiskalizacija je završena, ali prateća računovodstvena obrada zahtijeva
          intervenciju podrške.
        </div>
      ) : null}
      {settings.zahtijeva_smjenu && canCreate ? (
        <p className="muted-text">
          Naplata zahtijeva vašu otvorenu smjenu na izabranoj kasi.{" "}
          <Link href="/portal/pos/smjene">Otvori ili zatvori smjenu</Link>
        </p>
      ) : null}

      <PosTerminal
        blockedReason={blockedReason}
        canCreate={canCreate}
        items={items}
        partnerCompanyOnly
        partnerQuickCreateEndpoint="/api/portal/partners/quick-create"
        partnerSearchEndpoint="/api/portal/partners/search"
        paymentMethods={paymentMethods}
        registers={registers.map((register) => ({
          id: register.id,
          name: register.naziv,
          code: register.sifra,
          defaultPayment: register.podrazumijevano_placanje,
          warehouseType: normalizeWarehouseSalesType(
            register.magacin?.tip_prodaje
          ),
          warehouseName: register.magacin?.naziv ?? null,
          shiftOpen: register.smjene.length > 0
        }))}
        requiresShift={settings.zahtijeva_smjenu}
        saleAction={createAndFiscalizePortalPosSale}
      />
    </div>
  );
}
