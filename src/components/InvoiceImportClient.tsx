"use client";

import {
  decodeInvoiceQrFile,
  invoiceQrFileAccept
} from "@/components/InvoiceQrUpload";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type BookOption = {
  id: string;
  label: string;
  documentType: "KUF" | "KIF";
  href: string;
};

type ImportResult = {
  link: string;
  status: "success" | "error" | "duplicate";
  message: string;
  invoiceNumber?: string;
  partner?: string;
  total?: number;
};

type ImportSummary = {
  total: number;
  success: number;
  duplicate: number;
  error: number;
};

type ImportMetadata = {
  link: string;
  buyerName?: string;
  buyerTin?: string;
  invoiceNumber?: string;
  total?: number;
};

type SepInvoiceRow = Record<string, unknown>;

type QrFileResult = {
  fileName: string;
  status: "success" | "duplicate" | "error";
  message: string;
};

function extractLinks(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[\n\r\t,; ]+/)
        .map((item) => item.trim())
        .filter((item) => item.startsWith("http"))
    )
  );
}

function normalizePib(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");

  return digits.length === 7 ? `0${digits}` : digits;
}

function stringValue(row: SepInvoiceRow, key: string) {
  return String(row[key] ?? "").trim();
}

function numberValue(row: SepInvoiceRow, key: string) {
  const value = row[key];

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value ?? "").replace(",", "."));

  return Number.isFinite(parsed) ? parsed : null;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatMaprDate(value: unknown) {
  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (parsed) {
      date = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.round(parsed.S));
    }
  } else if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const roundedDate = new Date(Math.round(date.getTime() / 1000) * 1000);
  const offsetMinutes = -roundedDate.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;

  return `${roundedDate.getFullYear()}-${pad(roundedDate.getMonth() + 1)}-${pad(
    roundedDate.getDate()
  )}T${pad(roundedDate.getHours())}:${pad(roundedDate.getMinutes())}:${pad(
    roundedDate.getSeconds()
  )}${offset}`;
}

function buildMaprLinkFromSepRow(row: SepInvoiceRow, companyPib: string) {
  const iic = stringValue(row, "IKOF računa");
  const createdAt = formatMaprDate(row["Datum fiskalizovanja"] || row["Datum izdavanja"]);
  const orderNumber = numberValue(row, "Redni broj");
  const businessUnit = stringValue(row, "Kod poslovne jedinice");
  const cashRegister = stringValue(row, "ENU kod");
  const total = numberValue(row, "Ukupna cijena (€)");

  if (!iic || !createdAt || orderNumber === null || !businessUnit || !cashRegister || total === null) {
    return null;
  }

  const params = new URLSearchParams({
    iic,
    tin: normalizePib(companyPib),
    crtd: createdAt,
    ord: String(Math.trunc(orderNumber)),
    bu: businessUnit,
    cr: cashRegister,
    prc: total.toFixed(2)
  });

  return `https://mapr.tax.gov.me/ic/#/verify?${params.toString()}`;
}

function parseSepExcelRows(workbook: XLSX.WorkBook, companyPib: string) {
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

  if (!firstSheet) {
    return { links: [] as string[], metadata: [] as ImportMetadata[] };
  }

  const rows = XLSX.utils.sheet_to_json<SepInvoiceRow>(firstSheet, {
    defval: "",
    raw: true
  });
  const metadata: ImportMetadata[] = [];
  const links = rows
    .filter((row) => stringValue(row, "Status").toUpperCase() === "CORRECT")
    .map((row) => {
      const link = buildMaprLinkFromSepRow(row, companyPib);

      if (link) {
        metadata.push({
          link,
          buyerName: stringValue(row, "Ime kupca") || undefined,
          buyerTin: normalizePib(row["PIB kupca"]) || undefined,
          invoiceNumber: stringValue(row, "Redni broj") || undefined,
          total: numberValue(row, "Ukupna cijena (€)") ?? undefined
        });
      }

      return link;
    })
    .filter((link): link is string => Boolean(link));

  return {
    links,
    metadata
  };
}

function hasSepInvoiceHeaders(workbook: XLSX.WorkBook) {
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

  if (!firstSheet) {
    return false;
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
    raw: false
  });
  const firstRow = rows[0] ?? {};

  return "IKOF računa" in firstRow && "Datum fiskalizovanja" in firstRow && "Redni broj" in firstRow;
}

function appendText(current: string, next: string) {
  const separator = current.trim() && next.trim() ? "\n" : "";

  return `${current}${separator}${next}`;
}

function money(value?: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function InvoiceImportClient({
  activeCompanyPib,
  books
}: {
  activeCompanyPib: string;
  books: BookOption[];
}) {
  const [documentType, setDocumentType] = useState<"KUF" | "KIF">("KUF");
  const [bookId, setBookId] = useState("");
  const [linksText, setLinksText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [metadata, setMetadata] = useState<ImportMetadata[]>([]);
  const [isReadingQrFiles, setIsReadingQrFiles] = useState(false);
  const [qrFileResults, setQrFileResults] = useState<QrFileResult[]>([]);

  const filteredBooks = useMemo(
    () => books.filter((book) => book.documentType === documentType),
    [books, documentType]
  );
  const selectedBook = filteredBooks.find((book) => book.id === bookId);
  const links = useMemo(() => extractLinks(linksText), [linksText]);

  async function readFile(file: File, companyPib: string) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    let text = "";
    let nextMetadata: ImportMetadata[] = [];

    if (extension === "xlsx" || extension === "xls") {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

      if (!firstSheet) {
        setStatus("error");
        setMessage("Excel fajl nema čitljiv sheet.");
        return;
      }

      if (documentType === "KIF" && companyPib) {
        const parsedSep = parseSepExcelRows(workbook, companyPib);

        if (parsedSep.links.length > 0) {
          text = parsedSep.links.join("\n");
          nextMetadata = parsedSep.metadata;
        }
      }

      if (documentType === "KIF" && !companyPib && hasSepInvoiceHeaders(workbook)) {
        setStatus("error");
        setMessage("Aktivna firma nema PIB, pa ne mogu napraviti MAPR linkove iz SEP Excel fajla.");
        return;
      }

      if (!text) {
        const rows = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
          header: 1,
          raw: false,
          blankrows: false
        });
        text = rows.flat().filter(Boolean).join("\n");
      }
    } else {
      text = await file.text();
    }

    setLinksText((current) => appendText(current, text));
    setMetadata((current) => [...current, ...nextMetadata]);
    setMessage(
      nextMetadata.length > 0
        ? `SEP fajl je učitan i napravljeno je ${nextMetadata.length} MAPR linkova. Fajl nije sačuvan na serveru.`
        : "Fajl je učitan u listu linkova. Fajl nije sačuvan na serveru."
    );
    setStatus("idle");
  }

  async function readQrFiles(files: File[]) {
    if (files.length === 0) return;

    setIsReadingQrFiles(true);
    setQrFileResults([]);
    setStatus("idle");
    setSummary(null);
    setResults([]);
    const knownLinks = new Set(links);
    const nextResults: QrFileResult[] = [];
    let successCount = 0;
    let duplicateCount = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setMessage(`Čitam QR kod ${index + 1}/${files.length}: ${file.name}`);

      try {
        const link = await decodeInvoiceQrFile(file);

        if (knownLinks.has(link)) {
          duplicateCount += 1;
          nextResults.push({
            fileName: file.name,
            status: "duplicate",
            message: "Link je već u polju."
          });
        } else {
          knownLinks.add(link);
          successCount += 1;
          setLinksText((current) => appendText(current, link));
          nextResults.push({
            fileName: file.name,
            status: "success",
            message: "MAPR link je dodat."
          });
        }
      } catch (error) {
        nextResults.push({
          fileName: file.name,
          status: "error",
          message: error instanceof Error ? error.message : "Fajl nije moguće obraditi."
        });
      }

      setQrFileResults([...nextResults]);
    }

    const errorCount = nextResults.filter((result) => result.status === "error").length;
    setIsReadingQrFiles(false);
    setMessage(
      `Obrađeno ${files.length} fajlova: dodato ${successCount}, duplikati ${duplicateCount}, greške ${errorCount}. Originalni fajlovi nijesu sačuvani.`
    );
  }

  async function importLinks() {
    setResults([]);
    setSummary(null);

    if (!bookId || links.length === 0) {
      setStatus("error");
      setMessage("Izaberite knjigu i unesite bar jedan link.");
      return;
    }

    setStatus("loading");
    setMessage(`Učitavam ${links.length} linkova preko MAPR-a...`);

    try {
      const response = await fetch("/api/racuni/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          documentType,
          bookId,
          links,
          metadata
        })
      });
      const data = (await response.json()) as {
        message?: string;
        results?: ImportResult[];
        summary?: ImportSummary;
      };

      if (!response.ok) {
        setStatus("error");
        setMessage(data.message ?? "Import nije izvršen.");
        return;
      }

      setResults(data.results ?? []);
      setSummary(data.summary ?? null);
      setStatus("done");
      setMessage("Import je završen.");
    } catch {
      setStatus("error");
      setMessage("Greška pri komunikaciji sa serverom.");
    }
  }

  return (
    <div className="admin-stack">
      <section className="admin-form-section">
        <div className="panel-header">
          <div>
            <h3>Import linkova</h3>
            <span>MAPR linkovi se obrađuju u manjim grupama zbog sporog odgovora servisa</span>
          </div>
          {selectedBook ? (
            <a className="secondary-button" href={selectedBook.href}>
              Otvori knjigu
            </a>
          ) : null}
        </div>

        <div className="admin-form">
          <label>
            <span>Tip knjige</span>
            <select
              disabled={isReadingQrFiles || status === "loading"}
              value={documentType}
              onChange={(event) => {
                const nextType = event.target.value as "KUF" | "KIF";
                setDocumentType(nextType);
                setBookId("");
                setLinksText("");
                setMetadata([]);
                setResults([]);
                setSummary(null);
                setQrFileResults([]);
              }}
            >
              <option value="KUF">KUF</option>
              <option value="KIF">KIF</option>
            </select>
          </label>
          <label>
            <span>Knjiga</span>
            <select
              disabled={isReadingQrFiles || status === "loading"}
              value={bookId}
              onChange={(event) => setBookId(event.target.value)}
            >
              <option value="">Izaberite knjigu</option>
              {filteredBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{documentType === "KIF" ? "SEP Excel ili fajl sa linkovima" : "Fajl sa linkovima"}</span>
            <input
              className="file-input"
              accept=".csv,.txt,.xlsx,.xls"
              disabled={isReadingQrFiles || status === "loading"}
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) {
                  void readFile(file, activeCompanyPib);
                  event.currentTarget.value = "";
                }
              }}
            />
          </label>
          <label className="qr-import-file-field">
            <span>Računi sa QR kodom (više fajlova)</span>
            <input
              className="file-input"
              accept={invoiceQrFileAccept}
              disabled={isReadingQrFiles || status === "loading"}
              multiple
              type="file"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                if (files.length > 0) {
                  void readQrFiles(files);
                }
              }}
            />
            <small>
              PDF, TIFF, JPG ili PNG do 20 MB po fajlu. Fajlovi se obrađuju redom
              samo u pregledniku.
            </small>
          </label>
          {qrFileResults.length > 0 ? (
            <div className="qr-batch-results form-wide" aria-live="polite">
              {qrFileResults.map((result, index) => (
                <div
                  className={`qr-batch-result qr-batch-result--${result.status}`}
                  key={`${result.fileName}-${index}`}
                >
                  <strong>{result.fileName}</strong>
                  <span>{result.message}</span>
                </div>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            disabled={status === "loading" || isReadingQrFiles}
            onClick={() => void importLinks()}
          >
            {status === "loading" ? "Importujem..." : "Importuj račune"}
          </button>
          <label className="form-wide">
            <span>Linkovi</span>
            <textarea
              rows={12}
              value={linksText}
              placeholder="Nalijepite MAPR linkove, jedan ispod drugog..."
              disabled={isReadingQrFiles}
              onChange={(event) => setLinksText(event.target.value)}
            />
          </label>
        </div>

        <div className="kuf-tax-totals">
          <span>Prepoznato linkova {links.length}</span>
          {summary ? (
            <>
              <span>Uspješno {summary.success}</span>
              <span>Duplikati {summary.duplicate}</span>
              <span>Greške {summary.error}</span>
            </>
          ) : null}
        </div>

        {message ? (
          <p className={`admin-message ${status === "error" ? "import-result--error" : ""}`}>
            {message}
          </p>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Rezultat importa</h3>
          <span>{results.length} redova</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>{documentType === "KIF" ? "Kupac" : "Dobavljač"}</th>
                <th>Račun</th>
                <th>Ukupno</th>
                <th>Poruka</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={5}>Rezultat će se prikazati nakon importa.</td>
                </tr>
              ) : (
                results.map((result, index) => (
                  <tr key={`${result.link}-${index}`}>
                    <td>
                      <strong>{result.status}</strong>
                    </td>
                    <td>{result.partner ?? "-"}</td>
                    <td>{normalizeFiscalInvoiceNumber(result.invoiceNumber) || "-"}</td>
                    <td>{money(result.total)}</td>
                    <td>{result.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
