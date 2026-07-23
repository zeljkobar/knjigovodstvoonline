"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type DeleteCompanyFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  firmaId: string;
  nazivFirme: string;
};

function DeleteButton({ omoguceno }: { omoguceno: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="danger-button"
      disabled={!omoguceno || pending}
      type="submit"
    >
      {pending ? "Brisanje je u toku..." : "Trajno izbriši firmu i sve podatke"}
    </button>
  );
}

export function DeleteCompanyForm({
  action,
  firmaId,
  nazivFirme
}: DeleteCompanyFormProps) {
  const [potvrda, setPotvrda] = useState("");
  const nazivJePotvrdjen = potvrda === nazivFirme;

  return (
    <form action={action} className="company-delete-form">
      <input name="firma_id" type="hidden" value={firmaId} />
      <p>
        Ova radnja trajno briše firmu, poslovne godine, naloge, KIF/KUF,
        izvode, PDV, plate, M-4 i sva ostala podešavanja i podatke koji pripadaju
        ovoj firmi. Korisnički nalozi i zajednički šifarnici ostaju sačuvani.
      </p>
      <label>
        <span>
          Za potvrdu unesite puni naziv: <strong>{nazivFirme}</strong>
        </span>
        <input
          autoComplete="off"
          name="potvrda_naziva"
          onChange={(event) => setPotvrda(event.target.value)}
          required
          spellCheck={false}
          value={potvrda}
        />
      </label>
      <DeleteButton omoguceno={nazivJePotvrdjen} />
    </form>
  );
}
