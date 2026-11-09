import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryTransferAction, type PendingTransfer } from "../../src/pilot/InventoryTransferAction";
import { PilotApiError } from "../../src/pilot/pilotApi";

const item: any = { id: 30, name: "Flour", stockUnit: "kg", currentOnHand: 10 };
const locations: any[] = [{ id: 7, name: "Main" }, { id: 8, name: "Kiosk" }];

let pendingRef: { current: Record<number, PendingTransfer> };

function setup(onTransfer: any, props: Record<string, unknown> = {}) {
  pendingRef = { current: {} };
  render(<InventoryTransferAction pendingRef={pendingRef} item={item} currentLocationId={7} locations={locations} onTransfer={onTransfer} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Transfer to another location" }));
}

function fill(quantity: string, destination = "8") {
  fireEvent.change(screen.getByLabelText("Send to"), { target: { value: destination } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: quantity } });
}

describe("inventory transfer UI (#233)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when the organization has only one location", () => {
    const { container } = render(<InventoryTransferAction pendingRef={{ current: {} }} item={item} currentLocationId={7} locations={[locations[0]]} onTransfer={vi.fn()} />);
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

  it("keeps the key of an unknown-outcome attempt when the panel is unmounted and reopened (tab switch)", async () => {
    const onTransfer = vi.fn().mockRejectedValueOnce(new Error("Network down")).mockResolvedValue("ok");
    const first = render(<InventoryTransferAction pendingRef={(pendingRef = { current: {} })} item={item} currentLocationId={7} locations={locations} onTransfer={onTransfer} />);
    fireEvent.click(screen.getByRole("button", { name: "Transfer to another location" }));
    fill("4");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await screen.findByRole("alert");
    const firstKey = onTransfer.mock.calls[0][0].idempotencyKey;

    first.unmount(); // History tab unmounts the Overview tab
    render(<InventoryTransferAction pendingRef={pendingRef} item={item} currentLocationId={7} locations={locations} onTransfer={onTransfer} />);
    expect(screen.getByLabelText(/Quantity/)).toHaveValue("4");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(2));
    expect(onTransfer.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  });

  it("keeps item A's unresolved key when item B is transferred in between", async () => {
    const itemB: any = { id: 31, name: "Sugar", stockUnit: "kg", currentOnHand: 10 };
    const onTransfer = vi.fn().mockRejectedValueOnce(new Error("Network down")).mockResolvedValue("ok");
    pendingRef = { current: {} };
    const ui = (shown: any) => <InventoryTransferAction pendingRef={pendingRef} item={shown} currentLocationId={7} locations={locations} onTransfer={onTransfer} />;
    const a = render(ui(item));
    fireEvent.click(screen.getByRole("button", { name: "Transfer to another location" }));
    fill("4");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await screen.findByRole("alert");
    const keyA = onTransfer.mock.calls[0][0].idempotencyKey;
    a.unmount();

    const b = render(ui(itemB));
    fireEvent.click(screen.getByRole("button", { name: "Transfer to another location" }));
    fill("2");
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(2));
    await screen.findByRole("status");
    expect(onTransfer.mock.calls[1][0].idempotencyKey).not.toBe(keyA);
    b.unmount();

    render(ui(item));
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledTimes(3));
    expect(onTransfer.mock.calls[2][0].idempotencyKey).toBe(keyA);
  });
});
