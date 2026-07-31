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

type AccountOption = {
  code: string;
  label: string;
};

type ImportResult = {
  link: string;
  status: "success" | "error" | "duplicate";
  message: string;
  invoiceNumber?: string;
  partner?: string;
  partnerTin?: string;
  accountCode?: string;
  total?: number;
  requiresAccount?: boolean;
};

type ImportSummary = {
  total: number;
  success: number;
  duplicate: number;
  error: number;
};

type ImportProgress = ImportSummary & {
  processed: number;
  label: string;
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

const importBatchSize = 5;

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

function summarizeResults(results: ImportResult[]): ImportSummary {
  return {
    total: results.length,
    success: results.filter((result) => result.status === "success").length,
    duplicate: results.filter((result) => result.status === "duplicate").length,
    error: results.filter((result) => result.status === "error").length
  };
}

function accountLabel(accountCode: string | undefined, accountOptions: AccountOption[]) {
  if (!accountCode) {
    return "-";
  }

  return (
    accountOptions.find((account) => account.code === accountCode)?.label ??
    accountCode
  );
}

function mergeImportResults(current: ImportResult[], nextResults: ImportResult[]) {
  const nextByLink = new Map(nextResults.map((result) => [result.link, result]));
  const currentLinks = new Set(current.map((result) => result.link));

  return [
    ...current.map((result) => nextByLink.get(result.link) ?? result),
    ...nextResults.filter((result) => !currentLinks.has(result.link))
  ];
}

function maprLinkDetails(link: string) {
  try {
    const url = new URL(link);
    const hashQueryIndex = url.hash.indexOf("?");
    const query =
      url.search.slice(1) ||
      (hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "");
    const params = new URLSearchParams(query);

    return {
      iic: params.get("iic") ?? "",
      tin: normalizePib(params.get("tin")),
      createdAt: params.get("crtd") ?? "",
      total: params.get("prc") ?? ""
    };
  } catch {
    return {
      iic: "",
      tin: "",
      createdAt: "",
      total: ""
    };
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? "");

  return `"${text.replaceAll('"', '""')}"`;
}

export function InvoiceImportClient({
  accountOptions,
  activeCompanyPib,
  books
}: {
  accountOptions: AccountOption[];
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
  const [supplierAccountCodes, setSupplierAccountCodes] = useState<Record<string, string>>({});
  const [linkSources, setLinkSources] = useState<Record<string, string[]>>({});
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const filteredBooks = useMemo(
    () => books.filter((book) => book.documentType === documentType),
    [books, documentType]
  );
  const selectedBook = filteredBooks.find((book) => book.id === bookId);
  const links = useMemo(() => extractLinks(linksText), [linksText]);
  const suppliersRequiringAccount = useMemo(() => {
    const grouped = new Map<
      string,
      {
        tin: string;
        partner: string;
        links: string[];
      }
    >();

    for (const result of results) {
      if (!result.requiresAccount || !result.partnerTin) {
        continue;
      }

      const existing = grouped.get(result.partnerTin);

      if (existing) {
        existing.links.push(result.link);
      } else {
        grouped.set(result.partnerTin, {
          tin: result.partnerTin,
          partner: result.partner ?? "Dobavljač",
          links: [result.link]
        });
      }
    }

    return Array.from(grouped.values());
  }, [results]);
  const readySupplierCount = suppliersRequiringAccount.filter(
    (supplier) => supplierAccountCodes[supplier.tin]
  ).length;
  const failedResults = useMemo(
    () => results.filter((result) => result.status === "error"),
    [results]
  );
  const retryableFailedResults = failedResults.filter(
    (result) => !result.requiresAccount
  );
  const failedQrFiles = qrFileResults.filter(
    (result) => result.status === "error"
  );
  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  function rememberLinkSources(sourceLinks: string[], fileName: string) {
    if (sourceLinks.length === 0) {
      return;
    }

    setLinkSources((current) => {
      const next = { ...current };

      for (const link of sourceLinks) {
        next[link] = Array.from(new Set([...(next[link] ?? []), fileName]));
      }

      return next;
    });
  }

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

    rememberLinkSources(extractLinks(text), file.name);
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
    setProgress(null);
    const knownLinks = new Set(links);
    const nextResults: QrFileResult[] = [];
    let successCount = 0;
    let duplicateCount = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setMessage(`Čitam QR kod ${index + 1}/${files.length}: ${file.name}`);

      try {
        const link = await decodeInvoiceQrFile(file);
        rememberLinkSources([link], file.name);

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

  async function importInBatches(
    requestLinks: string[],
    options: {
      label: string;
      replaceResults: boolean;
      documentType?: "KUF" | "KIF";
      supplierAccountCodes?: Record<string, string>;
    }
  ) {
    let operationResults: ImportResult[] = [];
    let displayedResults = options.replaceResults ? [] : [...results];
    const operationType = options.documentType ?? documentType;

    setProgress({
      processed: 0,
      total: requestLinks.length,
      success: 0,
      duplicate: 0,
      error: 0,
      label: options.label
    });

    for (let index = 0; index < requestLinks.length; index += importBatchSize) {
      const batch = requestLinks.slice(index, index + importBatchSize);
      const processedBeforeBatch = operationResults.length;
      setMessage(
        `${options.label}: ${processedBeforeBatch}/${requestLinks.length} obrađeno...`
      );
      let batchResults: ImportResult[];

      try {
        const response = await fetch("/api/racuni/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            documentType: operationType,
            bookId,
            links: batch,
            metadata: metadata.filter((item) => batch.includes(item.link)),
            supplierAccountCodes: options.supplierAccountCodes
          })
        });
        const data = (await response.json()) as {
          message?: string;
          results?: ImportResult[];
        };

        if (!response.ok) {
          batchResults = batch.map((link) => ({
            link,
            status: "error",
            message: data.message ?? "Import ove grupe nije izvršen."
          }));
        } else {
          const returnedByLink = new Map(
            (data.results ?? []).map((result) => [result.link, result])
          );
          batchResults = batch.map(
            (link) =>
              returnedByLink.get(link) ?? {
                link,
                status: "error",
                message: "Server nije vratio rezultat za ovaj link."
              }
          );
        }
      } catch {
        batchResults = batch.map((link) => ({
          link,
          status: "error",
          message: "Greška pri komunikaciji sa serverom."
        }));
      }

      operationResults = [...operationResults, ...batchResults];
      displayedResults = options.replaceResults
        ? [...operationResults]
        : mergeImportResults(displayedResults, batchResults);
      const operationSummary = summarizeResults(operationResults);

      setResults(displayedResults);
      setSummary(summarizeResults(displayedResults));
      setProgress({
        processed: operationResults.length,
        total: requestLinks.length,
        success: operationSummary.success,
        duplicate: operationSummary.duplicate,
        error: operationSummary.error,
        label: options.label
      });
    }

    return {
      operationResults,
      displayedResults
    };
  }

  async function importLinks() {
    setResults([]);
    setSummary(null);
    setSupplierAccountCodes({});

    if (!bookId || links.length === 0) {
      setStatus("error");
      setMessage("Izaberite knjigu i unesite bar jedan link.");
      return;
    }

    setStatus("loading");
    const { displayedResults } = await importInBatches(links, {
      label: "Import računa",
      replaceResults: true
    });
    setStatus("done");
    const suppliersWithoutAccount = new Set(
      displayedResults
        .filter((result) => result.requiresAccount && result.partnerTin)
        .map((result) => result.partnerTin)
    ).size;
    const finalSummary = summarizeResults(displayedResults);
    setMessage(
      suppliersWithoutAccount > 0
        ? `Import je završen. Izaberite konto za ${suppliersWithoutAccount} dobavljača i ponovite njihove račune.`
        : finalSummary.error > 0
          ? `Import je završen sa ${finalSummary.error} grešaka. Pogledajte izvještaj neuspjelih računa ispod.`
          : `Import je završen: ${finalSummary.success} uspješno, ${finalSummary.duplicate} duplikata.`
    );
  }

  async function retrySupplierImports(targetTins?: string[]) {
    const requestedTins = targetTins ? new Set(targetTins) : null;
    const selectedSuppliers = suppliersRequiringAccount.filter(
      (supplier) =>
        (!requestedTins || requestedTins.has(supplier.tin)) &&
        Boolean(supplierAccountCodes[supplier.tin])
    );
    const retryLinks = selectedSuppliers.flatMap((supplier) => supplier.links);

    if (!bookId || retryLinks.length === 0) {
      setStatus("error");
      setMessage("Izaberite konto za dobavljača prije ponovnog uvoza.");
      return;
    }

    const selectedCodes = Object.fromEntries(
      selectedSuppliers.map((supplier) => [
        supplier.tin,
        supplierAccountCodes[supplier.tin]
      ])
    );

    setStatus("loading");
    const { operationResults } = await importInBatches(retryLinks, {
      label: "Ponovni import dobavljača",
      replaceResults: false,
      documentType: "KUF",
      supplierAccountCodes: selectedCodes
    });
    setStatus("done");
    setMessage(
      `Ponovni import je završen: ${operationResults.filter(
        (result) => result.status === "success"
      ).length} uspješno.`
    );
  }

  async function retryFailedImports() {
    const retryLinks = retryableFailedResults.map((result) => result.link);

    if (retryLinks.length === 0) {
      setStatus("error");
      setMessage("Nema grešaka koje se mogu automatski ponoviti.");
      return;
    }

    setStatus("loading");
    const { operationResults } = await importInBatches(retryLinks, {
      label: "Ponovni pokušaj grešaka",
      replaceResults: false
    });
    setStatus("done");
    const retrySummary = summarizeResults(operationResults);
    setMessage(
      `Ponovni pokušaj je završen: ${retrySummary.success} uspješno, ${retrySummary.duplicate} duplikata, ${retrySummary.error} grešaka.`
    );
  }

  function downloadFailureReport() {
    const rows = [
      [
        "Izvorni fajl",
        "PIB",
        "IIC",
        "Datum",
        "Dobavljač",
        "Broj računa",
        "Ukupno",
        "Razlog",
        "MAPR link"
      ],
      ...failedResults.map((result) => {
        const details = maprLinkDetails(result.link);

        return [
          (linkSources[result.link] ?? []).join(" | ") || "Nalijepljeni link",
          result.partnerTin || details.tin,
          details.iic,
          details.createdAt,
          result.partner ?? "",
          result.invoiceNumber ?? "",
          result.total ?? details.total,
          result.message,
          result.link
        ];
      }),
      ...failedQrFiles.map((result) => [
        result.fileName,
        "",
        "",
        "",
        "",
        "",
        "",
        result.message,
        ""
      ])
    ];
    const csv = `\uFEFF${rows
      .map((row) => row.map((value) => csvCell(value)).join(";"))
      .join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `neuspjeli-import-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
                setSupplierAccountCodes({});
                setLinkSources({});
                setProgress(null);
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
              disabled={isReadingQrFiles || status === "loading"}
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

        {progress ? (
          <div
            className="invoice-import-progress"
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.processed}
          >
            <div className="invoice-import-progress-header">
              <strong>{progress.label}</strong>
              <span>
                {progress.processed}/{progress.total} · {progressPercent}%
              </span>
            </div>
            <div className="invoice-import-progress-track">
              <div
                className="invoice-import-progress-value"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="invoice-import-progress-counts">
              <span>Uspješno {progress.success}</span>
              <span>Duplikati {progress.duplicate}</span>
              <span>Greške {progress.error}</span>
            </div>
          </div>
        ) : null}

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
        {failedResults.length > 0 || failedQrFiles.length > 0 ? (
          <div className="import-failure-report">
            <div className="import-failure-report-header">
              <div>
                <h4>Računi koji nijesu uvezeni</h4>
                <p>
                  Ovdje su svi neuspjeli MAPR linkovi i dokumenti iz kojih QR
                  kod nije pročitan.
                </p>
              </div>
              <div className="import-failure-report-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={status === "loading"}
                  onClick={downloadFailureReport}
                >
                  Preuzmi CSV izvještaj
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    status === "loading" ||
                    retryableFailedResults.length === 0
                  }
                  onClick={() => void retryFailedImports()}
                >
                  Ponovi {retryableFailedResults.length} grešaka
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="import-failure-table">
                <thead>
                  <tr>
                    <th>Izvor / fajl</th>
                    <th>PIB / IIC</th>
                    <th>Dobavljač / račun</th>
                    <th>Razlog</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {failedResults.map((result) => {
                    const details = maprLinkDetails(result.link);
                    const sourceNames = linkSources[result.link] ?? [];

                    return (
                      <tr key={`failed-${result.link}`}>
                        <td>
                          {sourceNames.length > 0
                            ? sourceNames.join(", ")
                            : "Nalijepljeni MAPR link"}
                        </td>
                        <td>
                          <strong>{result.partnerTin || details.tin || "-"}</strong>
                          <small>{details.iic || "-"}</small>
                          {details.createdAt ? (
                            <small>{details.createdAt}</small>
                          ) : null}
                          {details.total ? (
                            <small>Iznos iz linka: {details.total}</small>
                          ) : null}
                        </td>
                        <td>
                          <strong>{result.partner ?? "-"}</strong>
                          <small>
                            {normalizeFiscalInvoiceNumber(result.invoiceNumber) ||
                              "-"}
                          </small>
                        </td>
                        <td>{result.message}</td>
                        <td>
                          <a
                            className="secondary-button"
                            href={result.link}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Otvori MAPR
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                  {failedQrFiles.map((result, index) => (
                    <tr key={`failed-file-${result.fileName}-${index}`}>
                      <td>{result.fileName}</td>
                      <td>-</td>
                      <td>-</td>
                      <td>{result.message}</td>
                      <td>Ponovo izaberite fajl</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {documentType === "KUF" && suppliersRequiringAccount.length > 0 ? (
          <div className="supplier-account-resolution">
            <div className="supplier-account-resolution-header">
              <div>
                <h4>Dobavljači bez konta knjiženja</h4>
                <p>
                  Konto se bira jednom po PIB-u i primjenjuje na sve prikazane
                  račune tog dobavljača.
                </p>
              </div>
              {suppliersRequiringAccount.length > 1 ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={status === "loading" || readySupplierCount === 0}
                  onClick={() => void retrySupplierImports()}
                >
                  Uvezi sve spremne
                </button>
              ) : null}
            </div>
            <div className="supplier-account-resolution-list">
              {suppliersRequiringAccount.map((supplier) => (
                <div className="supplier-account-resolution-row" key={supplier.tin}>
                  <div>
                    <strong>{supplier.partner}</strong>
                    <span>
                      PIB {supplier.tin} · {supplier.links.length}{" "}
                      {supplier.links.length === 1 ? "račun" : "računa"}
                    </span>
                  </div>
                  <label>
                    <span>Konto troška</span>
                    <select
                      disabled={status === "loading"}
                      value={supplierAccountCodes[supplier.tin] ?? ""}
                      onChange={(event) =>
                        setSupplierAccountCodes((current) => ({
                          ...current,
                          [supplier.tin]: event.target.value
                        }))
                      }
                    >
                      <option value="">Izaberite konto</option>
                      {accountOptions.map((account) => (
                        <option key={account.code} value={account.code}>
                          {account.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      status === "loading" ||
                      !supplierAccountCodes[supplier.tin]
                    }
                    onClick={() => void retrySupplierImports([supplier.tin])}
                  >
                    Uvezi {supplier.links.length}{" "}
                    {supplier.links.length === 1 ? "račun" : "računa"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>{documentType === "KIF" ? "Kupac" : "Dobavljač"}</th>
                <th>Račun</th>
                <th>Ukupno</th>
                {documentType === "KUF" ? <th>Konto</th> : null}
                <th>Poruka</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={documentType === "KUF" ? 6 : 5}>
                    Rezultat će se prikazati nakon importa.
                  </td>
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
                    {documentType === "KUF" ? (
                      <td>
                        {accountLabel(
                          result.accountCode ||
                            (result.partnerTin
                              ? supplierAccountCodes[result.partnerTin]
                              : undefined),
                          accountOptions
                        )}
                      </td>
                    ) : null}
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
