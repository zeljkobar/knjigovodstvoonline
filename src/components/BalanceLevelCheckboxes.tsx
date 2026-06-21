"use client";

import { useState } from "react";

type BalanceLevelCheckboxesProps = {
  defaultLevel: number | null;
  defaultSummaryOnly?: boolean;
};

export function BalanceLevelCheckboxes({
  defaultLevel,
  defaultSummaryOnly = false
}: BalanceLevelCheckboxesProps) {
  const [level, setLevel] = useState<number | null>(defaultLevel);
  const [summaryOnly, setSummaryOnly] = useState(defaultSummaryOnly);

  return (
    <div className="balance-options">
      <label className="balance-summary-toggle">
        <input
          checked={summaryOnly}
          name="samo_zbir"
          onChange={(event) => setSummaryOnly(event.currentTarget.checked)}
          type="checkbox"
          value="1"
        />
        <span>Samo zbir</span>
      </label>

      <fieldset className="balance-level-options">
        <legend>Zbir po</legend>
        {[1, 2, 3, 4].map((option) => (
          <label key={option}>
            <input
              checked={level === option}
              name="nivo"
              onChange={() => setLevel((current) => (current === option ? null : option))}
              type="checkbox"
              value={option}
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
