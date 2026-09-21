import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  sortOrder?: readonly string[];
}

export type SortDirection = "asc" | "desc";

export function sortRows<T>(data: T[], getValue: (row: T) => string | number | Date | null | undefined, direction: SortDirection, sortOrder?: readonly string[]) {
  const priority = sortOrder;
  const compare = (left: T, right: T) => {
    const a = getValue(left);
    const b = getValue(right);
    // Missing values remain at the bottom in both directions.
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    let result: number;
    if (priority) {
      const ai = priority.indexOf(String(a));
      const bi = priority.indexOf(String(b));
      if (ai !== bi) result = (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi);
      else result = 0;
    } else if (a instanceof Date || b instanceof Date) {
      const at = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
      const bt = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
      const aValid = Number.isFinite(at);
      const bValid = Number.isFinite(bt);
      // Invalid dates are missing values and must remain last in either direction.
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      result = at - bt;
    } else if (typeof a === "number" && typeof b === "number") result = a - b;
    else result = String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
    return direction === "asc" ? result : -result;
  };
  return [...data].sort(compare);
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, getRowKey, onRowClick }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ index: number; direction: "asc" | "desc" } | null>(null);
  const sortedData = useMemo(() => {
    if (!sort) return data;
    const column = columns[sort.index];
    if (!column.sortValue) return data;
    return sortRows(data, column.sortValue, sort.direction, column.sortOrder);
  }, [columns, data, sort]);

  const toggleSort = (index: number) => {
    const column = columns[index];
    if (!column.sortValue) return;
    setSort((current) => {
      if (!current || current.index !== index) return { index, direction: "asc" };
      if (current.direction === "asc") return { index, direction: "desc" };
      return null;
    });
  };

  return (
    <div className="pilot-table-wrap overflow-hidden rounded-lg border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="pilot-table min-w-full divide-y divide-line text-left text-sm">
          <thead className="pilot-table-header bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((column, index) => (
                <th key={column.header} className={`px-4 py-3 font-bold ${column.className ?? ""}`} aria-sort={sort?.index === index ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                  {column.sortValue ? (
                    <button type="button" className="inline-flex items-center gap-1 text-left" onClick={() => toggleSort(index)}>
                      {column.header}
                      <span aria-hidden="true" className="text-[10px]">{sort?.index === index ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedData.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`pilot-table-row ${onRowClick ? "cursor-pointer transition hover:bg-slate-50" : ""}`}
              >
                {columns.map((column) => {
                  const value =
                    typeof column.accessor === "function" ? column.accessor(row) : (row[column.accessor] as ReactNode);
                  return (
                    <td key={column.header} className={`px-4 py-3 align-middle text-slate-700 ${column.className ?? ""}`}>
                      {value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
