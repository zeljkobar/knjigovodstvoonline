"use client";

import { useState } from "react";
import { lookupIrmsCompany } from "@/lib/irms-browser-bridge";

type PartnerFormProps = {
  action: (formData: FormData) => void;
  buttonLabel?: string;
  firmaId?: string;
  initialValues?: PartnerFormValues;
  irmsEndpoint?: string;
  mode?: "agency" | "global";
};

export type PartnerFormValues = {
  adresa?: string | null;
  drzava?: string | null;
  email?: string | null;
  grad?: string | null;
  id?: string;
  is_foreign?: boolean | null;
  country_code?: string | null;
  country_name?: string | null;
  foreign_tax_number?: string | null;
  maticni_broj?: string | null;
  naziv?: string | null;
  napomena?: string | null;
  pdv_broj?: string | null;
  pib?: string | null;
  pravna_forma?: string | null;
  rok_placanja_dana?: number | null;
  scope?: "AGENCY" | "COMPANY" | "GLOBAL";
  sifra_djelatnosti?: string | null;
  sifra_u_firmi?: string | null;
  telefon?: string | null;
  tip_komitenta?: string | null;
  web_sajt?: string | null;
  datum_registracije?: Date | string | null;
};

function setFormValue(form: HTMLFormElement, name: string, value?: string) {
  const cleanValue = String(value ?? "").trim();

  if (!cleanValue) {
    return;
  }

  const field = form.elements.namedItem(name);

  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
  ) {
    field.value = cleanValue;
  }
}

function normalizeActivityCode(activity?: string) {
  const cleanActivity = String(activity ?? "").trim();
  if (!cleanActivity) {
    return "";
  }

  const match = cleanActivity.match(/^(\d{2,6}(?:\.\d{1,2})?)/);
  return match?.[1] ?? cleanActivity.split(",")[0].trim();
}

function normalizeDateInput(value?: Date | string | null) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }

  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  return "";
}

export function PartnerForm({
  action,
  buttonLabel = "Sačuvaj partnera",
  firmaId,
  initialValues,
  irmsEndpoint = "/api/irms/search",
  mode = "agency"
}: PartnerFormProps) {
  const [irmsStatus, setIrmsStatus] = useState<{
    message: string;
    type: "success" | "error" | "loading" | "";
  }>({
    message: "",
    type: ""
  });
  const [isSearching, setIsSearching] = useState(false);

  async function lookupIrmsPartner(form: HTMLFormElement) {
    const pibField = form.elements.namedItem("pib");
    const pib =
      pibField instanceof HTMLInputElement ? String(pibField.value).trim() : "";

    if (!/^\d{8}$/.test(pib)) {
      setIrmsStatus({
        message: "PIB mora imati tacno 8 cifara.",
        type: "error"
      });
      return;
    }

    setIsSearching(true);
    setIrmsStatus({
      message: "Pretrazujem IRMS registar...",
      type: "loading"
    });

    try {
      const data = await lookupIrmsCompany(pib, irmsEndpoint);

      setFormValue(form, "naziv", data.name || data.legalName);
      setFormValue(form, "pib", data.pib);
      setFormValue(form, "maticni_broj", data.registrationNumber);
      setFormValue(form, "pravna_forma", data.legalForm);
      setFormValue(form, "sifra_djelatnosti", normalizeActivityCode(data.activity));
      setFormValue(form, "datum_registracije", normalizeDateInput(data.founded));
      setFormValue(form, "adresa", data.address);
      setFormValue(form, "grad", data.city);
      setFormValue(form, "telefon", data.phone);
      setFormValue(form, "email", data.email);
      setFormValue(form, "web_sajt", data.webAddress);

      setIrmsStatus({
        message: "Podaci su povuceni iz IRMS registra. Pregledajte ih prije snimanja.",
        type: "success"
      });
    } catch (error) {
      setIrmsStatus({
        message: error instanceof Error ? error.message : "Greška pri komunikaciji sa IRMS servisom.",
        type: "error"
      });
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <form action={action} className="admin-form partner-form">
      {initialValues?.id ? (
        <input name="partner_id" type="hidden" value={initialValues.id} />
      ) : null}
      {firmaId ? <input name="firma_id" type="hidden" value={firmaId} /> : null}
      <label>
        <span>Naziv partnera</span>
        <input defaultValue={initialValues?.naziv ?? ""} name="naziv" required />
      </label>
      {mode === "agency" ? (
        <label>
          <span>Vidljivost</span>
          <select name="scope" defaultValue={initialValues?.scope ?? "AGENCY"} required>
            <option value="AGENCY">Cijela agencija</option>
            <option value="COMPANY">Samo aktivna firma</option>
          </select>
        </label>
      ) : null}
      {mode === "agency" ? (
        <label>
          <span>Tip partnera</span>
          <select
            name="tip_komitenta"
            defaultValue={initialValues?.tip_komitenta ?? "kupac_dobavljac"}
            required
          >
            <option value="kupac">Kupac</option>
            <option value="dobavljac">Dobavljač</option>
            <option value="kupac_dobavljac">Kupac i dobavljač</option>
            <option value="ostalo">Ostalo</option>
          </select>
        </label>
      ) : null}
      <label>
        <span>PIB</span>
        <input defaultValue={initialValues?.pib ?? ""} inputMode="numeric" name="pib" />
      </label>
      <label>
        <span>PDV broj</span>
        <input defaultValue={initialValues?.pdv_broj ?? ""} name="pdv_broj" />
      </label>
      <label>
        <span>Matični broj</span>
        <input defaultValue={initialValues?.maticni_broj ?? ""} name="maticni_broj" />
      </label>
      <label>
        <span>Pravna forma</span>
        <input defaultValue={initialValues?.pravna_forma ?? ""} name="pravna_forma" />
      </label>
      <label>
        <span>Šifra djelatnosti</span>
        <input
          defaultValue={initialValues?.sifra_djelatnosti ?? ""}
          name="sifra_djelatnosti"
        />
      </label>
      <label>
        <span>Datum registracije</span>
        <input
          defaultValue={normalizeDateInput(initialValues?.datum_registracije)}
          name="datum_registracije"
          type="date"
        />
      </label>
      <label>
        <span>Šifra u firmi</span>
        <input defaultValue={initialValues?.sifra_u_firmi ?? ""} name="sifra_u_firmi" />
      </label>
      <label>
        <span>Rok plaćanja</span>
        <input
          defaultValue={initialValues?.rok_placanja_dana ?? ""}
          min="0"
          name="rok_placanja_dana"
          type="number"
        />
      </label>
      <label>
        <span>Adresa</span>
        <input defaultValue={initialValues?.adresa ?? ""} name="adresa" />
      </label>
      <label>
        <span>Grad</span>
        <input defaultValue={initialValues?.grad ?? ""} name="grad" />
      </label>
      <label>
        <span>Država</span>
        <input defaultValue={initialValues?.drzava ?? "Crna Gora"} name="drzava" />
      </label>
      <label>
        <span>Tip prometa</span>
        <select name="is_foreign" defaultValue={initialValues?.is_foreign ? "1" : "0"}>
          <option value="0">Domaći komitent</option>
          <option value="1">Ino komitent</option>
        </select>
      </label>
      <label>
        <span>Šifra države</span>
        <input defaultValue={initialValues?.country_code ?? ""} name="country_code" placeholder="npr. DE" />
      </label>
      <label>
        <span>Naziv države</span>
        <input defaultValue={initialValues?.country_name ?? ""} name="country_name" />
      </label>
      <label>
        <span>Inostrani poreski broj</span>
        <input defaultValue={initialValues?.foreign_tax_number ?? ""} name="foreign_tax_number" />
      </label>
      <label>
        <span>Telefon</span>
        <input defaultValue={initialValues?.telefon ?? ""} name="telefon" />
      </label>
      <label>
        <span>Email</span>
        <input defaultValue={initialValues?.email ?? ""} name="email" type="email" />
      </label>
      <label>
        <span>Web sajt</span>
        <input defaultValue={initialValues?.web_sajt ?? ""} name="web_sajt" />
      </label>
      <label className="form-wide">
        <span>Napomena</span>
        <textarea defaultValue={initialValues?.napomena ?? ""} name="napomena" rows={3} />
      </label>

      {irmsStatus.message ? (
        <p className={`irms-status irms-status-${irmsStatus.type}`}>
          {irmsStatus.message}
        </p>
      ) : null}

      <div className="company-form-actions">
        <button
          disabled={isSearching}
          onClick={(event) => {
            const form = event.currentTarget.form;

            if (form) {
              void lookupIrmsPartner(form);
            }
          }}
          type="button"
        >
          {isSearching ? "Pretrazujem..." : "Pretraga IRMS"}
        </button>
        <button type="submit">{buttonLabel}</button>
      </div>
    </form>
  );
}
