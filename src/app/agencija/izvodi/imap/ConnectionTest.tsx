"use client";

import { useState, useTransition } from "react";
import { checkImapConnection } from "./actions";

export default function ConnectionTest() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div>
      <button type="button" disabled={pending} onClick={() => {
        setMessage("");
        startTransition(async () => {
          try {
            const result = await checkImapConnection();
            setMessage(result.ok
              ? `Veza uspješna. INBOX je otvoren samo za čitanje. Broj poruka: ${result.messageCount}.`
              : result.message);
          } catch {
            setMessage("Provjera nije završena. Provjerite prijavu i pokušajte ponovo.");
          }
        });
      }}>{pending ? "Provjera veze…" : "Testiraj IMAP vezu"}</button>
      <p role="status" aria-live="polite">{message}</p>
    </div>
  );
}
