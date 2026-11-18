"use client";

import { useFormStatus } from "react-dom";
import { setPartnerActive } from "../actions";

function Submit({ restore }: { restore: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`table-button${restore ? "" : " table-button-danger"}`} disabled={pending} type="submit">
    {pending ? "Čuvam…" : restore ? "Vrati partnera" : "Obriši"}
  </button>;
}

export function PartnerStatusForm({ firmaId, partnerId, name, active, filters }: {
  firmaId: string; partnerId: string; name: string; active: boolean;
  filters: Record<string, string>;
}) {
  return <form action={setPartnerActive} onSubmit={(event) => {
    if (active && !window.confirm(`Obrisati partnera „${name}“ iz aktivnog izbora? Postojeći dokumenti ostaju sačuvani. Partnera možete vratiti kroz filter „Obrisani“.`)) {
      event.preventDefault();
    }
  }}>
    <input type="hidden" name="firma_id" value={firmaId} />
    <input type="hidden" name="partner_id" value={partnerId} />
    <input type="hidden" name="operation" value={active ? "delete" : "restore"} />
    {Object.entries(filters).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <Submit restore={!active} />
  </form>;
}
