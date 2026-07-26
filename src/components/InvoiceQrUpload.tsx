"use client";

import { useRef, useState } from "react";

type Status = "idle" | "loading" | "ok" | "error";
type QrReader = import("@zxing/browser").BrowserQRCodeReader;
type BarcodeDetectorInstance = {
  detect(source: HTMLCanvasElement): Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorInstance;
type QrDecoders = {
  reader: QrReader;
  detector: BarcodeDetectorInstance | null;
};
type CanvasRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const maxFileSize = 20 * 1024 * 1024;
const maxPdfPages = 8;
const maxTiffPages = 8;
const maxImageDimension = 6000;
export const invoiceQrFileAccept =
  ".pdf,.tif,.tiff,.jpg,.jpeg,.png,application/pdf,image/tiff,image/jpeg,image/png";

const scanRegions: CanvasRegion[] = [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 0, y: 0.52, width: 1, height: 0.48 },
  { x: 0, y: 0, width: 1, height: 0.48 },
  { x: 0, y: 0.45, width: 0.62, height: 0.55 },
  { x: 0.38, y: 0.45, width: 0.62, height: 0.55 },
  { x: 0, y: 0, width: 0.62, height: 0.55 },
  { x: 0.38, y: 0, width: 0.62, height: 0.55 },
  { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
  { x: 0, y: 0.2, width: 0.55, height: 0.6 },
  { x: 0.45, y: 0.2, width: 0.55, height: 0.6 },
];

function canvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Preglednik ne podržava obradu slike.");
  }

  return context;
}

function maprLink(rawValue: string) {
  const value = rawValue.trim();

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "mapr.tax.gov.me") {
      return null;
    }

    const queryFromSearch = url.search ? url.search.slice(1) : "";
    const hashQueryIndex = url.hash.indexOf("?");
    const queryFromHash = hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "";
    const params = new URLSearchParams(queryFromSearch || queryFromHash);

    return params.get("iic") &&
      params.get("tin") &&
      params.get("prc") &&
      params.get("crtd")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

async function decodeCanvas(
  canvas: HTMLCanvasElement,
  decoders: QrDecoders,
) {
  function cropCanvas(region: CanvasRegion) {
    if (
      region.x === 0 &&
      region.y === 0 &&
      region.width === 1 &&
      region.height === 1
    ) {
      return canvas;
    }

    const sourceX = Math.floor(canvas.width * region.x);
    const sourceY = Math.floor(canvas.height * region.y);
    const sourceWidth = Math.max(1, Math.ceil(canvas.width * region.width));
    const sourceHeight = Math.max(1, Math.ceil(canvas.height * region.height));
    const cropped = document.createElement("canvas");
    cropped.width = sourceWidth;
    cropped.height = sourceHeight;
    canvasContext(cropped).drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    );
    return cropped;
  }

  function upscaleCanvas(source: HTMLCanvasElement) {
    const largestDimension = Math.max(source.width, source.height);
    const scale = Math.min(3, 2200 / largestDimension);

    if (scale <= 1.15) {
      return null;
    }

    const resized = document.createElement("canvas");
    resized.width = Math.max(1, Math.round(source.width * scale));
    resized.height = Math.max(1, Math.round(source.height * scale));
    const context = canvasContext(resized);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, resized.width, resized.height);
    return resized;
  }

  function thresholdCanvas(source: HTMLCanvasElement, inverted: boolean) {
    const enhanced = document.createElement("canvas");
    enhanced.width = source.width;
    enhanced.height = source.height;
    const context = canvasContext(enhanced);
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, enhanced.width, enhanced.height);
    const histogram = new Uint32Array(256);
    let luminanceSum = 0;

    for (let offset = 0; offset < image.data.length; offset += 4) {
      const luminance =
        (image.data[offset] * 77 +
          image.data[offset + 1] * 150 +
          image.data[offset + 2] * 29) >>
        8;
      histogram[luminance] += 1;
      luminanceSum += luminance;
    }

    const pixelCount = enhanced.width * enhanced.height;
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 160;

    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (backgroundWeight === 0) continue;

      const foregroundWeight = pixelCount - backgroundWeight;
      if (foregroundWeight === 0) break;

      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (luminanceSum - backgroundSum) / foregroundWeight;
      const variance =
        backgroundWeight *
        foregroundWeight *
        (backgroundMean - foregroundMean) *
        (backgroundMean - foregroundMean);

      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }

    for (let offset = 0; offset < image.data.length; offset += 4) {
      const luminance =
        (image.data[offset] * 77 +
          image.data[offset + 1] * 150 +
          image.data[offset + 2] * 29) >>
        8;
      const dark = luminance <= threshold;
      const color = dark !== inverted ? 0 : 255;
      image.data[offset] = color;
      image.data[offset + 1] = color;
      image.data[offset + 2] = color;
      image.data[offset + 3] = 255;
    }

    context.putImageData(image, 0, 0);
    return enhanced;
  }

  async function decodeCandidate(candidate: HTMLCanvasElement) {
    if (decoders.detector) {
      try {
        const detected = await decoders.detector.detect(candidate);
        for (const code of detected) {
          const link = maprLink(code.rawValue ?? "");
          if (link) return link;
        }
      } catch {
        // ZXing is the fallback when the browser detector rejects a canvas.
      }
    }

    try {
      return maprLink(decoders.reader.decodeFromCanvas(candidate).getText());
    } catch {
      return null;
    }
  }

  const passes: Array<"original" | "threshold" | "inverted"> = [
    "original",
    "threshold",
    "inverted",
  ];
  let attempt = 0;

  for (const pass of passes) {
    const regions = pass === "inverted" ? scanRegions.slice(0, 3) : scanRegions;

    for (const region of regions) {
      try {
        const cropped = cropCanvas(region);
        const candidate =
          pass === "original"
            ? cropped
            : thresholdCanvas(cropped, pass === "inverted");
        const directLink = await decodeCandidate(candidate);
        if (directLink) return directLink;

        const upscaled = upscaleCanvas(candidate);
        if (upscaled) {
          const upscaledLink = await decodeCandidate(upscaled);
          if (upscaledLink) return upscaledLink;
        }
      } catch {
        // Nastavi sa sljedećom zonom ili obradom ako jedna canvas operacija ne uspije.
      }

      attempt += 1;
      if (attempt % 3 === 0) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }
  }

  return null;
}

function createQrDecoders(reader: QrReader): QrDecoders {
  const Detector = (
    window as typeof window & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }
  ).BarcodeDetector;
  let detector: BarcodeDetectorInstance | null = null;

  try {
    detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
  } catch {
    detector = null;
  }

  return { reader, detector };
}

async function imageCanvas(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    maxImageDimension / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvasContext(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function decodePdf(
  bytes: ArrayBuffer,
  decoders: QrDecoders,
) {
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loadingTask.promise;

  try {
    const pages = Array.from(
      new Set(
        pdf.numPages <= maxPdfPages
          ? Array.from({ length: pdf.numPages }, (_, index) => index + 1)
          : [...Array.from({ length: maxPdfPages - 1 }, (_, index) => index + 1), pdf.numPages],
      ),
    );

    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        4.5,
        4200 / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      await page.render({
        canvas,
        canvasContext: canvasContext(canvas),
        viewport,
      }).promise;

      const link = await decodeCanvas(canvas, decoders);
      page.cleanup();

      if (link) {
        return link;
      }
    }

    return null;
  } finally {
    await loadingTask.destroy();
  }
}

async function decodeTiff(
  bytes: ArrayBuffer,
  decoders: QrDecoders,
) {
  const UTIF = (await import("utif")).default;
  const pages = UTIF.decode(bytes);

  for (const page of pages.slice(0, maxTiffPages)) {
    UTIF.decodeImage(bytes, page);

    if (!page.width || !page.height) {
      continue;
    }

    const rgba = UTIF.toRGBA8(page);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = page.width;
    sourceCanvas.height = page.height;
    const sourceContext = canvasContext(sourceCanvas);
    const pixels = new Uint8ClampedArray(rgba.byteLength);
    pixels.set(rgba);
    sourceContext.putImageData(new ImageData(pixels, page.width, page.height), 0, 0);

    const scale = Math.min(
      1,
      maxImageDimension / Math.max(page.width, page.height),
    );
    const canvas =
      scale === 1
        ? sourceCanvas
        : (() => {
            const resized = document.createElement("canvas");
            resized.width = Math.max(1, Math.round(page.width * scale));
            resized.height = Math.max(1, Math.round(page.height * scale));
            canvasContext(resized).drawImage(
              sourceCanvas,
              0,
              0,
              resized.width,
              resized.height,
            );
            return resized;
          })();

    const link = await decodeCanvas(canvas, decoders);
    if (link) {
      return link;
    }
  }

  return null;
}

function fileKind(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    file.type === "image/tiff" ||
    file.type === "image/tif" ||
    extension === "tif" ||
    extension === "tiff"
  ) {
    return "tiff";
  }

  if (
    ["image/jpeg", "image/png"].includes(file.type) ||
    ["jpg", "jpeg", "png"].includes(extension ?? "")
  ) {
    return "image";
  }

  return null;
}

export async function decodeInvoiceQrFile(file: File) {
  const kind = fileKind(file);

  if (!kind) {
    throw new Error("Podržani su PDF, TIFF, JPG i PNG fajlovi.");
  }

  if (file.size > maxFileSize) {
    throw new Error("Fajl može imati najviše 20 MB.");
  }

  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const hints = new Map();
  hints.set(3, true); // DecodeHintType.TRY_HARDER
  const reader = new BrowserQRCodeReader(hints);
  const decoders = createQrDecoders(reader);
  const bytes = await file.arrayBuffer();
  const link =
    kind === "pdf"
      ? await decodePdf(bytes, decoders)
      : kind === "tiff"
        ? await decodeTiff(bytes, decoders)
        : await decodeCanvas(await imageCanvas(file), decoders);

  if (!link) {
    throw new Error("MAPR QR kod nije pronađen ili nije dovoljno čitljiv.");
  }

  return link;
}

export function InvoiceQrUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function processFile(file: File) {
    setStatus("loading");
    setMessage("Čitam QR kod iz računa...");

    try {
      const link = await decodeInvoiceQrFile(file);

      document.dispatchEvent(
        new CustomEvent("fiscal-file-link-decoded", { detail: { url: link } }),
      );
      document.dispatchEvent(new CustomEvent("fiscal-mapr-load-requested"));
      setStatus("ok");
      setMessage(`QR kod je pročitan iz fajla „${file.name}”. Fajl nije sačuvan.`);
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Fajl nije moguće obraditi. Provjerite da nije oštećen.",
      );
    }
  }

  return (
    <div className="invoice-qr-upload form-wide">
      <input
        ref={inputRef}
        accept={invoiceQrFileAccept}
        hidden
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void processFile(file);
          }
        }}
      />
      <button
        className="secondary-button"
        disabled={status === "loading"}
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        {status === "loading" ? "Čitam QR kod..." : "Učitaj račun (PDF/slika)"}
      </button>
      <small>Fajl se obrađuje samo u ovom pregledniku i ne čuva se na serveru.</small>
      {message ? (
        <p
          className={`fiskalni-status fiskalni-status--${
            status === "ok" ? "ok" : status === "error" ? "error" : "warn"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
