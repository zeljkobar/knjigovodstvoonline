import type { Virman } from "@prisma/client";
import { saveManualPaymentOrder } from "@/app/agencija/virmani/actions";
import {
  manualPaymentOrderAmountInput,
  manualPaymentOrderStatuses
} from "@/lib/manual-payment-orders";
import { dateInputValue } from "@/lib/payroll";

type InitialOrder = Pick<
  Virman,
  | "id"
  | "status"
  | "naziv_sablona"
  | "nalogodavac_naziv"
  | "nalogodavac_mjesto"
  | "nalogodavac_racun"
  | "svrha_placanja"
  | "primalac_naziv"
  | "primalac_mjesto"
  | "primalac_racun"
  | "iznos"
  | "sifra_placanja"
  | "model_zaduzenja"
  | "poziv_na_broj_zaduzenja"
  | "model_odobrenja"
  | "poziv_na_broj_odobrenja"
  | "datum_valute"
>;

export function ManualPaymentOrderEditor({
  initialOrder,
  canCreate,
  canUpdate,
  canExport,
  locked
}: {
  initialOrder: InitialOrder;
  canCreate: boolean;
  canUpdate: boolean;
  canExport: boolean;
  locked: boolean;
}) {
  const isNew = !initialOrder.id;
  const isTemplate = initialOrder.status === manualPaymentOrderStatuses.template;
  const canEditCurrent = isNew ? canCreate : canUpdate;
  const canSaveDraft = isTemplate ? canCreate : canEditCurrent;
  const canSaveTemplate = isTemplate ? canUpdate : canCreate;
  const canPreparePrint = canExport && (isTemplate ? canCreate : canEditCurrent);
  const disabled = !(canEditCurrent || canCreate || (isTemplate && canUpdate));

  return (
    <section className="admin-panel manual-payment-order-editor">
      <div className="panel-header manual-payment-order-editor-header">
        <div>
          <h3>{isTemplate ? "Šablon virmana" : isNew ? "Novi virman" : "Nacrt virmana"}</h3>
          <span>Podatke možete korigovati prije čuvanja i štampe.</span>
        </div>
      </div>

      <form action={saveManualPaymentOrder}>
        {initialOrder.id ? <input name="id" type="hidden" value={initialOrder.id} /> : null}

        <label className="manual-payment-order-template-name">
          <span>Naziv šablona</span>
          <input
            defaultValue={initialOrder.naziv_sablona ?? ""}
            disabled={!canSaveTemplate}
            name="naziv_sablona"
            placeholder="npr. Mjesečna članarina"
          />
        </label>

        <div className="payroll-payment-order-form">
          <div className="payroll-payment-order-form-title">KREDITNI NALOG</div>

          <div className="payroll-payment-order-form-group payroll-payment-order-form-payer">
            <label>
              <input defaultValue={initialOrder.nalogodavac_naziv} disabled={disabled} name="nalogodavac_naziv" />
              <span>Nalogodavac — naziv</span>
            </label>
            <label>
              <input defaultValue={initialOrder.nalogodavac_mjesto ?? ""} disabled={disabled} name="nalogodavac_mjesto" />
              <span>Nalogodavac — mjesto</span>
            </label>
          </div>

          <label className="payroll-payment-order-form-payer-account">
            <input defaultValue={initialOrder.nalogodavac_racun ?? ""} disabled={disabled} name="nalogodavac_racun" />
            <span>Broj računa nalogodavca</span>
          </label>

          <label className="payroll-payment-order-form-purpose">
            <textarea defaultValue={initialOrder.svrha_placanja} disabled={disabled} name="svrha_placanja" rows={3} />
            <span>Svrha plaćanja</span>
          </label>

          <div className="payroll-payment-order-form-row payroll-payment-order-form-debit">
            <label>
              <input defaultValue={initialOrder.model_zaduzenja ?? ""} disabled={disabled} name="model_zaduzenja" />
              <span>Model</span>
            </label>
            <label>
              <input defaultValue={initialOrder.poziv_na_broj_zaduzenja ?? ""} disabled={disabled} name="poziv_na_broj_zaduzenja" />
              <span>Poziv na broj zaduženja</span>
            </label>
          </div>

          <div className="payroll-payment-order-form-row payroll-payment-order-form-amount">
            <label>
              <input defaultValue={manualPaymentOrderAmountInput(initialOrder.iznos)} disabled={disabled} inputMode="decimal" min="0" name="iznos" step="0.01" type="number" />
              <span>Iznos (EUR)</span>
            </label>
            <label>
              <input defaultValue={initialOrder.sifra_placanja ?? ""} disabled={disabled} name="sifra_placanja" />
              <span>Šifra transakcije</span>
            </label>
          </div>

          <div className="payroll-payment-order-form-group payroll-payment-order-form-recipient">
            <label>
              <input defaultValue={initialOrder.primalac_naziv} disabled={disabled} name="primalac_naziv" />
              <span>Primalac — naziv</span>
            </label>
            <label>
              <input defaultValue={initialOrder.primalac_mjesto ?? ""} disabled={disabled} name="primalac_mjesto" />
              <span>Primalac — mjesto</span>
            </label>
          </div>

          <label className="payroll-payment-order-form-recipient-account">
            <input defaultValue={initialOrder.primalac_racun ?? ""} disabled={disabled} name="primalac_racun" />
            <span>Broj računa primaoca</span>
          </label>

          <div className="payroll-payment-order-form-row payroll-payment-order-form-credit">
            <label>
              <input defaultValue={initialOrder.model_odobrenja ?? ""} disabled={disabled} name="model_odobrenja" />
              <span>Model</span>
            </label>
            <label>
              <input defaultValue={initialOrder.poziv_na_broj_odobrenja ?? ""} disabled={disabled} name="poziv_na_broj_odobrenja" />
              <span>Poziv na broj odobrenja</span>
            </label>
          </div>

          <label className="payroll-payment-order-form-date">
            <input defaultValue={dateInputValue(initialOrder.datum_valute)} disabled={disabled} name="datum_valute" type="date" />
            <span>Datum valute</span>
          </label>
        </div>

        {locked && !isTemplate ? (
          <p className="admin-message">Poslovna godina je zaključana. Virman se može samo pregledati.</p>
        ) : null}

        <div className="form-actions manual-payment-order-actions">
          {canSaveDraft && !locked ? (
            <button className="secondary-button" name="intent" type="submit" value="draft">
              {isTemplate ? "Napravi nacrt iz šablona" : "Sačuvaj nacrt"}
            </button>
          ) : null}
          {canSaveTemplate ? (
            <button className="secondary-button" name="intent" type="submit" value="template">
              {isTemplate ? "Sačuvaj izmjene šablona" : "Sačuvaj kao šablon"}
            </button>
          ) : null}
          {canPreparePrint && !locked ? (
            <button className="primary-button" name="intent" type="submit" value="print">
              Sačuvaj i pripremi štampu
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
