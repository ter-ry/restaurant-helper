import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, getRowKey, onRowClick }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.header} className={`px-4 py-3 font-bold ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((row) => (
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
