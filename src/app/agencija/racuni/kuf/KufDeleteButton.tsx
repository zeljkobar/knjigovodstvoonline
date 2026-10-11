"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { deleteKufEntry } from "../actions";

type Props = { id: string; bookId: string; label: string; posted: boolean; blockedReason?: string };
export function KufDeleteButton({id, bookId, label, posted, blockedReason}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteKufEntry, {});
  useEffect(() => {
    if (state.success) { dialog.current?.close(); router.refresh(); }
  }, [state.success, router]);
  return <>
    <button type="button" className="kuf-delete-icon" title={`Obriši ${label}`} aria-label={`Obriši ${label}`} onClick={() => dialog.current?.showModal()}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>
    </button>
    <dialog ref={dialog} className="kuf-delete-dialog" aria-labelledby={titleId} onCancel={event=>{if(pending)event.preventDefault();}}>
      <h3 id={titleId}>{blockedReason ? "Brisanje nije dozvoljeno" : "Obriši račun?"}</h3>
      <p className="kuf-delete-label">{label}</p>
      {blockedReason ? <>
        <p role="status">{blockedReason}</p>
        <div className="kuf-delete-actions"><button type="button" className="secondary-button" onClick={()=>dialog.current?.close()}>Zatvori</button></div>
      </> : <form action={action}>
        <input type="hidden" name="kuf_entry_id" value={id}/><input type="hidden" name="kuf_book_id" value={bookId}/>
        <p>{posted ? "Ukloniće se ovaj račun iz KUF-a i njegove stavke iz naloga. Ostali računi ostaju proknjiženi." : "Ovaj račun će biti uklonjen iz KUF knjige."}</p>
        <label>Razlog brisanja<textarea name="reason" required maxLength={1000} rows={3} disabled={pending}/></label>
        <label className="kuf-delete-confirm"><input type="checkbox" name="confirmed" value="yes" required disabled={pending}/>Potvrđujem brisanje ovog računa.</label>
        {state.error ? <p className="kuf-delete-error" role="alert">{state.error}</p> : null}
        <div className="kuf-delete-actions"><button type="button" className="secondary-button" disabled={pending} onClick={()=>dialog.current?.close()}>Odustani</button><button type="submit" className="danger-button" disabled={pending}>{pending?"Brisanje…":posted?"Obriši račun i knjiženje":"Obriši račun"}</button></div>
      </form>}
    </dialog>
  </>;
}
