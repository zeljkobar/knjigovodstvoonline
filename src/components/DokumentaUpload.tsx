"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeInvoiceQrFile } from "./InvoiceQrUpload";
import { cameraPdf } from "@/lib/dokumentacija-pdf";

type FileRow = { file: File; status: string; id?: string; uploadUrl?: string; uploaded?: boolean; qr?: string };

async function submit(operation: string, input: Record<string, unknown>) {
  const response = await fetch("/api/dokumentacija", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, operation })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  return data as { id: string; uploadUrl?: string };
}

async function sendFile(uploadUrl: string, file: File, offset: number) {
  const chunkSize = 10 * 320 * 1024;
  for (let start = offset; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size);
    const result = await fetch(uploadUrl, { method: "PUT", credentials: "omit",
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` }, body: file.slice(start, end) });
    if (!result.ok || (end === file.size && ![200, 201].includes(result.status))) {
      throw new Error("Slanje na OneDrive nije uspjelo.");
    }
  }
}

export function DokumentaUpload({ yearId, categories, supplement }: {
  yearId: string; categories: ReadonlyArray<readonly [string, string]>;
  supplement?: { id: string; category: string; comment: string };
}) {
  const router = useRouter();
  const [mobile, setMobile] = useState(false);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [pages, setPages] = useState<Array<{ file: File; url: string }>>([]);
  const [category, setCategory] = useState(supplement?.category ?? "ULAZNI");
  const [qr, setQr] = useState("");
  const [qrStatus, setQrStatus] = useState("");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const pagesRef = useRef(pages);
  const qrInput = useRef<HTMLInputElement>(null);
  const qrStep = useRef<HTMLLabelElement>(null);
  const [cropIndex, setCropIndex] = useState<number>();
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 0, bottom: 0 });

  useEffect(() => {
    const pointer = matchMedia("(pointer: coarse)");
    const detect = () => setMobile(pointer.matches && (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)));
    detect();
    pointer.addEventListener("change", detect);
    return () => {
      pointer.removeEventListener("change", detect);
      pagesRef.current.forEach(page => URL.revokeObjectURL(page.url));
    };
  }, []);

  function updatePages(next: typeof pages) {
    pagesRef.current = next;
    setPages(next);
  }

  async function editPage(index: number, rotation: boolean) {
    const page = pages[index];
    const bitmap = await createImageBitmap(page.file);
    const canvas = document.createElement("canvas");
    const left = rotation ? 0 : Math.round(bitmap.width * crop.left / 100);
    const top = rotation ? 0 : Math.round(bitmap.height * crop.top / 100);
    const width = rotation ? bitmap.width : Math.round(bitmap.width * (100 - crop.left - crop.right) / 100);
    const height = rotation ? bitmap.height : Math.round(bitmap.height * (100 - crop.top - crop.bottom) / 100);
    canvas.width = rotation ? height : width;
    canvas.height = rotation ? width : height;
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); return; }
    if (rotation) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    }
    context.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    const file = new File([blob], page.file.name, { type: "image/jpeg" });
    URL.revokeObjectURL(page.url);
    updatePages(pages.map((item, position) => position === index ? { file, url: URL.createObjectURL(file) } : item));
    setCropIndex(undefined);
  }

  async function scanQr(file: File) {
    setMessage("Čitanje QR koda…");
    setSending(true);
    try {
      setQr(await decodeInvoiceQrFile(file));
      setQrStatus("PROCITAN");
      setMessage("QR kod je pročitan.");
    } catch {
      setQr("");
      setQrStatus("NECITLJIV");
      setMessage("QR nije pročitan. Ponovite fotografiju ili pošaljite račun uz oznaku da je QR nečitljiv.");
    } finally { setSending(false); }
  }

  async function upload() {
    if (!files.some(row => row.status !== "Primljeno") && !pages.length && !qr.trim()) { setMessage("Dodajte dokument ili fiskalni link."); return; }
    if (files.filter(row => row.status !== "Primljeno").length + Number(Boolean(pages.length)) > 1 && qr.trim()) {
      setMessage("Pošaljite račun sa fiskalnim linkom pojedinačno."); return;
    }
    if (pages.length && ["ULAZNI", "IZLAZNI"].includes(category) && !qr.trim() && !["NEMA", "NECITLJIV"].includes(qrStatus)) {
      setMessage("Slikajte QR kod ili označite da QR nedostaje ili je nečitljiv.");
      qrInput.current?.focus();
      return;
    }
    setSending(true);
    setMessage("");
    try {
      const rows = files.filter(row => row.status !== "Primljeno").map(row => ({ ...row }));
      if (pages.length) {
        rows.push({ file: await cameraPdf(pages.map(page => page.file)), status: "" });
        pages.forEach(page => URL.revokeObjectURL(page.url));
        updatePages([]);
      }
      if (!rows.length) {
        await submit("prepare", { yearId, kategorija: category, qrLink: qr, napomena: comment, dopunaZa: supplement?.id });
        setQr("");
        setMessage("Fiskalni link je primljen.");
      }
      for (const row of rows) {
        if (row.status === "Primljeno") continue;
        row.status = "Slanje…";
        setFiles(rows.map(item => ({ ...item })));
        try {
          if (!row.uploaded) {
            let offset = 0;
            if (row.uploadUrl) {
              try {
                await submit("complete", { yearId, id: row.id });
                row.uploaded = true;
              } catch {
                const session = await fetch(row.uploadUrl, { credentials: "omit", cache: "no-store" });
                if (session.ok) {
                  const data = await session.json() as { nextExpectedRanges?: string[] };
                  offset = Number(data.nextExpectedRanges?.[0]?.split("-")[0]);
                  if (!Number.isInteger(offset) || offset < 0 || offset >= row.file.size) {
                    throw new Error("OneDrive nije vratio položaj za nastavak slanja.");
                  }
                } else if ([404, 410].includes(session.status)) {
                  row.uploadUrl = undefined;
                } else {
                  throw new Error("Slanje trenutno nije moguće nastaviti.");
                }
              }
            }
            if (!row.uploadUrl && !row.uploaded) {
              const result = await submit("prepare", { yearId, kategorija: category, naziv: row.file.name,
                velicina: row.file.size, qrLink: qr || row.qr, qrStatus, napomena: comment, dopunaZa: supplement?.id });
              row.id = result.id;
              row.qr = qr;
              row.uploadUrl = result.uploadUrl;
            }
            if (!row.uploaded) {
              if (!row.uploadUrl) throw new Error("OneDrive nije otvorio sesiju za slanje.");
              await sendFile(row.uploadUrl, row.file, offset);
            }
            row.uploaded = true;
          }
          await submit("complete", { yearId, id: row.id });
          row.status = "Primljeno";
        } catch (error) {
          row.status = error instanceof Error ? error.message : "Slanje nije uspjelo.";
        }
        setFiles(rows.map(item => ({ ...item })));
      }
      if (rows.length && rows.every(row => row.status === "Primljeno")) {
        setQr("");
        setQrStatus("");
        setMessage("Dokumentacija je primljena.");
      }
      if (rows.some(row => row.status === "Primljeno") || !rows.length) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Slanje nije uspjelo.");
    } finally { setSending(false); }
  }

  return <fieldset disabled={sending} className="admin-form">
    <legend>{supplement ? "Pošalji dopunu" : "Pošalji dokumente"}</legend>
    {supplement && <p>{supplement.comment}</p>}
    <label>Kategorija<select value={category} disabled={Boolean(supplement)} onChange={event => setCategory(event.target.value)}>
      {categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <label>Odaberi fajlove<input type="file" multiple={!supplement} accept=".pdf,.tif,.tiff,.jpg,.jpeg,.png,.xml,.htm,.html"
      onChange={event => { setFiles(Array.from(event.target.files ?? [], file => ({ file, status: "" }))); }} /></label>
    {mobile && <>
      <label>{pages.length ? "Dodaj stranu" : "Slikaj dokument"}<input type="file" accept="image/*" capture="environment"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) {
            if (pages.length >= 20) { setMessage("Možete dodati do 20 strana u jedan dokument."); return; }
            updatePages([...pages, { file, url: URL.createObjectURL(file) }]);
            if (["ULAZNI", "IZLAZNI"].includes(category) && !qr && !qrStatus) {
              qrStep.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              qrInput.current?.focus({ preventScroll: true });
            }
          }
          event.target.value = "";
        }} /></label>
      {pages.length > 0 && <div className="table-actions">{pages.map((page, index) => <div key={page.url}>
        {/* Object URLs are camera captures held in this browser. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={page.url} alt={`Strana ${index + 1}`} width={100} />
        <button type="button" onClick={() => void editPage(index, true).catch(() => setMessage("Fotografija nije obrađena."))}>Rotiraj</button>
        <button type="button" onClick={() => { setCropIndex(index); setCrop({ left: 0, top: 0, right: 0, bottom: 0 }); }}>Izreži</button>
        <button type="button" onClick={() => { URL.revokeObjectURL(page.url); setCropIndex(undefined); updatePages(pages.filter((_, position) => position !== index)); }}>Ukloni</button>
        {cropIndex === index && <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.url} alt="Pregled izreza" width={180} style={{ clipPath: `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)` }} />
          {([["top", "Gore"], ["right", "Desno"], ["bottom", "Dolje"], ["left", "Lijevo"]] as const).map(([side, label]) =>
            <label key={side}>{label}<input type="range" min={0} max={45} value={crop[side]}
              onChange={event => setCrop({ ...crop, [side]: Number(event.target.value) })} /></label>)}
          <button type="button" onClick={() => void editPage(index, false).catch(() => setMessage("Fotografija nije obrađena."))}>Primijeni izrez</button>
          <button type="button" onClick={() => setCropIndex(undefined)}>Odustani</button>
        </div>}
      </div>)}</div>}
      <label ref={qrStep}>Slikaj QR kod<input ref={qrInput} type="file" accept="image/*" capture="environment" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void scanQr(file);
        event.target.value = "";
      }} /></label>
      <label>Stanje QR koda<select value={qrStatus} onChange={event => setQrStatus(event.target.value)}>
        <option value="">Odaberite</option>
        {qrStatus === "PROCITAN" && <option value="PROCITAN">QR kod pročitan</option>}
        <option value="NEMA">QR nedostaje</option><option value="NECITLJIV">QR nečitljiv</option>
      </select></label>
    </>}
    <label>Fiskalni link<input type="url" value={qr} onChange={event => { setQr(event.target.value); setQrStatus(""); }} /></label>
    <label>Napomena<textarea maxLength={1000} value={comment} onChange={event => setComment(event.target.value)} /></label>
    <button type="button" onClick={() => void upload()}>{!files.length && !pages.length && qr ? "Pošalji samo QR" : "Pošalji"}</button>
    {message && <p role="status">{message}</p>}
    <ul aria-live="polite">{files.map((row, index) => <li key={index}>{row.file.name}{row.status && ` · ${row.status}`}</li>)}</ul>
  </fieldset>;
}
