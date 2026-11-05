export type CsvCell = string | number | boolean | null | undefined;

/** Keep spreadsheet formulas from executing while preserving genuine numeric values. */
export function escapeCsvCell(value: CsvCell): string {
  const text = value === null || value === undefined ? "" : String(value);
  // NFKC handles full-width operators; normalize the mathematical minus sign too.
  const normalizedText = text.normalize("NFKC").replace(/\u2212/g, "-");
  const numericValue = Number(normalizedText);
  const formulaCandidate = normalizedText.replace(/^[\s\p{C}]*/u, "");
  const safeText = typeof value === "string" && text !== "" && !Number.isFinite(numericValue) && /^[=+\-@]/.test(formulaCandidate)
    ? `'${text}`
    : text;
  if (/[",\r\n]/.test(safeText)) {
    return `"${safeText.replace(/"/g, '""')}"`;
  }
  return safeText;
}

export function buildCsv(rows: Array<Record<string, CsvCell>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);

  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}

export function downloadCsvFile(filename: string, rows: Array<Record<string, CsvCell>>) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noreferrer";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
