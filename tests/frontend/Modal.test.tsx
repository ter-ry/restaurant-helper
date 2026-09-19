import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../../src/components/Modal";

describe("Modal focus lifecycle", () => {
  it("does not steal input focus when an inline close callback changes", () => {
    const firstClose = vi.fn();
    const { rerender, getByRole } = render(
      <Modal title="New recipe" onClose={firstClose}>
        <input aria-label="Name" />
      </Modal>,
    );
    const input = getByRole("textbox", { name: "Name" });
    input.focus();
    const latestClose = vi.fn();

    rerender(
      <Modal title="New recipe" onClose={latestClose}>
        <input aria-label="Name" />
      </Modal>,
    );

    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);
  });
});
