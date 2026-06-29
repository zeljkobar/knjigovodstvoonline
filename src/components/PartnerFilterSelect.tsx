"use client";

import { useEffect, useId, useRef, useState } from "react";

type PartnerResult = {
  id: string;
  naziv: string;
  pib: string | null;
  scope?: string;
};

type PartnerFilterSelectProps = {
  initialId?: string;
  initialLabel?: string;
  name?: string;
};

function partnerDisplay(naziv: string, pib?: string | null) {
  return pib ? `${naziv} (${pib})` : naziv;
}

function dispatchFieldChange(input: HTMLInputElement | null) {
  input?.dispatchEvent(new Event("change", { bubbles: true }));
}

export function PartnerFilterSelect({
  initialId = "",
  initialLabel = "",
  name = "partner"
}: PartnerFilterSelectProps) {
  const listId = useId();
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const valueToId = useRef(new Map<string, string>());
  const latestQueryRef = useRef("");
  const [query, setQuery] = useState(initialLabel);
  const [results, setResults] = useState<PartnerResult[]>([]);

  function setSelectedPartnerId(id: string, shouldNotify = false) {
    if (!hiddenRef.current || hiddenRef.current.value === id) {
      return;
    }

    hiddenRef.current.value = id;

    if (shouldNotify) {
      dispatchFieldChange(hiddenRef.current);
    }
  }

  useEffect(() => {
    const cleanQuery = query.trim();
    latestQueryRef.current = cleanQuery;

    if (cleanQuery.length < 2) {
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

        const exactId = map.get(cleanQuery);
        const uniqueId = found.length === 1 ? found[0].id : "";

        if (exactId || (cleanQuery.length >= 3 && uniqueId)) {
          setSelectedPartnerId(exactId || uniqueId, true);
        }
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
  }, [query]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    const trimmed = value.trim();
    const matchedId = valueToId.current.get(trimmed) ?? "";

    setQuery(value);
    setSelectedPartnerId(matchedId);
  }

  return (
    <div className="partner-filter-field">
      <input
        autoComplete="off"
        list={listId}
        name={`${name}_q`}
        onChange={handleChange}
        placeholder="Svi partneri — naziv ili PIB"
        type="search"
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
      <input defaultValue={initialId} name={name} ref={hiddenRef} type="hidden" />
    </div>
  );
}
