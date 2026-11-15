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
    const { container } = render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={{ ...item, averageUnitCost: 2.5 }} />);
    await waitFor(() => expect(api.fetchPilotCostVerifications).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("requires a note, blocks duplicate submits, refetches and notifies the parent after success", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValueOnce({ itemId: 7, verifications: [] }).mockResolvedValue({ itemId: 7, verifications: [row()] });
    let resolve!: (value: PilotCostVerification) => void;
    const create = vi.spyOn(api, "createPilotCostVerification").mockReturnValue(new Promise((r) => { resolve = r; }));
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={item} onChanged={onChanged} />);
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
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    fireEvent.click(screen.getByText("Retry same request"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].idempotencyKey).toBe(create.mock.calls[0][1].idempotencyKey);
  });

  it("offers revoke only for unused evidence and requires a reason", async () => {
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [row({ id: 1 }), row({ id: 2, consumedQuantity: 1, remainingQuantity: 3 })] });
    const revoke = vi.spyOn(api, "revokePilotCostVerification").mockResolvedValue(row({ revokedAt: "x" }));
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={item} />);
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
    const { rerender } = render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={item} />);
    expect(await screen.findByText(/verified free 4 · unverified 6/)).toBeInTheDocument();
    expect(screen.getByText("Revoke")).toBeInTheDocument();
    rerender(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={{ ...item, currentOnHand: 6 }} />);
    expect(await screen.findByText(/verified free 0 · unverified 6/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Revoke")).not.toBeInTheDocument();
  });

  it("lets an unresolved retry reach the server even after the committed evidence reduced the unverified quantity", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications")
      .mockResolvedValueOnce({ itemId: 7, verifications: [] })
      .mockResolvedValue({ itemId: 7, verifications: [row({ quantity: 10, remainingQuantity: 10 })] });
    const create = vi.spyOn(api, "createPilotCostVerification").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(row({ quantity: 10, replayed: true }));
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText("Retry same request"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].idempotencyKey).toBe(create.mock.calls[0][1].idempotencyKey);
  });
  it("keeps an unresolved request and its key across an unmount (tab switch) so a retry replays instead of recording twice", async () => {
    const pendingRef = { current: {} };
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [] });
    const create = vi.spyOn(api, "createPilotCostVerification").mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(row({ replayed: true }));
    const first = render(<VerifiedFreeEvidence pendingRef={pendingRef} item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    first.unmount();
    render(<VerifiedFreeEvidence pendingRef={pendingRef} item={item} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("previous attempt may not have finished");
    expect(screen.getByLabelText(/Evidence note/)).toBeDisabled();
    fireEvent.click(screen.getByText("Retry same request"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).toEqual(create.mock.calls[0][1]);
    expect(await screen.findByRole("status")).toHaveTextContent("Free stock recorded");
    expect(pendingRef.current).toEqual({});
  });
  it("accepts the exact remaining fractional quantity (0.3 on hand, 0.1 verified, 0.2 left)", async () => {
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [row({ quantity: 0.1, remainingQuantity: 0.1 })] });
    const create = vi.spyOn(api, "createPilotCostVerification").mockResolvedValue(row());
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={{ ...item, currentOnHand: 0.3 }} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("retries with the original key when the original instance finished after a tab switch and cleared the shared entry", async () => {
    const pendingRef = { current: {} };
    vi.spyOn(api, "fetchPilotCostVerifications").mockResolvedValue({ itemId: 7, verifications: [] });
    let resolveFirst!: (value: PilotCostVerification) => void;
    const create = vi.spyOn(api, "createPilotCostVerification")
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue(row({ replayed: true }));
    const first = render(<VerifiedFreeEvidence pendingRef={pendingRef} item={item} />);
    fireEvent.click(await screen.findByText("Record verified free stock"));
    fireEvent.change(screen.getByLabelText(/Evidence note/), { target: { value: "Donated" } });
    fireEvent.click(screen.getByText("Confirm free stock"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<VerifiedFreeEvidence pendingRef={pendingRef} item={item} />);
    resolveFirst(row());
    await waitFor(() => expect(pendingRef.current).toEqual({}));
    fireEvent.click(await screen.findByText("Retry same request"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1].idempotencyKey).toBe(create.mock.calls[0][1].idempotencyKey);
  });

  it("keeps a failed evidence load visible, with Try again, for depleted stock", async () => {
    const list = vi.spyOn(api, "fetchPilotCostVerifications").mockRejectedValueOnce(new Error("Server unavailable")).mockResolvedValue({ itemId: 7, verifications: [row()] });
    render(<VerifiedFreeEvidence pendingRef={{ current: {} }} item={{ ...item, currentOnHand: 0 }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Neighbour cafe donation")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
