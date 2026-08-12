export type CsvCell = string | number | boolean | null | undefined;

export function buildCsv(rows: Array<Record<string, CsvCell>>) {
  if (rows.length === 0) {
    return "";
  }

  const headers = Object.keys(rows[0]);

  const escapeCell = (value: CsvCell) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
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
