"use client";

import { useFormStatus } from "react-dom";
import { deleteIncomingDocumentFromCloud, removeIncomingDocument } from "@/app/agencija/dokumentacija/actions";

function RemoveButton({ cloud, retry }: { cloud?: boolean; retry?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="table-button" type="submit" disabled={pending}>
    {pending ? "Uklanjanje…" : retry ? "Ponovi brisanje sa OneDrive-a" : cloud ? "Izbriši i sa OneDrive-a" : "Ukloni iz evidencije"}
  </button>;
}

export function RemoveIncomingDocument({ id, companyId, yearId, cloud = false, retry = false }: {
  id: string; companyId: string; yearId: string; cloud?: boolean; retry?: boolean;
}) {
  return <form action={cloud ? deleteIncomingDocumentFromCloud : removeIncomingDocument} onSubmit={event => {
    if (!window.confirm(cloud ? "Izbrisati dokument iz evidencije i premjestiti fajl u OneDrive korpu?" : "Ukloniti dokument iz evidencije? Fajl na OneDrive-u neće biti obrisan.")) event.preventDefault();
  }}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="firma" value={companyId} />
    <input type="hidden" name="godina" value={yearId} />
    {cloud && <input type="hidden" name="potvrda" value="onedrive" />}
    <RemoveButton cloud={cloud} retry={retry} />
  </form>;
}
