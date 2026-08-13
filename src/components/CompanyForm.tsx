"use client";

import { useState } from "react";
import { lookupIrmsCompany as fetchIrmsCompany, type IrmsBrowserCompany } from "@/lib/irms-browser-bridge";

type CompanyFormProps = {
  action: (formData: FormData) => void;
  currentYear: number;
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
  const fourDigitMatch = value.match(/^(\d{4})\s*[^\p{L}\p{N}]*\s*(.*)$/u);

  if (fourDigitMatch) {
    return {
      code: fourDigitMatch[1],
      description: fourDigitMatch[2]?.trim() ?? ""
    };
  }

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

function executiveDirector(directors?: IrmsBrowserCompany["directors"]) {
  const normalizedRole = (role?: string) =>
    String(role ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

  return (
    directors?.find((director) =>
      normalizedRole(director.role).includes("IZVRSNI DIREKTOR")
    ) ?? directors?.find((director) => normalizedRole(director.role).includes("DIREKTOR"))
  );
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
      const data = await fetchIrmsCompany(pib);

      const activity = splitActivity(data.activity);
      const director = executiveDirector(data.directors);

      setFormValue(form, "naziv", data.name || data.legalName);
      setFormValue(form, "skraceni_naziv", data.shortName || data.name || data.legalName);
      setFormValue(form, "pib", data.pib);
      setFormValue(form, "maticni_broj", data.registrationNumber);
      setFormValue(form, "sifra_djelatnosti", activity.code);
      setFormValue(form, "opis_djelatnosti", activity.description);
      setFormValue(form, "adresa", data.address);
      setFormValue(form, "opstina", data.city);
      setFormValue(form, "grad", data.city);
      setFormValue(form, "telefon", data.phone);
      setFormValue(form, "email", data.email);
      setFormValue(form, "web_sajt", data.webAddress);
      setFormValue(form, "tip_subjekta", subjectTypeFromLegalForm(data.legalForm));
      setFormValue(form, "izvrsni_direktor", director?.fullName);

      setIrmsStatus({
        type: "success",
        message: "Podaci su povuceni iz IRMS registra. Pregledajte ih prije snimanja."
      });
    } catch (error) {
      setIrmsStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Greška pri komunikaciji sa IRMS servisom."
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
        <span>Izvršni direktor</span>
        <input name="izvrsni_direktor" />
      </label>
      <label>
        <span>JMBG izvršnog direktora</span>
        <input inputMode="numeric" maxLength={13} name="izvrsni_direktor_jmbg" pattern="[0-9]{13}" />
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
