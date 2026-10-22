"use client";

import { useActionState, useEffect, useRef, type ComponentProps, type KeyboardEvent } from "react";
import { addCalculationLineInline } from "@/app/agencija/robno/kalkulacije/actions";
import { CalculationItemPicker } from "./CalculationItemPicker";

type Props = ComponentProps<typeof CalculationItemPicker> & { companyId: string; calculationId: string };
const order = ["kolicina", "fakturna_cijena", "rabat_procenat", "prodajna_cijena_sa_pdv"];
const errors: Record<string, string> = {
  stavka_iznosi: "Provjerite količinu, fakturnu cijenu, rabat i prodajnu cijenu sa PDV-om.",
  stavka_artikal: "Izaberite aktivan robni artikal koji prati lager.",
  nije_nacrt: "Mijenjati se može samo nacrt kalkulacije."
};

export function CalculationLineEntryForm({ companyId, calculationId, ...picker }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<Record<string, string>>({});
  const [state, action, pending] = useActionState(addCalculationLineInline, { saved: 0, error: undefined });
  useEffect(() => {
    if (!state.error) return;
    for (const [name, value] of Object.entries(submitted.current)) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = value;
    }
  }, [state]);
  useEffect(() => {
    if (!state.saved) return;
    const form = formRef.current;
    form?.reset();
    const frame = requestAnimationFrame(() => {
      form?.querySelector<HTMLInputElement>("input[data-item-search]")?.focus({ preventScroll: true });
      form?.scrollIntoView({ block: "nearest", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.saved]);

  function focusField(name: string) {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLInputElement) { field.focus({ preventScroll: true }); field.select(); }
  }
  function enter(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.defaultPrevented) return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.getAttribute("role") === "combobox") return;
    const index = order.indexOf(field.name);
    if (index < 0) return;
    event.preventDefault();
    if (pending || !field.reportValidity()) return;
    if (index < order.length - 1) focusField(order[index + 1]);
    else formRef.current?.requestSubmit();
  }
  return <form ref={formRef} action={action} onKeyDown={enter} onSubmit={() => {
    submitted.current = Object.fromEntries(order.map(name => [name, String(new FormData(formRef.current!).get(name) ?? "")]));
  }} className="admin-form calculation-item-form">
    <input type="hidden" name="firma_id" value={companyId} />
    <input type="hidden" name="kalkulacija_id" value={calculationId} />
    <CalculationItemPicker key={state.saved} {...picker} onConfirm={() => focusField("kolicina")} />
    <label><span>Količina</span><input name="kolicina" inputMode="decimal" placeholder="1,000" required /></label>
    <label><span>Fakturna cijena bez PDV</span><input name="fakturna_cijena" inputMode="decimal" placeholder="0,0000" required /></label>
    <label><span>Rabat %</span><input name="rabat_procenat" inputMode="decimal" defaultValue="0" /></label>
    <label><span>Prodajna cijena sa PDV *</span><input id="calculation-sale-price" name="prodajna_cijena_sa_pdv" inputMode="decimal" placeholder="0,00" required /></label>
    <div className="form-actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? "Dodavanje…" : "Dodaj stavku"}</button></div>
    {state.error ? <p role="alert" className="admin-message form-wide">{errors[state.error] ?? state.error}</p> : state.saved ? <p role="status" className="admin-message form-wide">Stavka je dodata i kalkulacija je preračunata.</p> : null}
  </form>;
}
