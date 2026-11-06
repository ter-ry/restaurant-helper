import { useRef, useState } from "react";
import { Button } from "../components/Button";
import type { PilotInventoryMovement } from "./pilotApi";

type Props = {
  movement: PilotInventoryMovement;
  /** Performs the reversal and refreshes dependent data; rejects with an Error whose message is shown to the user. */
  onReverse: (movement: PilotInventoryMovement, reason: string, idempotencyKey: string) => Promise<void>;
  disabled?: boolean;
};

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Status cell + "Reverse" action for one movement row (#231). Append-only: the original row is never edited. */
export function AdjustmentReversalAction({ movement, onReverse, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per confirmation, reused across retries of the same attempt so a retry can never double-post.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  if (movement.reversedByMovementId) {
    return <span className="text-xs font-semibold text-muted">Reversed by #{movement.reversedByMovementId}</span>;
  }
  if (movement.reversalOfMovementId) {
    return <span className="text-xs font-semibold text-muted">Reversal of #{movement.reversalOfMovementId}</span>;
  }
  if (!movement.reversible) {
    return <span className="text-xs text-muted">—</span>;
  }
  if (!open) {
    return (
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => { keyRef.current = newKey(); setError(null); setOpen(true); }}>
        Reverse
      </Button>
    );
  }

  const confirm = async () => {
    if (inFlight.current) return;
    if (!reason.trim()) {
      setError("Enter a reason for the reversal.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onReverse(movement, reason.trim(), keyRef.current ?? newKey());
      setOpen(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reverse this adjustment.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="grid min-w-[14rem] gap-2" data-testid={`reverse-panel-${movement.id}`}>
      <label className="text-xs font-semibold text-ink" htmlFor={`reverse-reason-${movement.id}`}>Reason for reversing</label>
      <input
        id={`reverse-reason-${movement.id}`}
        className="rounded-lg border border-line px-2 py-1 text-sm"
        value={reason}
        disabled={pending}
        onChange={(event) => setReason(event.target.value)}
      />
      <p className="text-xs text-muted">Adds a linked correcting entry. The original entry stays in the history.</p>
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" disabled={pending || disabled} onClick={() => void confirm()}>{pending ? "Reversing…" : "Confirm reversal"}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
