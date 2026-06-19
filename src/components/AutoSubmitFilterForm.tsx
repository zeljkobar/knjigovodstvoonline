"use client";

import { useRouter } from "next/navigation";
import {
  useRef,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from "react";

type AutoSubmitFilterFormProps = {
  action: string;
  children: ReactNode;
  className?: string;
  debounceMs?: number;
};

export function AutoSubmitFilterForm({
  action,
  children,
  className,
  debounceMs = 450
}: AutoSubmitFilterFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function submitForm(delay = 0) {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const form = formRef.current;

      if (!form) {
        return;
      }

      const formData = new FormData(form);
      const params = new URLSearchParams();

      formData.forEach((value, key) => {
        const text = String(value).trim();

        if (text && text !== "ALL") {
          params.set(key, text);
        }
      });

      const query = params.toString();

      router.push(query ? `${action}?${query}` : action);
    }, delay);
  }

  function handleChange(event: ChangeEvent<HTMLFormElement>) {
    const target = event.target as unknown as HTMLInputElement | HTMLSelectElement;
    const delay = target.type === "search" ? debounceMs : 0;

    submitForm(delay);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitForm(0);
  }

  return (
    <form
      action={action}
      className={className}
      onChange={handleChange}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      {children}
    </form>
  );
}
