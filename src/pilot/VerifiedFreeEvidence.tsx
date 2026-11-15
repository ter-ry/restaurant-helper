import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import {
  COST_EVIDENCE_TYPES,
  PilotApiError,
  correctPilotCostVerification,
  createPilotCostVerification,
  fetchPilotCostVerifications,
  revokePilotCostVerification,
} from "./pilotApi";
import type { PilotCostVerification, PilotInventoryItem } from "./pilotApi";

const TYPE_LABELS: Record<string, string> = {
  supplier_free_goods: "Free goods from a supplier",
  donation: "Donation",
  promotional_sample: "Promotional sample",
  other_documented: "Other (documented below)",
};

type Props = {
  item: PilotInventoryItem;
  /** Called after any successful change so the parent can re-read the item and inventory list. */
  onChanged?: () => Promise<void> | void;
  disabled?: boolean;
};

type Mode = { kind: "closed" } | { kind: "record" } | { kind: "correct"; row: PilotCostVerification } | { kind: "revoke"; row: PilotCostVerification };

function newKey() {
  return `free-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function describeError(err: unknown, fallback: string) {
  if (err instanceof PilotApiError) {
    const detail = Object.values(err.errors ?? {}).filter((value) => typeof value === "string" && value !== "").join(" ");
    return detail ? `${err.message} ${detail}` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * "Verified free stock" (#279). Zero-cost stock is treated as unknown-cost and cannot be transferred at $0 until
 * someone records written evidence that it was genuinely free. Evidence is append-only: revoke or correct, never delete.
 */
export function VerifiedFreeEvidence({ item, onChanged, disabled = false }: Props) {
  const [rows, setRows] = useState<PilotCostVerification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [evidenceType, setEvidenceType] = useState<string>(COST_EVIDENCE_TYPES[0]);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per attempt; kept across retries of the same request so a retry can never record the evidence twice.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const itemRef = useRef(item.id);
  itemRef.current = item.id;

  const reload = useCallback(async () => {
    const itemId = item.id;
    try {
      const result = await fetchPilotCostVerifications(itemId);
      if (itemRef.current === itemId) {
        setRows(result.verifications);
        setLoadError(null);
      }
    } catch (err) {
      if (itemRef.current === itemId) setLoadError(describeError(err, "Could not load free-stock evidence."));
    }
  }, [item.id]);

  useEffect(() => {
    setRows(null);
    setMode({ kind: "closed" });
    setNotice(null);
    setError(null);
    void reload();
  }, [reload]);

  const onHand = Number(item.currentOnHand);
  const hasCost = Number(item.averageUnitCost ?? 0) > 0;
  const active = (rows ?? []).filter((row) => !row.revokedAt);
  const verifiedRemaining = active.reduce((sum, row) => sum + row.remainingQuantity, 0);
  const unverified = Math.max(0, onHand - verifiedRemaining);
  const canRecord = !hasCost && onHand > 0 && unverified > 0;

  // Nothing to show for priced stock that never had evidence, or when the list has not loaded and nothing is recorded.
  if (hasCost && (rows ?? []).length === 0) return null;
  if (!hasCost && onHand <= 0 && (rows ?? []).length === 0) return null;

  const open = (next: Mode) => {
    keyRef.current = null;
    setError(null);
    setNotice(null);
    setReason("");
    if (next.kind === "correct") {
      setEvidenceType(next.row.evidenceType);
      setQuantity(String(next.row.quantity));
      setNote(next.row.evidenceNote);
    } else if (next.kind === "record") {
      setEvidenceType(COST_EVIDENCE_TYPES[0]);
      setQuantity(String(unverified));
      setNote("");
    }
    setMode(next);
  };

  const submit = async () => {
    if (inFlight.current || mode.kind === "closed") return;
    const parsed = Number(quantity);
    if (mode.kind === "revoke") {
      if (!reason.trim()) return setError("Say why this evidence is being revoked.");
    } else {
      if (!Number.isFinite(parsed) || parsed <= 0) return setError("Enter a quantity greater than zero.");
      if (!note.trim()) return setError("Explain how you know this stock was free.");
      if (mode.kind === "correct" && !reason.trim()) return setError("Say why the evidence is being corrected.");
      if (mode.kind === "record" && parsed > unverified) return setError(`Only ${unverified} ${item.stockUnit} is not yet verified.`);
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    keyRef.current ??= newKey();
    try {
      if (mode.kind === "record") {
        await createPilotCostVerification(item.id, { evidenceType, evidenceNote: note.trim(), quantity: parsed, idempotencyKey: keyRef.current });
      } else if (mode.kind === "correct") {
        await correctPilotCostVerification(mode.row.id, { evidenceType, evidenceNote: note.trim(), quantity: parsed, reason: reason.trim(), idempotencyKey: keyRef.current });
      } else {
        await revokePilotCostVerification(mode.row.id, { reason: reason.trim() });
      }
      const done = mode.kind === "record" ? "Free stock recorded" : mode.kind === "correct" ? "Evidence corrected" : "Evidence revoked";
      keyRef.current = null;
      setMode({ kind: "closed" });
      setNotice(`${done}. The audit trail keeps every earlier entry.`);
      try {
        await Promise.all([reload(), onChanged?.()]);
      } catch {
        setNotice(`${done}. Reload the page to see the latest stock.`);
      }
    } catch (err) {
      // A 4xx means the server refused it, so the next try is a new decision; anything else keeps the key to replay safely.
      if (err instanceof PilotApiError && err.status >= 400 && err.status < 500) keyRef.current = null;
      setError(describeError(err, "Could not save. Check the list below, then try again."));
      void reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3 grid gap-3 border border-line p-4" data-testid="verified-free-panel">
      <div>
        <p className="text-sm font-semibold text-ink">Verified free stock</p>
        <p className="text-sm text-muted">
          {item.name} has no purchase cost, so its value is unknown, not free. Record written evidence for stock that was genuinely free so it can be transferred at $0.
        </p>
        <p className="mt-1 text-sm text-ink">
          On hand {onHand} {item.stockUnit} · verified free {verifiedRemaining} · unverified {unverified}
        </p>
      </div>
      {notice ? <p role="status" aria-live="polite" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</p> : null}
      {loadError ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {loadError} <button type="button" className="underline" onClick={() => void reload()}>Try again</button>
        </p>
      ) : null}
      {rows === null && !loadError ? <p className="text-sm text-muted" aria-live="polite">Loading evidence…</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="grid gap-2" aria-label="Free stock evidence">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-2xl border border-line p-3 text-sm">
              <p className="font-semibold text-ink">
                {row.quantity} {row.unit} · {TYPE_LABELS[row.evidenceType] ?? row.evidenceType}
                {row.revokedAt ? <span className="ml-2 text-xs font-semibold text-red-700">Revoked</span> : null}
                {row.correctionOfId ? <span className="ml-2 text-xs font-semibold text-muted">Corrects #{row.correctionOfId}</span> : null}
              </p>
              <p className="break-words text-muted">{row.evidenceNote}</p>
              <p className="text-xs text-muted">
                Moved at $0: {row.consumedQuantity} · remaining {row.remainingQuantity}
                {row.revokedReason ? ` · Revoked because: ${row.revokedReason}` : ""}
              </p>
              {!row.revokedAt ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" disabled={busy || disabled} onClick={() => open({ kind: "correct", row })}>Correct</Button>
                  {row.consumedQuantity === 0 ? <Button type="button" variant="secondary" disabled={busy || disabled} onClick={() => open({ kind: "revoke", row })}>Revoke</Button> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {mode.kind === "closed" ? (
        canRecord ? <div><Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => open({ kind: "record" })}>Record verified free stock</Button></div> : null
      ) : (
        <div className="grid gap-3" data-testid="verified-free-form">
          <p className="text-sm font-semibold text-ink">{mode.kind === "record" ? "Record verified free stock" : mode.kind === "correct" ? `Correct evidence #${mode.row.id}` : `Revoke evidence #${mode.row.id}`}</p>
          {mode.kind !== "revoke" ? (
            <>
              <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`free-type-${item.id}`}>
                How was it free?
                <select id={`free-type-${item.id}`} className="input" value={evidenceType} disabled={busy} onChange={(event) => setEvidenceType(event.target.value)}>
                  {COST_EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`free-qty-${item.id}`}>
                Quantity ({item.stockUnit})
                <input id={`free-qty-${item.id}`} className="input" inputMode="decimal" value={quantity} disabled={busy} onChange={(event) => setQuantity(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`free-note-${item.id}`}>
                Evidence note (required)
                <textarea id={`free-note-${item.id}`} className="input" rows={2} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Supplier added 2 cases free, noted on invoice #1042" />
              </label>
            </>
          ) : null}
          {mode.kind !== "record" ? (
            <label className="grid gap-1 text-sm font-semibold text-ink" htmlFor={`free-reason-${item.id}`}>
              Reason (required)
              <input id={`free-reason-${item.id}`} className="input" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : null}
          {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || disabled} onClick={() => void submit()}>{busy ? "Saving…" : mode.kind === "record" ? "Confirm free stock" : mode.kind === "correct" ? "Save correction" : "Confirm revoke"}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { keyRef.current = null; setError(null); setMode({ kind: "closed" }); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
