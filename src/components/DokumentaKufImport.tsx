"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { decodeInvoiceQrFile } from "./InvoiceQrUpload";

type KufBookOption = { id: string; label: string };
type ImportDocument = { id: string; name: string; qr: string | null; size: number | null };
type ImportOutcome = {
  status?: "success" | "duplicate" | "error";
  message: string;
  entryId?: string;
  partnerTin?: string;
  requiresAccount?: boolean;
  qr?: string;
};
type RowOptions = { book?: string };
type ImportScope = { companyId: string; yearId: string; userId: string };
type ImportProgress = { done: number; total: number; imported: number };
type ImportState = {
  outcomes: Record<string, ImportOutcome>;
  busy: boolean;
  activeId: string | null;
  progress?: ImportProgress;
  revision: number;
};
type ImportTask = { document: ImportDocument; bookId: string; account?: string };
const emptyState: ImportState = { outcomes: {}, busy: false, activeId: null, revision: 0 };
const KufImportWorkspace = createContext<{
  imports: Record<string, ImportState>;
  rowOptions: Record<string, Record<string, RowOptions>>;
  supplierAccounts: Record<string, Record<string, string>>;
  setSupplierAccount: (key: string, tin: string, account: string) => void;
  updateOptions: (key: string, id: string, changes: RowOptions) => void;
  run: (key: string, scope: ImportScope, tasks: ImportTask[], bulk: boolean, entryId?: string) => Promise<void>;
} | null>(null);

export function DokumentaKufWorkspace({ children }: { children: ReactNode }) {
  const [imports, setImports] = useState<Record<string, ImportState>>({});
  const [rowOptions, setRowOptions] = useState<Record<string, Record<string, RowOptions>>>({});
  const [supplierAccounts, setSupplierAccounts] = useState<Record<string, Record<string, string>>>({});
  const jobs = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const activeJobs = jobs.current;
    return () => activeJobs.forEach(job => job.abort());
  }, []);

  async function run(key: string, scope: ImportScope, tasks: ImportTask[], bulk: boolean, entryId?: string) {
    if (jobs.current.has(key) || !tasks.length) return;
    const controller = new AbortController();
    jobs.current.set(key, controller);
    let state = { ...(imports[key] ?? emptyState), busy: true, progress: undefined as ImportProgress | undefined };
    let imported = 0;
    let done = 0;

    function publish() {
      const snapshot = state;
      setImports(current => ({ ...current, [key]: snapshot }));
    }

    if (bulk) state.progress = { done, imported, total: tasks.length };
    publish();

    try {
      for (const { document, bookId, account } of tasks) {
        if (controller.signal.aborted) break;
        state = { ...state, activeId: document.id };
        publish();
        const outcome = await requestImport(document, scope, bookId, state.outcomes[document.id],
          account, entryId, controller.signal);
        if (controller.signal.aborted) break;
        if (outcome.status === "success") imported += 1;
        done += 1;
        state = { ...state, outcomes: { ...state.outcomes, [document.id]: outcome },
          progress: bulk ? { done, imported, total: tasks.length } : undefined };
        publish();
      }
    } finally {
      jobs.current.delete(key);
      if (!controller.signal.aborted) {
        state = { ...state, activeId: null, busy: false, revision: state.revision + Number(imported > 0) };
        publish();
      }
    }
  }

  function updateOptions(key: string, id: string, changes: RowOptions) {
    setRowOptions(current => ({
      ...current,
      [key]: { ...current[key], [id]: { ...current[key]?.[id], ...changes } }
    }));
  }

  function setSupplierAccount(key: string, tin: string, account: string) {
    setSupplierAccounts(current => ({ ...current, [key]: { ...current[key], [tin]: account } }));
  }

  return <KufImportWorkspace.Provider value={{ imports, run, rowOptions, updateOptions, supplierAccounts, setSupplierAccount }}>{children}</KufImportWorkspace.Provider>;
}

const KufBookSelection = createContext<{
  book: string;
  books: KufBookOption[];
  options: Record<string, RowOptions>;
  outcomes: Record<string, ImportOutcome>;
  busy: boolean;
  activeId: string | null;
  updateOptions: (id: string, options: RowOptions) => void;
  supplierAccounts: Record<string, string>;
  setSupplierAccount: (tin: string, account: string) => void;
  importSupplier: (tin: string) => Promise<void>;
  importOne: (document: ImportDocument, entryId?: string) => Promise<void>;
} | null>(null);

async function requestImport(document: ImportDocument, scope: ImportScope, bookId: string, previous: ImportOutcome | undefined,
  account: string | undefined, entryId: string | undefined, signal: AbortSignal): Promise<ImportOutcome> {
  let qr = previous?.qr ?? document.qr ?? undefined;
  try {
    if (!qr) {
      const limit = 20 * 1024 * 1024;
      if ((document.size ?? 0) > limit) throw new Error("Za ovaj fajl otvorite ručni unos.");
      const file = await fetch(`/api/dokumentacija/original?id=${document.id}&download=1`, { signal });
      if (!file.ok) throw new Error("Original nije dostupan.");
      if (Number(file.headers.get("content-length")) > limit) throw new Error("Za ovaj fajl otvorite ručni unos.");
      qr = await decodeInvoiceQrFile(new File([await file.blob()], document.name));
    }
    const response = await fetch("/api/dokumentacija/obrada", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ ...scope, id: document.id, qr, bookId, entryId,
        supplierAccountCodes: previous?.partnerTin && account ? { [previous.partnerTin]: account } : undefined })
    });
    const result = await response.json() as ImportOutcome;
    return response.ok
      ? { ...result, qr }
      : { status: "error", message: result.message ?? "Obrada nije uspjela.", qr,
          requiresAccount: previous?.requiresAccount, partnerTin: previous?.partnerTin };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Obrada nije uspjela.", qr,
      requiresAccount: previous?.requiresAccount, partnerTin: previous?.partnerTin };
  }
}

export function DokumentaKufSelection({ sessionKey, scope, books, documents, children }: {
  sessionKey: string;
  scope: ImportScope;
  books: KufBookOption[];
  documents: ImportDocument[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState("");
  const workspace = useContext(KufImportWorkspace);
  const options = workspace?.rowOptions[sessionKey] ?? {};
  const supplierAccounts = workspace?.supplierAccounts[sessionKey] ?? {};
  const { outcomes, busy, activeId, progress, revision } = workspace?.imports[sessionKey] ?? emptyState;
  const router = useRouter();

  useEffect(() => {
    if (revision) router.refresh();
  }, [revision, router]);

  function updateOptions(id: string, changes: RowOptions) {
    workspace?.updateOptions(sessionKey, id, changes);
  }

  useEffect(() => {
    try {
      setSelected(sessionStorage.getItem(sessionKey) ?? "");
    } catch {
      // The selection still works in memory when browser storage is disabled.
    }
  }, [sessionKey]);

  const book = books.some(item => item.id === selected) ? selected : "";

  const candidates = documents.filter(document => outcomes[document.id]?.status !== "success");

  async function runImport(queue: ImportDocument[], bulk: boolean, entryId?: string) {
    const tasks = queue.flatMap(document => {
      const row = options[document.id];
      const override = books.find(item => item.id === row?.book)?.id;
      const bookId = override ?? book;
      const tin = outcomes[document.id]?.partnerTin;
      const account = tin ? supplierAccounts[tin]?.trim() : undefined;
      return bookId ? [{ document, bookId, account }] : [];
    });
    await workspace?.run(sessionKey, scope, tasks, bulk, entryId);
  }

  return <KufBookSelection.Provider value={{ book, books, options, outcomes, busy, activeId, updateOptions,
    supplierAccounts,
    setSupplierAccount: (tin, account) => workspace?.setSupplierAccount(sessionKey, tin, account),
    importSupplier: tin => runImport(candidates.filter(document => {
      const result = outcomes[document.id];
      return result?.requiresAccount && result.partnerTin === tin;
    }), true),
    importOne: (document, entryId) => runImport([document], false, entryId) }}>
    {books.length > 0 && <div className="admin-form">
      <label>KUF knjiga za sve račune
        <select value={book} disabled={busy} onChange={event => {
          const value = event.target.value;
          setSelected(value);
          try {
            if (value) sessionStorage.setItem(sessionKey, value);
            else sessionStorage.removeItem(sessionKey);
          } catch {
            // The current page still has the selected book.
          }
        }}>
          <option value="">Odaberite zajedničku knjigu</option>
          {books.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <div className="table-actions">
        <button type="button" disabled={busy || !book || !candidates.length}
          onClick={() => void runImport(candidates, true)}>Uvezi sve račune</button>
      </div>
      {progress && <p role="status">{progress.done < progress.total
        ? `Obrađeno ${progress.done} od ${progress.total}`
        : `Uvezeno ${progress.imported} od ${progress.total}.${progress.imported < progress.total ? " Ostali računi imaju poruku u svom redu." : ""}`}</p>}
    </div>}
    {children}
  </KufBookSelection.Provider>;
}

export function DokumentaKufImport({ document }: { document: ImportDocument }) {
  const selection = useContext(KufBookSelection);
  if (!selection) return null;
  const { book: sessionBook, books, options, outcomes, busy, activeId, updateOptions, importOne, supplierAccounts, setSupplierAccount, importSupplier } = selection;
  const row = options[document.id];
  const result = outcomes[document.id];
  const rowBook = books.some(item => item.id === row?.book) ? row.book! : "";
  const book = rowBook || sessionBook;
  const sessionBookLabel = books.find(item => item.id === sessionBook)?.label;
  const duplicate = result?.status === "duplicate" ? result.entryId : undefined;
  const disabled = busy || result?.status === "success";
  const supplierTin = result?.requiresAccount ? result.partnerTin : undefined;
  const account = supplierTin ? supplierAccounts[supplierTin] ?? "" : "";

  return <div>
    <label>KUF knjiga<select value={rowBook} disabled={disabled} onChange={event => updateOptions(document.id, { book: event.target.value })}>
      <option value="">{sessionBookLabel ? `Zajednička · ${sessionBookLabel}` : "Odaberite knjigu"}</option>
      {books.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {supplierTin && <label>Konto dobavljača<input value={account} maxLength={30} disabled={disabled}
      onChange={event => setSupplierAccount(supplierTin, event.target.value)} /></label>}
    {book && <div className="table-actions">
      <button type="button" disabled={disabled} onClick={() => void importOne(document)}>Uvezi u KUF</button>
      {supplierTin && <button type="button" disabled={disabled || !account.trim()}
        onClick={() => void importSupplier(supplierTin)}>Uvezi račune ovog dobavljača</button>}
      {!disabled && <Link className="table-button" href={`/agencija/racuni/kuf/${book}?dokument=${document.id}#kuf-entry-form`}>Ručni unos</Link>}
      {duplicate && <button type="button" disabled={disabled} onClick={() => void importOne(document, duplicate)}>Poveži postojeći račun</button>}
    </div>}
    {activeId === document.id ? <p role="status">Uvoz je u toku…</p> : result && <p role="status">{result.message}</p>}
  </div>;
}
