import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable, type Column } from "../../src/components/DataTable";

type Row = { name: string; quantity: number; date: string; status: string; amount: number | null };

const rows: Row[] = [
  { name: "Zucchini", quantity: 2, date: "2026-09-10", status: "Low stock", amount: null },
  { name: "Apple", quantity: 10, date: "2026-09-01", status: "Out of stock", amount: 12.5 },
  { name: "bread", quantity: 5, date: "2026-09-20", status: "In stock", amount: 4.25 },
];

const columns: Column<Row>[] = [
  { header: "Name", accessor: "name", sortValue: (row) => row.name },
  { header: "Quantity", accessor: "quantity", sortValue: (row) => row.quantity },
  { header: "Date", accessor: "date", sortValue: (row) => new Date(row.date) },
  { header: "Status", accessor: "status", sortValue: (row) => row.status, sortOrder: ["Out of stock", "Low stock", "In stock"] },
  { header: "Amount", accessor: (row) => row.amount ?? "—", sortValue: (row) => row.amount },
];

function names() {
  return [...screen.getAllByRole("row")].slice(1).map((row) => row.querySelector("td")?.textContent);
}

describe("DataTable sorting", () => {
  it("cycles ascending, descending, and default ordering using raw values", async () => {
    render(<DataTable columns={columns} data={rows} getRowKey={(row) => row.name} />);
    const quantity = screen.getByRole("button", { name: /Quantity/ });

    fireEvent.click(quantity);
    expect(names()).toEqual(["Zucchini", "bread", "Apple"]);
    fireEvent.click(quantity);
    expect(names()).toEqual(["Apple", "bread", "Zucchini"]);
    fireEvent.click(quantity);
    expect(names()).toEqual(["Zucchini", "Apple", "bread"]);
  });

  it("sorts business status priority and keeps missing values last", async () => {
    render(<DataTable columns={columns} data={rows} getRowKey={(row) => row.name} />);
    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    expect(names()).toEqual(["Apple", "Zucchini", "bread"]);
    fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(names()).toEqual(["bread", "Apple", "Zucchini"]);
    fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(names()).toEqual(["Apple", "bread", "Zucchini"]);
  });
});
