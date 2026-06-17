"use client";

import { useState } from "react";

type CompanyFormProps = {
  action: (formData: FormData) => void;
  currentYear: number;
};

type IrmsCompany = {
  name?: string;
  legalName?: string;
  pib?: string;
  registrationNumber?: string;
  legalForm?: string;
  status?: string;
  founded?: string;
  activity?: string;
  address?: string;
  city?: string;
  email?: string;
  phone?: string;
  webAddress?: string;
};

const subjectTypes = [
  ["DOO", "DOO"],
  ["PREDUZETNIK", "Preduzetnik"],
  ["NVO", "NVO"],
  ["PAUSALAC", "Pausalac"],
  ["FIZICKO_LICE", "Fizicko lice"],
  ["DRUGO", "Drugo"]
];

function splitActivity(activity?: string) {
  const value = String(activity ?? "").trim();
  const match = value.match(/^(\d{2}(?:[\.,]\d{2})?)\s*[-–—,]?\s*(.*)$/);

  if (!match) {
    return {
      code: "",
      description: value
    };
  }

  return {
    code: match[1].replace(",", "."),
    description: match[2]?.trim() ?? ""
  };
}

function subjectTypeFromLegalForm(legalForm?: string) {
  const value = String(legalForm ?? "").toUpperCase();

  if (value.includes("PREDUZET")) {
    return "PREDUZETNIK";
  }

  if (value.includes("NEVLAD") || value.includes("NVO")) {
    return "NVO";
  }

  if (value.includes("FIZI")) {
    return "FIZICKO_LICE";
  }

  return "DOO";
}

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

export function CompanyForm({ action, currentYear }: CompanyFormProps) {
  const [irmsStatus, setIrmsStatus] = useState<{
    type: "success" | "error" | "loading" | "";
    message: string;
  }>({
    type: "",
    message: ""
  });
  const [isSearching, setIsSearching] = useState(false);

  async function lookupIrmsCompany(form: HTMLFormElement) {
    const pibField = form.elements.namedItem("pib");
    const pib =
      pibField instanceof HTMLInputElement ? String(pibField.value).trim() : "";

    if (!/^\d{8}$/.test(pib)) {
      setIrmsStatus({
        type: "error",
        message: "PIB mora imati tacno 8 cifara."
      });
      return;
    }

    setIsSearching(true);
    setIrmsStatus({
      type: "loading",
      message: "Pretrazujem IRMS registar..."
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
        message?: string;
        data?: IrmsCompany;
      };

      if (!response.ok || !result.data) {
        setIrmsStatus({
          type: "error",
          message: result.message ?? "Podaci nisu pronadjeni u IRMS-u."
        });
        return;
      }

      const activity = splitActivity(result.data.activity);

      setFormValue(form, "naziv", result.data.name || result.data.legalName);
      setFormValue(form, "skraceni_naziv", result.data.name);
      setFormValue(form, "pib", result.data.pib);
      setFormValue(form, "maticni_broj", result.data.registrationNumber);
      setFormValue(form, "sifra_djelatnosti", activity.code);
      setFormValue(form, "opis_djelatnosti", activity.description);
      setFormValue(form, "adresa", result.data.address);
      setFormValue(form, "opstina", result.data.city);
      setFormValue(form, "grad", result.data.city);
      setFormValue(form, "telefon", result.data.phone);
      setFormValue(form, "email", result.data.email);
      setFormValue(form, "web_sajt", result.data.webAddress);
      setFormValue(form, "tip_subjekta", subjectTypeFromLegalForm(result.data.legalForm));

      setIrmsStatus({
        type: "success",
        message: "Podaci su povuceni iz IRMS registra. Pregledajte ih prije snimanja."
      });
    } catch {
      setIrmsStatus({
        type: "error",
        message: "Greska pri komunikaciji sa IRMS servisom."
      });
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <form className="admin-form company-form" action={action}>
      <label>
        <span>Naziv firme</span>
        <input name="naziv" required />
      </label>
      <label>
        <span>Skraceni naziv</span>
        <input name="skraceni_naziv" />
      </label>
      <label>
        <span>Tip subjekta</span>
        <select name="tip_subjekta" defaultValue="DOO" required>
          {subjectTypes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>PIB</span>
        <input name="pib" inputMode="numeric" />
      </label>
      <label>
        <span>PDV broj</span>
        <input name="pdv_broj" />
      </label>
      <label>
        <span>Maticni broj</span>
        <input name="maticni_broj" />
      </label>
      <label>
        <span>Sifra djelatnosti</span>
        <input name="sifra_djelatnosti" />
      </label>
      <label>
        <span>Opis djelatnosti</span>
        <input name="opis_djelatnosti" />
      </label>
      <label>
        <span>Poslovna godina</span>
        <input
          defaultValue={currentYear}
          max={currentYear + 2}
          min="2000"
          name="poslovna_godina"
          required
          type="number"
        />
      </label>
      <label>
        <span>Adresa</span>
        <input name="adresa" />
      </label>
      <label>
        <span>Opstina</span>
        <input name="opstina" />
      </label>
      <label>
        <span>Grad</span>
        <input name="grad" />
      </label>
      <label>
        <span>Telefon</span>
        <input name="telefon" />
      </label>
      <label>
        <span>Email</span>
        <input name="email" type="email" />
      </label>
      <label>
        <span>Web sajt</span>
        <input name="web_sajt" />
      </label>
      <label>
        <span>Drzava</span>
        <input defaultValue="Crna Gora" name="drzava" />
      </label>
      <label className="single-checkbox form-checkbox">
        <input name="pdv_obveznik" type="checkbox" />
        <span>PDV obveznik</span>
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
              void lookupIrmsCompany(form);
            }
          }}
          type="button"
        >
          {isSearching ? "Pretrazujem..." : "Pretraga IRMS"}
        </button>
        <button type="submit">Dodaj firmu</button>
      </div>
    </form>
  );
}
