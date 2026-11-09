import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryTransferAction } from "../../src/pilot/InventoryTransferAction";
import { PilotApiError } from "../../src/pilot/pilotApi";

const item: any = { id: 30, name: "Flour", stockUnit: "kg", currentOnHand: 10 };
const locations: any[] = [{ id: 7, name: "Main" }, { id: 8, name: "Kiosk" }];

function setup(onTransfer: any, props: Record<string, unknown> = {}) {
  render(<InventoryTransferAction item={item} currentLocationId={7} locations={locations} onTransfer={onTransfer} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer to another location" }));
}

function fill(quantity: string, destination = "8") {
  fireEvent.change(screen.getByLabelText("Send to"), { target: { value: destination } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: quantity } });
}

describe("inventory transfer UI (#233)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the organization has only one location", () => {
    const { container } = render(<InventoryTransferAction item={item} currentLocationId={7} locations={[locations[0]]} onTransfer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("validates locally (destination, quantity, available stock) without calling the server", async () => {
    const onTransfer = vi.fn();
    setup(onTransfer);
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose where to send");
    fill("0");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("greater than zero");
    fill("11");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only 10 kg is on hand");
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("shows progress, blocks double submit, sends one request with a key, then reports success", async () => {
    let resolve!: (value: string) => void;
    const onTransfer = vi.fn().mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    setup(onTransfer);
    fill("4");
    const confirm = screen.getByRole("button", { name: "Confirm transfer" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByRole("button", { name: "Transferring…" })).toBeDisabled();
    expect(onTransfer).toHaveBeenCalledTimes(1);
    expect(onTransfer.mock.calls[0][0]).toMatchObject({ destinationLocationId: 8, quantity: 4 });
    expect(onTransfer.mock.calls[0][0].idempotencyKey).toMatch(/^transfer-30-/);
    resolve("Transferred 4 kg of Flour to Kiosk.");
    expect(await screen.findByRole("status")).toHaveTextContent("Transferred 4 kg of Flour to Kiosk.");
    expect(screen.queryByTestId("transfer-panel")).toBeNull();
  });

  it("reuses the key after an unknown outcome and uses a fresh key after a definite refusal", async () => {
    const onTransfer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network down"))
      .mockRejectedValueOnce(new PilotApiError("Not enough stock to transfer.", 409, { quantity: "Only 3 kg on hand." }))
      .mockResolvedValue("ok");
    setup(onTransfer);
    fill("4");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the movement history");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(2));
    expect(onTransfer.mock.calls[1][0].idempotencyKey).toBe(onTransfer.mock.calls[0][0].idempotencyKey);
    expect(await screen.findByText(/Not enough stock to transfer. Only 3 kg on hand./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(3));
    expect(onTransfer.mock.calls[2][0].idempotencyKey).not.toBe(onTransfer.mock.calls[1][0].idempotencyKey);
  });
});
