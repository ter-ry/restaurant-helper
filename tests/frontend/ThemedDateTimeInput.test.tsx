import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemedDateTimeInput } from "../../src/components/ThemedDateTimeInput";

describe("ThemedDateTimeInput", () => {
  it("renders a calendar indicator for date and datetime-local fields and a clock for time fields", () => {
    const { rerender } = render(<ThemedDateTimeInput aria-label="Business date" type="date" />);
    expect(screen.getByRole("button", { name: "Open date picker" })).toBeVisible();
    expect(screen.getByLabelText("Business date")).toHaveClass("themed-date-time-input-field");

    rerender(<ThemedDateTimeInput aria-label="Start at" type="datetime-local" />);
    expect(screen.getByRole("button", { name: "Open date picker" })).toBeVisible();

    rerender(<ThemedDateTimeInput aria-label="Time" type="time" />);
    expect(screen.getByRole("button", { name: "Open time picker" })).toBeVisible();
  });

  it("opens the native picker from the custom indicator when showPicker is available", () => {
    render(<ThemedDateTimeInput aria-label="Business date" type="date" />);
    const input = screen.getByLabelText("Business date") as HTMLInputElement & { showPicker?: () => void };
    const showPicker = vi.fn();
    Object.defineProperty(input, "showPicker", { configurable: true, value: showPicker });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open date picker" }));

    expect(showPicker).toHaveBeenCalledOnce();
  });

  it("falls back to focusing the native input when showPicker is unavailable", () => {
    render(<ThemedDateTimeInput aria-label="Business date" type="date" />);
    const input = screen.getByLabelText("Business date") as HTMLInputElement;
    input.focus = vi.fn(() => HTMLElement.prototype.focus.call(input));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open date picker" }));

    expect(input.focus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
  });

  it("keeps the input keyboard accessible while the visual trigger is not a second tab stop", () => {
    render(
      <div className="pilot-theme pilot-theme-dark">
        <ThemedDateTimeInput aria-label="Business date" type="date" />
      </div>,
    );
    const input = screen.getByLabelText("Business date");
    const trigger = screen.getByRole("button", { name: "Open date picker" });

    expect(input).toHaveClass("themed-date-time-input-field");
    expect(trigger).toHaveClass("themed-date-time-input-trigger");
    expect(trigger).toHaveAttribute("tabindex", "-1");
  });
});
