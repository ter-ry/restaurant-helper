import { useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PilotApiError } from "./pilotApi";
import type { PilotInventoryItem, PilotLocation } from "./pilotApi";

/** An in-flight or unknown-outcome transfer attempt. Owned by the parent so it survives tab switches (unmounts). */
export type PendingTransfer = { itemId: number; key: string; destinationId: string; quantity: string; reason: string };

type Props = {
  /** Holds, per item, the idempotency key of an attempt whose outcome is not known, so a retry replays instead of transferring twice. */
  pendingRef: MutableRefObject<Record<number, PendingTransfer>>;
  item: PilotInventoryItem;
  currentLocationId: number | null | undefined;
  locations: PilotLocation[];
  /** Performs the transfer and refreshes dependent data; resolves with a success summary, or rejects with the server's error. */
  onTransfer: (request: { destinationLocationId: number; quantity: number; reason: string; idempotencyKey: string }) => Promise<string>;
  disabled?: boolean;
};

function newKey(itemId: number) {
  return `transfer-${itemId}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/** "Transfer to another location" (#233). Shows source stock, a confirmation step, progress, and server refusals. */
export function InventoryTransferAction({ pendingRef, item, currentLocationId, locations, onTransfer, disabled = false }: Props) {
  const destinations = locations.filter((location) => location.id !== currentLocationId);
  const restored = pendingRef.current[item.id] ?? null;
  const [open, setOpen] = useState(restored !== null);
  const [destinationId, setDestinationId] = useState<string>(restored?.destinationId ?? "");
  const [quantity, setQuantity] = useState(restored?.quantity ?? "");
  const [reason, setReason] = useState(restored?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(restored ? "A previous transfer attempt may not have finished. Check the movement history, then retry the same transfer (safe: it cannot apply twice) or discard it." : null);
  const [notice, setNotice] = useState<string | null>(null);
  // While an attempt's outcome is unknown the request is immutable: only the same request (same key) may be retried.
  const [unresolved, setUnresolved] = useState(restored !== null);
  const inFlight = useRef(false);

  if (destinations.length === 0) return null;

  const onHand = Number(item.currentOnHand);
  const parsedQuantity = Number(quantity);

  const submit = async () => {
    if (inFlight.current) return;
    // Retrying an unresolved attempt replays exactly what was sent; availability is then the server's call, because a
    // committed transfer replays regardless of the stock that is left.
    const pending = pendingRef.current[item.id];
    if (!pending) {
      if (!destinationId) return setError("Choose where to send the stock.");
      if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return setError("Enter a quantity greater than zero.");
      if (parsedQuantity > onHand) return setError(`Only ${onHand} ${item.stockUnit} is on hand here. Stock cannot go below zero.`);
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const attempt = pending ?? { itemId: item.id, key: newKey(item.id), destinationId, quantity, reason };
    pendingRef.current[item.id] = attempt;
    try {
      const summary = await onTransfer({ destinationLocationId: Number(attempt.destinationId), quantity: Number(attempt.quantity), reason: attempt.reason.trim(), idempotencyKey: attempt.key });
      delete pendingRef.current[item.id];
      setUnresolved(false);
      setNotice(summary);
      setOpen(false);
      setQuantity("");
      setReason("");
    } catch (err) {
      if (err instanceof PilotApiError && err.status >= 400 && err.status < 500) {
        delete pendingRef.current[item.id];
        setUnresolved(false);
        const detail = Object.values(err.errors ?? {}).join(" ");
        setError(detail ? `${err.message} ${detail}` : err.message);
      } else {
        setUnresolved(true);
        setError(`${err instanceof Error ? err.message : "Could not transfer stock."} Check the movement history before trying again.`);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      {notice ? <p role="status" aria-live="polite" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p> : null}
      {!open ? (
        <div>
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => { setNotice(null); setError(null); setOpen(true); }}>
            Transfer to another location
          </Button>
        </div>
      ) : (
        <Card className="grid gap-3 border border-line p-4" data-testid="transfer-panel">
          <p className="text-sm font-semibold text-ink">Transfer {item.name}</p>
          <p className="text-sm text-muted">Available here: <span className="font-semibold text-ink">{onHand} {item.stockUnit}</span>. The matching item at the destination is found by name; its cost is blended with the cost of what you send.</p>
          <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`transfer-destination-${item.id}`}>
            Send to
            <select id={`transfer-destination-${item.id}`} className="input" value={destinationId} disabled={busy || unresolved} onChange={(event) => setDestinationId(event.target.value)}>
              <option value="">Choose a location</option>
              {destinations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`transfer-quantity-${item.id}`}>
            Quantity ({item.stockUnit})
            <input id={`transfer-quantity-${item.id}`} className="input" inputMode="decimal" value={quantity} disabled={busy || unresolved} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`transfer-reason-${item.id}`}>
            Note (optional)
            <input id={`transfer-reason-${item.id}`} className="input" value={reason} disabled={busy || unresolved} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || disabled} onClick={() => void submit()}>{busy ? "Transferring…" : unresolved ? "Retry same transfer" : "Confirm transfer"}</Button>
            {unresolved ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { delete pendingRef.current[item.id]; setUnresolved(false); setError(null); }}>
                Discard attempt
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
