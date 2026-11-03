"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useTransition } from "react";

type Props = {
  accounts: { id: string; sifra: string; naziv: string }[];
  accountId: string;
  partnerId: string;
  partners: { id: string; naziv: string; pib: string | null }[];
  date: string;
  minDate: string;
  maxDate: string;
};

export function SettlementFilters(props: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const update = useCallback((partnerId?: string) => {
    const form = formRef.current;
    if (!form) return;
    const values = new FormData(form);
    const query = new URLSearchParams();
    for (const key of ["konto", "datum"]) {
      const value = String(values.get(key) ?? "");
      if (value) query.set(key, value);
    }
    const selected = partnerId ?? String(values.get("partner") ?? "");
    if (selected) query.set("partner", selected);
    startTransition(() => router.push(`/agencija/nalozi/zatvaranje-stavki?${query}`, { scroll: false }));
  }, [router]);

  return <form ref={formRef} className="admin-form journal-filter-form" onSubmit={event => { event.preventDefault(); update(); }} aria-busy={pending}>
    <label>Kupac / dobavljač
      <select key={`${props.partnerId}:${props.accountId}`} name="partner" defaultValue={props.partnerId} onChange={event => update(event.target.value)}>
        <option value="">Izaberite kupca ili dobavljača</option>
        {props.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.naziv}{partner.pib ? ` (${partner.pib})` : ""}</option>)}
      </select>
    </label>
    <label>Konto
      <select key={props.accountId} name="konto" defaultValue={props.accountId} onChange={() => update()}>
        <option value="">Sva konta izabranog partnera</option>
        {props.accounts.map(a => <option key={a.id} value={a.id}>{a.sifra} — {a.naziv}</option>)}
      </select>
    </label>
    <label>Stanje na dan<input key={props.date} type="date" name="datum" defaultValue={props.date} min={props.minDate} max={props.maxDate} onChange={() => update()} /></label>
    {pending ? <span role="status">Učitavam stavke partnera…</span> : null}
  </form>;
}
