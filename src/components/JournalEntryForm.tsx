"use client";

import {
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";

type JournalEntryFormProps = {
  action: ComponentProps<"form">["action"];
  children: ReactNode;
  className?: string;
  requiredAnalyticsAccounts?: string[];
};

function isFocusable(element: HTMLElement) {
  return (
    !element.hasAttribute("disabled") &&
    !element.hasAttribute("readonly") &&
    element.tabIndex !== -1 &&
    element.offsetParent !== null
  );
}

function focusNextField(current: HTMLElement) {
  const form = current.closest("form");

  if (!form) {
    return;
  }

  const fields = Array.from(
    form.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [tabindex]'
    )
  ).filter(isFocusable);
  const currentIndex = fields.indexOf(current);
  const nextField = fields[currentIndex + 1];

  if (nextField) {
    nextField.focus();
  }
}

function parsePositiveAmount(value: string) {
  const amount = Number(value.trim().replace(",", "."));

  return Number.isFinite(amount) && amount > 0;
}

export function JournalEntryForm({
  action,
  children,
  className,
  requiredAnalyticsAccounts = []
}: JournalEntryFormProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const requiredAnalyticsSet = new Set(requiredAnalyticsAccounts);

  function focusLineField(
    row: HTMLTableRowElement | null,
    selector: string,
    retry = true
  ) {
    const field = row?.querySelector<HTMLElement>(selector);

    if (field && isFocusable(field)) {
      field.focus();
      return true;
    }

    if (retry) {
      requestAnimationFrame(() => focusLineField(row, selector, false));
    }

    return false;
  }

  function focusNextRowAccount(current: HTMLElement) {
    const row = current.closest("tr");
    const nextRow = row?.nextElementSibling as HTMLTableRowElement | null;

    if (!focusLineField(nextRow, 'input[name="konto_sifra"]')) {
      focusNextField(current);
    }
  }

  function handleJournalEnter(target: HTMLElement) {
    const input = target instanceof HTMLInputElement ? target : null;
    const row = target.closest("tr");

    if (input?.name === "konto_sifra") {
      const accountCode = input.value.trim();

      if (accountCode && !requiredAnalyticsSet.has(accountCode)) {
        focusLineField(row, 'input[name="stavka_opis"]');
        return;
      }
    }

    if (
      input &&
      (input.name === "duguje" || input.name === "potrazuje") &&
      parsePositiveAmount(input.value)
    ) {
      focusNextRowAccount(input);
      return;
    }

    focusNextField(target);
  }

  function showError(message: string, focusTarget?: HTMLElement | null) {
    setLocalError(message);

    requestAnimationFrame(() => {
      if (focusTarget) {
        focusTarget.focus();
      }

      errorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  }

  function validateBeforeSubmit(form: HTMLFormElement) {
    const rows = Array.from(
      form.querySelectorAll<HTMLTableRowElement>(".journal-lines-table tbody tr")
    );

    for (const row of rows) {
      const accountInput = row.querySelector<HTMLInputElement>(
        'input[name="konto_sifra"]'
      );
      const partnerSelect = row.querySelector<HTMLSelectElement>(
        'select[name="komitent_id"]'
      );
      const accountCode = accountInput?.value.trim() ?? "";
      const partnerId = partnerSelect?.value.trim() ?? "";

      if (accountCode && requiredAnalyticsSet.has(accountCode) && !partnerId) {
        showError(
          `Analitika za konto ${accountCode} je obavezna.`,
          partnerSelect
        );
        return false;
      }
    }

    setLocalError(null);
    return true;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "F8") {
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.tagName === "TEXTAREA") {
      return;
    }

    event.preventDefault();
    handleJournalEnter(target);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!validateBeforeSubmit(event.currentTarget)) {
      event.preventDefault();
    }
  }

  return (
    <form
      action={action}
      className={className}
      onKeyDown={handleKeyDown}
      onSubmit={handleSubmit}
    >
      {localError ? (
        <p className="admin-message" ref={errorRef} tabIndex={-1}>
          {localError}
        </p>
      ) : null}
      {children}
    </form>
  );
}
