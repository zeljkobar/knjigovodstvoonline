// Row-level provenance stays in the browser, including retries and CSV reports.
export function excelLinkSources(rows: string[][], fallback: string) {
  const normalize = (value: string) => String(value ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\s-]+/g, " ").trim();
  const nameColumn = (rows[0] ?? []).findIndex((value) =>
    ["naziv dokumenta", "naziv fajla", "dokument", "document name", "filename", "file name"].includes(normalize(value))
  );
  return rows.flatMap((row) => {
    const links = row.flatMap((value) => String(value ?? "").split(/[\n\r\t,; ]+/)
      .filter((part) => part.startsWith("http")));
    const name = String(nameColumn >= 0 ? row[nameColumn] ?? "" : row.find((value) =>
      /\.(?:pdf|tiff?|jpe?g|png)$/i.test(String(value ?? "").trim())
    ) ?? "").trim();
    return links.map((link) => ({ link, name: name || fallback }));
  });
}
