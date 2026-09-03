"use client";

import { useEffect, useRef, useState } from "react";
import {
  QuickPartnerCreateModal,
  type QuickPartnerResult
} from "@/components/QuickPartnerCreateModal";

type PartnerResult = {
  id: string;
  label?: string;
  naziv: string;
  pib: string | null;
  scope?: string;
  isForeign?: boolean;
  countryCode?: string | null;
  countryName?: string | null;
  defaultKufAccountCode?: string | null;
  defaultKufVatRateCode?: string | null;
};

type JournalPartnerCellProps = {
  disabled?: boolean;
  initialId?: string;
  initialNaziv?: string;
  initialPib?: string | null;
  onActivity?: () => void;
};

function partnerDisplay(naziv: string, pib?: string | null) {
  return pib ? `${naziv} (${pib})` : naziv;
}

export function JournalPartnerCell({
  disabled = false,
  initialId = "",
  initialNaziv = "",
  initialPib = null,
  onActivity
}: JournalPartnerCellProps) {
  const [query, setQuery] = useState(
    initialNaziv ? partnerDisplay(initialNaziv, initialPib) : ""
  );
  const [partnerId, setPartnerId] = useState(initialId);
  const [results, setResults] = useState<PartnerResult[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const latestQueryRef = useRef("");

  useEffect(() => {
    const cleanQuery = query.trim();
    latestQueryRef.current = cleanQuery;

    if (disabled || !isSearchOpen || partnerId || cleanQuery.length < 2) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/partners/search?q=${encodeURIComponent(cleanQuery)}`,
          {
            signal: controller.signal
          }
        );

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { results?: PartnerResult[] };

        if (controller.signal.aborted || latestQueryRef.current !== cleanQuery) {
          return;
        }

        setResults(data.results ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResults([]);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, disabled, isSearchOpen, partnerId]);

  function handleChange(value: string) {
    setResults([]);
    setIsSearchOpen(true);
    setQuery(value);
    setPartnerId("");
    onActivity?.();
  }

  function selectPartner(partner: PartnerResult) {
    setIsSearchOpen(false);
    setQuery(partnerDisplay(partner.naziv, partner.pib));
    setPartnerId(partner.id);
    setResults([]);
    setIsCreateOpen(false);
    onActivity?.();
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

    setResults([]);
    setIsCreateOpen(true);
    setIsSearchOpen(false);
    onActivity?.();
  }

  function handleCreatedPartner(partner: QuickPartnerResult) {
    selectPartner(partner);
  }

  return (
    <div
      className="journal-partner-cell"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsSearchOpen(false);
          setResults([]);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isSearchOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsSearchOpen(false);
          setResults([]);
        }
      }}
    >
      <div className="partner-search-input-row">
        <input
          autoComplete="off"
          data-partner-input="true"
          disabled={disabled}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => {
            setIsSearchOpen(true);
            onActivity?.();
          }}
          placeholder="Naziv ili PIB"
          value={query}
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
      {!disabled && isSearchOpen && !partnerId && query.trim().length >= 2 ? (
        <div className="partner-search-results">
          {results.map((partner) => (
            <button key={partner.id} type="button" onClick={() => selectPartner(partner)}>
              <strong>{partner.naziv}</strong>
              <small>{[partner.pib, partner.scope].filter(Boolean).join(" · ")}</small>
            </button>
          ))}
          <button className="partner-search-create-option" type="button" onClick={openCreateModal}>
            <strong>+ Dodaj novog partnera</strong>
            <small>{query.trim() ? `"${query.trim()}"` : "Ručni unos"}</small>
          </button>
        </div>
      ) : null}
      <input name="komitent_id" type="hidden" value={partnerId} />
      {isCreateOpen ? (
        <QuickPartnerCreateModal
          initialName={query}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreatedPartner}
        />
      ) : null}
    </div>
  );
}
