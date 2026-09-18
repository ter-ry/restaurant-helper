import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  sortOrder?: readonly string[];
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
    const priority = column.sortOrder;
    const compare = (left: T, right: T) => {
      const a = column.sortValue?.(left);
      const b = column.sortValue?.(right);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (priority) {
        const ai = priority.indexOf(String(a));
        const bi = priority.indexOf(String(b));
        if (ai !== bi) return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi);
      }
      if (a instanceof Date || b instanceof Date) return new Date(a).getTime() - new Date(b).getTime();
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
    };
    return [...data].sort((left, right) => (sort.direction === "asc" ? compare(left, right) : -compare(left, right)));
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
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
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
                className={onRowClick ? "cursor-pointer transition hover:bg-slate-50" : ""}
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
