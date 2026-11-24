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

  it("lets only the topmost of stacked modals handle Escape, and keeps page scroll locked until the last one closes", () => {
    const closeEditor = vi.fn();
    const closeConfirm = vi.fn();
    const { rerender } = render(
      <>
        <Modal title="Purchase editor" size="full" onClose={closeEditor}><input aria-label="Invoice number" /></Modal>
        <Modal title="Confirm receipt" size="small" onClose={closeConfirm}><p>Sure?</p></Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeConfirm).toHaveBeenCalledTimes(1);
    expect(closeEditor).not.toHaveBeenCalled(); // the editor underneath is untouched

    rerender(<Modal title="Purchase editor" size="full" onClose={closeEditor}><input aria-label="Invoice number" /></Modal>);
    expect(document.body.style.overflow).toBe("hidden"); // the editor is still open
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeEditor).toHaveBeenCalledTimes(1); // now it is the topmost
  });
});
