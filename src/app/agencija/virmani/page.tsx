import { Prisma, type Virman } from "@prisma/client";
import Link from "next/link";
import { ManualPaymentOrderEditor } from "@/components/ManualPaymentOrderEditor";
import {
  getManualPaymentOrderContext,
  manualPaymentOrderAmountInput,
  manualPaymentOrderStatuses
} from "@/lib/manual-payment-orders";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  deleteManualPaymentOrder,
  printManualPaymentOrders
} from "./actions";

type Tab = "novi" | "nacrti" | "odstampano" | "sabloni";

type PageProps = {
  searchParams?: Promise<{
    tab?: string;
    id?: string;
    sablon?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  nacrt_sacuvan: "Nacrt virmana je sačuvan.",
  sablon_sacuvan: "Šablon virmana je sačuvan.",
  virman_obrisan: "Virman je obrisan.",
  godina_zakljucena: "Poslovna godina je zaključana.",
  naziv_sablona_obavezan: "Unesite naziv šablona.",
  iznos_neispravan: "Iznos nije ispravan.",
  dopunite_virman: "Dopunite obavezna polja i unesite iznos veći od nule.",
  virman_nije_pronadjen: "Virman nije pronađen u aktivnoj firmi.",
  izaberite_virman: "Izaberite najmanje jedan virman za štampu.",
  nemate_pravo: "Nemate pravo za ovu radnju."
};

function validTab(value: string | undefined): Tab {
  return ["novi", "nacrti", "odstampano", "sabloni"].includes(value ?? "")
    ? (value as Tab)
    : "novi";
}

function displayDate(value: Date | null) {
  return value?.toLocaleDateString("sr-Latn-ME") ?? "—";
}

function defaultPaymentDate(from: Date, to: Date) {
  const now = new Date();
  const value = now < from ? from : now > to ? to : now;
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

export default async function ManualPaymentOrdersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = validTab(params?.tab);
  const context = await getManualPaymentOrderContext("view");

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
      </section>
    );
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled virmana.</p>
      </section>
    );
  }

  const scope = {
    agencija_id: context.user.agencija_id,
    firma_id: context.firma.id,
    is_deleted: false
  } as const;
  const [drafts, printed, templates, canCreate, canUpdate, canDelete, canExport] =
    await Promise.all([
      prisma.virman.findMany({
        where: {
          ...scope,
          poslovna_godina_id: context.godina.id,
          status: manualPaymentOrderStatuses.draft
        },
        orderBy: { updated_at: "desc" }
      }),
      prisma.virman.findMany({
        where: {
          ...scope,
          poslovna_godina_id: context.godina.id,
          status: manualPaymentOrderStatuses.printed
        },
        orderBy: [{ odstampan_at: "desc" }, { updated_at: "desc" }]
      }),
      prisma.virman.findMany({
        where: { ...scope, status: manualPaymentOrderStatuses.template },
        orderBy: [{ naziv_sablona: "asc" }, { updated_at: "desc" }]
      }),
      hasPermission(context.user, { firmaId: context.firma.id, modul: "virmani", akcija: "create" }),
      hasPermission(context.user, { firmaId: context.firma.id, modul: "virmani", akcija: "update" }),
      hasPermission(context.user, { firmaId: context.firma.id, modul: "virmani", akcija: "delete" }),
      hasPermission(context.user, { firmaId: context.firma.id, modul: "virmani", akcija: "export" })
    ]);

  const selectedDraft =
    tab === "nacrti" ? drafts.find((order) => order.id === params?.id) ?? null : null;
  const selectedTemplate =
    tab === "sabloni" ? templates.find((order) => order.id === params?.id) ?? null : null;
  const sourceTemplate =
    tab === "novi" ? templates.find((order) => order.id === params?.sablon) ?? null : null;
  const source = selectedDraft ?? selectedTemplate ?? sourceTemplate;
  const mainAccount = context.firma.bankovni_racuni[0]?.broj_racuna ?? null;
  const location = context.firma.grad ?? context.firma.opstina ?? null;
  const initialOrder = source
    ? {
        ...source,
        id: sourceTemplate ? "" : source.id,
        status: sourceTemplate ? manualPaymentOrderStatuses.draft : source.status,
        naziv_sablona: sourceTemplate ? null : source.naziv_sablona,
        nalogodavac_naziv: source.nalogodavac_naziv || context.firma.naziv,
        nalogodavac_mjesto: source.nalogodavac_mjesto ?? location,
        nalogodavac_racun: source.nalogodavac_racun ?? mainAccount,
        datum_valute: sourceTemplate
          ? defaultPaymentDate(context.godina.datum_od, context.godina.datum_do)
          : source.datum_valute
      }
    : {
        id: "",
        status: manualPaymentOrderStatuses.draft,
        naziv_sablona: null,
        nalogodavac_naziv: context.firma.naziv,
        nalogodavac_mjesto: location,
        nalogodavac_racun: mainAccount,
        svrha_placanja: "",
        primalac_naziv: "",
        primalac_mjesto: null,
        primalac_racun: null,
        iznos: new Prisma.Decimal(0),
        sifra_placanja: null,
        model_zaduzenja: null,
        poziv_na_broj_zaduzenja: null,
        model_odobrenja: null,
        poziv_na_broj_odobrenja: null,
        datum_valute: defaultPaymentDate(context.godina.datum_od, context.godina.datum_do)
      };

  const showEditor = tab === "novi" || Boolean(selectedDraft) || Boolean(selectedTemplate);
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack manual-payment-orders-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Dashboard / Virmani</p>
          <h2>Virmani</h2>
          <p>{context.firma.naziv} · {context.godina.godina}</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}
      {!mainAccount ? (
        <p className="admin-message">
          Firma nema aktivan bankovni račun. Broj računa nalogodavca unesite ručno.
        </p>
      ) : null}

      <nav className="manual-payment-order-tabs" aria-label="Vrste virmana">
        <Link className={tab === "novi" ? "active" : ""} href="/agencija/virmani?tab=novi">Novi virman</Link>
        <Link className={tab === "nacrti" ? "active" : ""} href="/agencija/virmani?tab=nacrti">Nacrti ({drafts.length})</Link>
        <Link className={tab === "odstampano" ? "active" : ""} href="/agencija/virmani?tab=odstampano">Odštampani ({printed.length})</Link>
        <Link className={tab === "sabloni" ? "active" : ""} href="/agencija/virmani?tab=sabloni">Šabloni ({templates.length})</Link>
      </nav>

      {showEditor ? (
        <ManualPaymentOrderEditor
          canCreate={canCreate}
          canExport={canExport}
          canUpdate={canUpdate}
          initialOrder={initialOrder}
          locked={context.godina.zakljucena}
        />
      ) : null}

      {tab === "nacrti" ? (
        <PaymentOrderList
          canDelete={canDelete && !context.godina.zakljucena}
          canExport={canExport}
          empty="Nema sačuvanih nacrta."
          orders={drafts}
          tab="nacrti"
        />
      ) : null}

      {tab === "odstampano" ? (
        <PaymentOrderList
          canDelete={canDelete && !context.godina.zakljucena}
          canExport={canExport}
          empty="Još nema odštampanih virmana."
          orders={printed}
          tab="odstampano"
        />
      ) : null}

      {tab === "sabloni" ? (
        <section className="admin-panel">
          <div className="panel-header"><h3>Šabloni</h3><span>{templates.length} ukupno</span></div>
          {templates.length === 0 ? <p className="empty-state">Nema sačuvanih šablona.</p> : (
            <div className="manual-payment-order-list">
              {templates.map((order) => (
                <article key={order.id}>
                  <div>
                    <strong>{order.naziv_sablona}</strong>
                    <span>{order.primalac_naziv || "Primalac nije unesen"}</span>
                  </div>
                  <div className="button-row">
                    <Link className="secondary-button" href={`/agencija/virmani?tab=novi&sablon=${order.id}`}>Koristi</Link>
                    <Link className="secondary-button" href={`/agencija/virmani?tab=sabloni&id=${order.id}`}>Otvori</Link>
                    {canDelete ? (
                      <form action={deleteManualPaymentOrder}>
                        <input name="id" type="hidden" value={order.id} />
                        <button className="danger-button" type="submit">Obriši</button>
                      </form>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <p className="compact-note">
        Ovaj modul služi samo za pripremu i štampu platnih naloga. Ne knjiži promet i ne mijenja bankovne izvode.
      </p>
    </div>
  );
}

type OrderListItem = Virman;

function PaymentOrderList({
  orders,
  tab,
  empty,
  canExport,
  canDelete
}: {
  orders: OrderListItem[];
  tab: "nacrti" | "odstampano";
  empty: string;
  canExport: boolean;
  canDelete: boolean;
}) {
  return (
    <section className="admin-panel">
      <div className="panel-header">
        <h3>{tab === "nacrti" ? "Sačuvani nacrti" : "Istorija štampe"}</h3>
        <span>{orders.length} ukupno</span>
      </div>
      {orders.length === 0 ? <p className="empty-state">{empty}</p> : (
        <form action={printManualPaymentOrders}>
          <div className="manual-payment-order-list">
            {orders.map((order) => (
              <article key={order.id}>
                <label className="manual-payment-order-select">
                  <input disabled={!canExport} name="id" type="checkbox" value={order.id} />
                  <span />
                </label>
                <div>
                  <strong>{order.primalac_naziv || "Primalac nije unesen"}</strong>
                  <span>{order.svrha_placanja || "Svrha nije unesena"}</span>
                  <small>{manualPaymentOrderAmountInput(order.iznos)} EUR · {displayDate(order.datum_valute)}</small>
                </div>
                <div className="button-row">
                  {tab === "nacrti" ? (
                    <Link className="secondary-button" href={`/agencija/virmani?tab=nacrti&id=${order.id}`}>Otvori</Link>
                  ) : null}
                  {canDelete ? (
                    <button className="danger-button" formAction={deleteManualPaymentOrder} name="delete_id" type="submit" value={order.id}>Obriši</button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {canExport ? (
            <div className="form-actions manual-payment-order-list-actions">
              <button className="primary-button" type="submit">Štampaj izabrane</button>
            </div>
          ) : null}
        </form>
      )}
    </section>
  );
}
