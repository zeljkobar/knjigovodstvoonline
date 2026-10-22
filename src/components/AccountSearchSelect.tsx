"use client";

import { createPortal } from "react-dom";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & { searchKind?: "account" | "item"; onConfirm?: () => void };
type Choice = { value: string; label: string; disabled: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join("");
}
export function accountChoices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type !== "option") return accountChoices(child.props.children);
    const label = (child.props.label ?? text(child.props.children)).replace(/\s+/g, " ").trim();
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) }];
  });
}

// Keep a real select as the form value/event source: callers may submit IDs or codes.
export function AccountSearchSelect({ children, value, defaultValue, required, disabled, id, className, onChange, searchKind = "account", onConfirm, ...props }: Props) {
  const isItem = searchKind === "item";
  const listId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const choices = accountChoices(children);
  const initial = String(value ?? defaultValue ?? choices[0]?.value ?? "");
  const [selected, setSelected] = useState(initial);
  const current = value === undefined ? selected : String(value);
  const labelFor = (key: string) => key ? choices.find(choice => choice.value === key)?.label ?? key : "";
  const [query, setQuery] = useState(() => labelFor(initial));
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const display = labelFor(current);
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = choices.filter(choice => !choice.disabled && normalize(choice.label).includes(normalize(filter))).slice(0, 80);
  useEffect(() => { setQuery(display); inputRef.current?.setCustomValidity(""); }, [display]);
  useEffect(() => {
    const form = selectRef.current?.form;
    function reset() {
      const key = String(value ?? defaultValue ?? choices[0]?.value ?? "");
      setSelected(key); setQuery(labelFor(key)); setOpen(false); inputRef.current?.setCustomValidity("");
    }
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setPosition({ left: rect.left, top: window.innerHeight - rect.bottom < 160 ? Math.max(4, rect.top - 284) : rect.bottom + 4, width: rect.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, listId]);

  function choose(choice: Choice) {
    setQuery(choice.value ? choice.label : ""); setOpen(false);
    inputRef.current?.setCustomValidity("");
    if (selectRef.current && selectRef.current.value !== choice.value) {
      selectRef.current.value = choice.value;
      selectRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  return <>
    <input
      id={id} className={className} ref={inputRef} data-account-search={isItem ? undefined : "true"} data-item-search={isItem ? "true" : undefined}
      type="text" autoComplete="off" placeholder={isItem ? "Šifra ili naziv artikla" : "Šifra ili naziv konta"}
      role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
      aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
      aria-label={props["aria-label"]} aria-describedby={props["aria-describedby"]}
      required={required} disabled={disabled} value={query}
      onFocus={event => { event.currentTarget.select(); setFilter(""); setActive(0); setOpen(true); }}
      onBlur={event => {
        setOpen(false);
        const match = choices.find(item => !item.disabled && (item.value === event.currentTarget.value || item.label === event.currentTarget.value));
        if (match) choose(match);
      }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation(); setOpen(true);
          setActive(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key === "Enter" && open) {
          event.preventDefault(); event.stopPropagation();
          if (matches[active]) { choose(matches[active]); if (matches[active].value) onConfirm?.(); }
        } else if (event.key === "Enter" && onConfirm && current && query === display) {
          event.preventDefault(); event.stopPropagation(); onConfirm();
        } else if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(display); inputRef.current?.setCustomValidity("");
        }
      }}
      onChange={event => {
        event.stopPropagation();
        const next = event.currentTarget.value;
        setQuery(next); setFilter(next); setActive(0); setOpen(true);
        const match = choices.find(item => !item.disabled && (item.label === next || item.value === next));
        event.currentTarget.setCustomValidity(next === display || (next === "" && match) ? "" : isItem ? "Izaberite artikal iz ponuđene liste." : "Izaberite konto iz ponuđene liste.");
        if (next === "" && match) choose(match);
      }}
    />
    {open && !disabled ? createPortal(<div id={listId} role="listbox" aria-label={isItem ? "Artikli" : "Konta"} style={{ position: "fixed", ...position, maxHeight: 280, overflowY: "auto", zIndex: 10000, background: "var(--surface)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 18px #0002" }} onMouseDown={event => event.preventDefault()}>
      {matches.length ? matches.map((choice, index) => <div key={choice.value} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        onMouseEnter={() => setActive(index)} onClick={() => choose(choice)}
        style={{ padding: "9px 12px", cursor: "pointer", background: index === active ? "var(--surface-hover)" : "var(--surface)", fontSize: 14 }}>
        {choice.label}
      </div>) : <div style={{ padding: 12 }}>{isItem ? "Nema odgovarajućih artikala." : "Nema odgovarajućih konta."}</div>}
    </div>, document.body) : null}
    <select {...props} ref={selectRef} value={current} disabled={disabled} tabIndex={-1} aria-hidden="true" style={{ display: "none" }}
      onChange={event => { setSelected(event.target.value); onChange?.(event); }}>
      {children}
    </select>
  </>;
}
