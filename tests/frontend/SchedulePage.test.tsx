import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SchedulePage } from "../../src/pages/SchedulePage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/demo/cafe/schedule"]}>
      <SchedulePage />
    </MemoryRouter>,
  );
}

describe("SchedulePage conflict preview", () => {
  it("shows the reason before confirming and only saves on confirm", () => {
    renderPage();
    const select = screen.getByLabelText("Sun Close assignment");
    fireEvent.change(select, { target: { value: "ben" } });
    const preview = screen.getByRole("status");
    expect(within(preview).getByText(/Assign Ben Wong to Sun Close/)).toBeTruthy();
    expect(within(preview).getByText(/outside stated availability/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Sun Close assignment") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Sun Close assignment"), { target: { value: "sofia" } });
    expect(screen.getByText(/already on Sun Mid/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign anyway" }));
    expect((screen.getByLabelText("Sun Close assignment") as HTMLSelectElement).value).toBe("sofia");
  });

  it("derives warnings from data and updates them when a shift is reassigned", () => {
    renderPage();
    expect(screen.getByText(/Thu Close: outside availability/)).toBeTruthy();
    expect(screen.getByText("Sun Close needs coverage")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Thu Close assignment"), { target: { value: "noah" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByText(/Thu Close: outside availability/)).toBeNull();
  });
});
