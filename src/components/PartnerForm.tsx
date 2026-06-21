"use client";

import { useState } from "react";

type PartnerFormProps = {
  action: (formData: FormData) => void;
  buttonLabel?: string;
  firmaId?: string;
  initialValues?: PartnerFormValues;
  mode?: "agency" | "global";
};

export type PartnerFormValues = {
  adresa?: string | null;
  drzava?: string | null;
  email?: string | null;
  grad?: string | null;
  id?: string;
  maticni_broj?: string | null;
  naziv?: string | null;
  napomena?: string | null;
  pdv_broj?: string | null;
  pib?: string | null;
  rok_placanja_dana?: number | null;
  scope?: "AGENCY" | "COMPANY" | "GLOBAL";
  sifra_u_firmi?: string | null;
  telefon?: string | null;
  tip_komitenta?: string | null;
  web_sajt?: string | null;
};

type IrmsCompany = {
  address?: string;
  city?: string;
  email?: string;
  legalName?: string;
  name?: string;
  phone?: string;
  pib?: string;
  registrationNumber?: string;
  webAddress?: string;
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

export function PartnerForm({
  action,
  buttonLabel = "Sačuvaj partnera",
  firmaId,
  initialValues,
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
      const response = await fetch("/api/irms/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pib })
      });
      const result = (await response.json()) as {
        data?: IrmsCompany;
        message?: string;
      };

      if (!response.ok || !result.data) {
        setIrmsStatus({
          message: result.message ?? "Podaci nisu pronadjeni u IRMS-u.",
          type: "error"
        });
        return;
      }

      setFormValue(form, "naziv", result.data.name || result.data.legalName);
      setFormValue(form, "pib", result.data.pib);
      setFormValue(form, "maticni_broj", result.data.registrationNumber);
      setFormValue(form, "adresa", result.data.address);
      setFormValue(form, "grad", result.data.city);
      setFormValue(form, "telefon", result.data.phone);
      setFormValue(form, "email", result.data.email);
      setFormValue(form, "web_sajt", result.data.webAddress);

      setIrmsStatus({
        message: "Podaci su povuceni iz IRMS registra. Pregledajte ih prije snimanja.",
        type: "success"
      });
    } catch {
      setIrmsStatus({
        message: "Greska pri komunikaciji sa IRMS servisom.",
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
