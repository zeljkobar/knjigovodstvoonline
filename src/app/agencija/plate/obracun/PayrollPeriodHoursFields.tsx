"use client";

import { useMemo, useState } from "react";
import {
  allowedPayrollPeriod,
  calculateAutomaticPayrollHours,
  normalizePayrollPeriod
} from "@/lib/payroll-hours";

type PayrollPeriodHoursFieldsProps = {
  calculationFrom: string;
  calculationTo: string;
  employmentFrom?: string | null;
  employmentTo?: string | null;
  initialFrom?: string | null;
  initialTo?: string | null;
  initialHours: number;
  monthlyScheduledHours: number;
};

export function PayrollPeriodHoursFields({
  calculationFrom,
  calculationTo,
  employmentFrom,
  employmentTo,
  initialFrom,
  initialTo,
  initialHours,
  monthlyScheduledHours
}: PayrollPeriodHoursFieldsProps) {
  const allowed = useMemo(
    () =>
      allowedPayrollPeriod({
        calculationFrom,
        calculationTo,
        employmentFrom,
        employmentTo
      }) ?? { from: calculationFrom, to: calculationTo },
    [calculationFrom, calculationTo, employmentFrom, employmentTo]
  );
  const initialPeriod = useMemo(
    () =>
      normalizePayrollPeriod({
        requestedFrom: initialFrom,
        requestedTo: initialTo,
        allowed
      }),
    [allowed, initialFrom, initialTo]
  );
  const initialAutomaticHours = calculateAutomaticPayrollHours({
    calculationFrom,
    calculationTo,
    periodFrom: initialPeriod.from,
    periodTo: initialPeriod.to,
    monthlyScheduledHours
  });
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);
  const [hours, setHours] = useState(initialHours);
  const [manualOverride, setManualOverride] = useState(initialHours !== initialAutomaticHours);
  const automaticHours = calculateAutomaticPayrollHours({
    calculationFrom,
    calculationTo,
    periodFrom: from,
    periodTo: to,
    monthlyScheduledHours
  });
  const invalidPeriod = !from || !to || from > to;

  function updateFrom(nextFrom: string) {
    const nextAutomaticHours = calculateAutomaticPayrollHours({
      calculationFrom,
      calculationTo,
      periodFrom: nextFrom,
      periodTo: to,
      monthlyScheduledHours
    });

    setFrom(nextFrom);

    if (!manualOverride) {
      setHours(nextAutomaticHours);
    }
  }

  function updateTo(nextTo: string) {
    const nextAutomaticHours = calculateAutomaticPayrollHours({
      calculationFrom,
      calculationTo,
      periodFrom: from,
      periodTo: nextTo,
      monthlyScheduledHours
    });

    setTo(nextTo);

    if (!manualOverride) {
      setHours(nextAutomaticHours);
    }
  }

  function applyAutomaticHours() {
    setHours(automaticHours);
    setManualOverride(false);
  }

  return (
    <div className="payroll-period-fields">
      <label>
        <span>Datum od</span>
        <input
          name="datum_od"
          type="date"
          value={from}
          min={allowed.from}
          max={to || allowed.to}
          required
          onChange={(event) => updateFrom(event.target.value)}
        />
      </label>
      <label>
        <span>Datum do</span>
        <input
          name="datum_do"
          type="date"
          value={to}
          min={from || allowed.from}
          max={allowed.to}
          required
          onChange={(event) => updateTo(event.target.value)}
        />
      </label>
      <label>
        <span>Sati za obračun</span>
        <input
          name="ukupno_sati"
          type="number"
          value={hours}
          min="0"
          required
          onChange={(event) => {
            setHours(Number(event.target.value));
            setManualOverride(true);
          }}
        />
      </label>
      <div className="payroll-hours-summary">
        <span>
          Automatski prijedlog: <strong>{automaticHours} sati</strong>
        </span>
        {invalidPeriod ? (
          <small className="control-issue-error">Datum od mora biti prije ili jednak datumu do.</small>
        ) : manualOverride || hours !== automaticHours ? (
          <>
            <small className="control-issue-warning">
              Ručno izmijenjeno: obračun će koristiti {hours} umjesto {automaticHours} sati.
            </small>
            <button className="table-button" type="button" onClick={applyAutomaticHours}>
              Vrati automatske sate
            </button>
          </>
        ) : (
          <small>Broj sati prati izabrani period i mjesečni fond radnika.</small>
        )}
      </div>
    </div>
  );
}
