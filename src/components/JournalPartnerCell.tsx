"use client";

import { useEffect, useId, useRef, useState } from "react";

type PartnerResult = {
  id: string;
  naziv: string;
  pib: string | null;
  scope?: string;
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
  const listId = useId();
  const [query, setQuery] = useState(
    initialNaziv ? partnerDisplay(initialNaziv, initialPib) : ""
  );
  const [partnerId, setPartnerId] = useState(initialId);
  const [results, setResults] = useState<PartnerResult[]>([]);
  const valueToId = useRef(new Map<string, string>());
  const latestQueryRef = useRef("");

  useEffect(() => {
    const cleanQuery = query.trim();
    latestQueryRef.current = cleanQuery;

    if (disabled || cleanQuery.length < 2) {
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

        if (latestQueryRef.current !== cleanQuery) {
          return;
        }

        const found = data.results ?? [];
        const map = new Map<string, string>();

        for (const partner of found) {
          map.set(partnerDisplay(partner.naziv, partner.pib), partner.id);
        }

        valueToId.current = map;
        setResults(found);
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
  }, [query, disabled]);

  function handleChange(value: string) {
    setQuery(value);
    setPartnerId(valueToId.current.get(value.trim()) ?? "");
    onActivity?.();
  }

  return (
    <div className="journal-partner-cell">
      <input
        autoComplete="off"
        data-partner-input="true"
        disabled={disabled}
        list={listId}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => onActivity?.()}
        placeholder="Naziv ili PIB"
        value={query}
      />
      <datalist id={listId}>
        {results.map((partner) => (
          <option
            key={partner.id}
            label={[partner.pib, partner.scope].filter(Boolean).join(" · ")}
            value={partnerDisplay(partner.naziv, partner.pib)}
          />
        ))}
      </datalist>
      <input name="komitent_id" type="hidden" value={partnerId} />
    </div>
  );
}
