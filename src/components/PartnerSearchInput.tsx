"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  QuickPartnerCreateModal,
  type QuickPartnerResult
} from "@/components/QuickPartnerCreateModal";

type PartnerResult = {
  id: string;
  label: string;
  naziv: string;
  pib: string | null;
  scope: string;
  isForeign?: boolean;
  countryCode?: string | null;
  countryName?: string | null;
  defaultKufAccountCode?: string | null;
  defaultKufVatRateCode?: string | null;
};

type PartnerSearchInputProps = {
  disabled?: boolean;
  initialPartner?: PartnerResult | null;
  label?: string;
  name: string;
  required?: boolean;
};

function normalizePib(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

export function PartnerSearchInput({
  disabled = false,
  initialPartner = null,
  label = "Partner",
  name,
  required = false
}: PartnerSearchInputProps) {
  const [selected, setSelected] = useState<PartnerResult | null>(initialPartner);
  const [query, setQuery] = useState(initialPartner?.label ?? "");
  const [results, setResults] = useState<PartnerResult[]>([]);
  const [status, setStatus] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detectedPib, setDetectedPib] = useState("");
  const latestQueryRef = useRef("");

  const selectedLabel = useMemo(() => selected?.label ?? "", [selected]);

  useEffect(() => {
    setSelected(initialPartner);
    setQuery(initialPartner?.label ?? "");
    setResults([]);
    setStatus("");
    setDetectedPib("");
  }, [initialPartner]);

  useEffect(() => {
    if (selected && query === selectedLabel) {
      return;
    }

    const cleanQuery = query.trim();
    latestQueryRef.current = cleanQuery;

    if (disabled || cleanQuery.length < 2) {
      setResults([]);
      setStatus("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/partners/search?q=${encodeURIComponent(cleanQuery)}`,
          {
            signal: controller.signal
          }
        );

        if (!response.ok) {
          setResults([]);
          setStatus("Pretraga partnera trenutno nije dostupna.");
          return;
        }

        const data = (await response.json()) as { results?: PartnerResult[] };

        if (latestQueryRef.current !== cleanQuery) {
          return;
        }

        const found = data.results ?? [];
        setResults(found);
        setStatus(found.length ? "" : "Nema partnera za unesenu pretragu.");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setStatus("Pretraga partnera trenutno nije dostupna.");
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, query, selected, selectedLabel]);

  useEffect(() => {
    async function handleFiscalSupplier(event: Event) {
      const { tin, name } = (event as CustomEvent<{ tin?: string; name?: string }>).detail ?? {};
      const pib = normalizePib(String(tin ?? ""));

      if (!pib || disabled) {
        return;
      }

      setIsSearching(true);
      setDetectedPib(pib);
      setStatus(`Tražim dobavljača po PIB-u ${pib}...`);

      try {
        const response = await fetch(
          `/api/partners/search?q=${encodeURIComponent(pib)}&exactPib=1`
        );
        const data = (await response.json()) as { results?: PartnerResult[] };
        const partner = (data.results ?? []).find((item) => item.pib === pib);

        if (partner) {
          selectPartner(partner);
          setStatus(`Dobavljač pronađen: ${partner.label}`);
        } else {
          setSelected(null);
          setQuery(String(name ?? "").trim() || pib);
          setResults([]);
          setStatus(`Dobavljač sa PIB-om ${pib} nije pronađen. Unesite ga ručno.`);
        }
      } catch {
        setStatus("Pretraga dobavljača po PIB-u nije uspjela.");
      } finally {
        setIsSearching(false);
      }
    }

    document.addEventListener("fiscal-supplier-detected", handleFiscalSupplier);
    return () => document.removeEventListener("fiscal-supplier-detected", handleFiscalSupplier);
  }, [disabled]);

  function selectPartner(partner: PartnerResult) {
    setSelected(partner);
    setDetectedPib("");
    setQuery(partner.label);
    setResults([]);
    setStatus("");
    document.dispatchEvent(
      new CustomEvent("partner-selected", {
        detail: {
          partnerId: partner.id,
          isForeign: partner.isForeign ?? false,
          countryCode: partner.countryCode ?? null,
          countryName: partner.countryName ?? null,
          defaultKufAccountCode: partner.defaultKufAccountCode ?? null,
          defaultKufVatRateCode: partner.defaultKufVatRateCode ?? null
        }
      })
    );
  }

  function openCreateModal() {
    if (disabled) {
      return;
    }

    setIsCreateOpen(true);
    setResults([]);
    setStatus("");
  }

  function handleCreatedPartner(partner: QuickPartnerResult) {
    selectPartner(partner);
    setIsCreateOpen(false);
  }

  return (
    <div className="partner-search-field">
      <label>
        <span>{label}</span>
        <div className="partner-search-input-row">
          <input
            autoComplete="off"
            disabled={disabled}
            placeholder="Kucajte naziv ili PIB..."
            required={required && !selected?.id}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setDetectedPib("");
            }}
            onFocus={() => {
              if (query.trim().length >= 2 && !selected) {
                setStatus("");
              }
            }}
          />
          <button
            aria-label="Dodaj novog partnera"
            disabled={disabled}
            title="Dodaj novog partnera"
            type="button"
            onClick={openCreateModal}
          >
            +
          </button>
        </div>
      </label>
      <input name={name} type="hidden" value={selected?.id ?? ""} />
      {isSearching ? <p className="partner-search-status">Pretraga...</p> : null}
      {status && !isSearching ? <p className="partner-search-status">{status}</p> : null}
      {results.length > 0 || (query.trim().length >= 2 && !selected) ? (
        <div className="partner-search-results">
          {results.map((partner) => (
            <button
              key={partner.id}
              type="button"
              onClick={() => selectPartner(partner)}
            >
              <strong>{partner.naziv}</strong>
              <small>
                {[partner.pib, partner.scope].filter(Boolean).join(" · ")}
              </small>
            </button>
          ))}
          <button className="partner-search-create-option" type="button" onClick={openCreateModal}>
            <strong>+ Dodaj novog partnera</strong>
            <small>{query.trim() ? `"${query.trim()}"` : "Ručni unos"}</small>
          </button>
        </div>
      ) : null}
      {isCreateOpen ? (
        <QuickPartnerCreateModal
          initialName={query}
          initialPib={detectedPib}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreatedPartner}
        />
      ) : null}
    </div>
  );
}
