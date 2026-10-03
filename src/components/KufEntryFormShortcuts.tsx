"use client";

import { useEffect } from "react";

function focusNextField(form: HTMLFormElement, current: HTMLElement) {
  const fields = Array.from(
    form.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']), select, textarea, button, a[href]"
    )
  ).filter((field) => {
    const disabled = field instanceof HTMLButtonElement ||
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
      ? field.disabled
      : false;

    return !disabled && field.tabIndex !== -1;
  });

  const currentIndex = fields.indexOf(current);
  const nextField = fields[currentIndex + 1] ?? fields[0];
  nextField?.focus();
}

export function KufEntryFormShortcuts({ formId, focusAfterSave = false }: {
  formId: string;
  focusAfterSave?: boolean;
}) {
  useEffect(() => {
    if (!focusAfterSave) return;
    const frame = requestAnimationFrame(() => {
      const form = document.getElementById(formId);
      const input = form?.querySelector<HTMLInputElement>('input[type="url"]');
      if (input && !input.disabled) {
        input.focus({ preventScroll: true });
        form?.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [formId, focusAfterSave]);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (!target || !form?.contains(target)) {
        return;
      }

      if (event.key === "F9" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
        return;
      }

      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      focusNextField(form, target);
    }

    form.addEventListener("keydown", onKeyDown);

    function onPartnerSelected(event: Event) {
      const { defaultKufAccountCode } = (event as CustomEvent<{
        defaultKufAccountCode?: string | null;
      }>).detail ?? {};

      if (!defaultKufAccountCode) {
        return;
      }

      const accountField = form?.elements.namedItem("expense_account_code");
      if (accountField instanceof HTMLSelectElement) {
        accountField.value = defaultKufAccountCode;
      }
    }

    document.addEventListener("partner-selected", onPartnerSelected);
    return () => {
      form.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("partner-selected", onPartnerSelected);
    };
  }, [formId]);

  return null;
}
