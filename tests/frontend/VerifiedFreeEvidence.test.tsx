import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifiedFreeEvidence } from "../../src/pilot/VerifiedFreeEvidence";
import * as api from "../../src/pilot/pilotApi";
import type { PilotCostVerification, PilotInventoryItem } from "../../src/pilot/pilotApi";

const item = { id: 7, name: "Oat milk", stockUnit: "L", currentOnHand: 10, averageUnitCost: 0 } as unknown as PilotInventoryItem;
const row = (over: Partial<PilotCostVerification> = {}): PilotCostVerification => ({
  id: 1, itemId: 7, quantity: 4, consumedQuantity: 0, remainingQuantity: 4, unit: "L", evidenceType: "donation",
  evidenceNote: "Neighbour cafe donation", correctionOfId: null, verifiedAt: null, revokedAt: null, revokedReason: "", ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe("VerifiedFreeEvidence", () => {
  it("renders nothing for priced stock without evidence", async () => {
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [] });
    const { container } = render(<VerifiedFreeEvidence item={{ ...item, averageUnitCost: 2.5 }} />);
    await waitFor(() => expect(api.fetchPilotCostVerifications).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("requires a note, blocks duplicate submits, refetches and notifies the parent after success", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValueOnce({ itemId: 7, verifications: [] }).mockResolvedValue({ itemId: 7, verifications: [row()] });
    let resolve!: (value: PilotCostVerification) => void;
    const create = vi.spyOn(api, "createPilotCostVerification").mockReturnValue(new Promise((r) => { resolve = r; }));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<VerifiedFreeEvidence item={item} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Explain how you know");
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByText("Saving…")).toBeDisabled();
    fireEvent.click(screen.getByText("Saving…"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ quantity: 10, evidenceNote: "Donated", idempotencyKey: expect.stringMatching(/^free-/) });
    resolve(row());
    expect(await screen.findByRole("status")).toHaveTextContent("Free stock recorded");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Neighbour cafe donation")).toBeInTheDocument();
  });

  it("reuses the idempotency key after a network failure and shows server refusals", async () => {
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [] });
    const create = vi.spyOn(api, "createPilotCostVerification").mockRejectedValueOnce(new Error("Network down")).mockResolvedValue(row());
    render(<VerifiedFreeEvidence item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    fireEvent.click(screen.getByText("Confirm free stock"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].idempotencyKey).toBe(create.mock.calls[0][1].idempotencyKey);
  });

  it("offers revoke only for unused evidence and requires a reason", async () => {
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [row({ id: 1 }), row({ id: 2, consumedQuantity: 1, remainingQuantity: 3 })] });
    const revoke = vi.spyOn(api, "revokePilotCostVerification").mockResolvedValue(row({ revokedAt: "x" }));
    render(<VerifiedFreeEvidence item={item} />);
    await screen.findAllByText("Correct");
    expect(screen.getAllByText("Revoke")).toHaveLength(1);
    fireEvent.click(screen.getByText("Revoke"));
    fireEvent.click(screen.getByText("Confirm revoke"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Say why");
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Entered twice" } });
    fireEvent.click(screen.getByText("Confirm revoke"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(1, { reason: "Entered twice" }));
  });
  it("re-reads evidence when on-hand stock changes elsewhere (e.g. a $0 transfer) and drops Revoke for consumed evidence", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications")
      .mockResolvedValueOnce({ itemId: 7, verifications: [row()] })
      .mockResolvedValue({ itemId: 7, verifications: [row({ consumedQuantity: 4, remainingQuantity: 0 })] });
    const { rerender } = render(<VerifiedFreeEvidence item={item} />);
    expect(await screen.findByText(/verified free 4 · unverified 6/)).toBeInTheDocument();
    expect(screen.getByText("Revoke")).toBeInTheDocument();
    rerender(<VerifiedFreeEvidence item={{ ...item, currentOnHand: 6 }} />);
    expect(await screen.findByText(/verified free 0 · unverified 6/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  });

  it("lets an unresolved retry reach the server even after the committed evidence reduced the unverified quantity", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications")
      .mockResolvedValueOnce({ itemId: 7, verifications: [] })
      .mockResolvedValue({ itemId: 7, verifications: [row({ quantity: 10, remainingQuantity: 10 })] });
    const create = vi.spyOn(api, "createPilotCostVerification").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(row({ quantity: 10, replayed: true }));
    render(<VerifiedFreeEvidence item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText("Confirm free stock"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].idempotencyKey).toBe(create.mock.calls[0][1].idempotencyKey);
  });
});
