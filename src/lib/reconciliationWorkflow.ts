import type { PilotReconciliationDraft, PilotReconciliationRecord, PilotReconciliationStatus } from "../types";

const BALANCED_TOLERANCE = 0.5;
const REVIEW_TOLERANCE = 10;

function nowIso() {
  return new Date().toISOString();
}

function clampMoney(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function toMillis(value: string | undefined) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function localDateString(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

export function createBlankReconciliationDraft(date = localDateString()): PilotReconciliationDraft {
  return {
    id: undefined,
    date,
    uberEats: 0,
    doorDash: 0,
    skip: 0,
    cash: 0,
    card: 0,
    other: 0,
    expectedPosSales: 0,
    expectedPosEntered: false,
    otherSourceName: "",
    refunds: 0,
    discounts: 0,
    tips: 0,
    fees: 0,
    manualAdjustment: 0,
    variance: 0,
    status: "Incomplete",
    notes: "",
    confirmed: false,
    savedAt: undefined,
    origin: "user",
  };
}

export function normalizeStoredReconciliationRecord(record: PilotReconciliationRecord): PilotReconciliationRecord {
  const createdAt = record.createdAt || record.updatedAt || `${record.date}T20:00:00.000Z`;
  const savedAt = record.savedAt || record.updatedAt || record.createdAt || createdAt;
  return {
    ...record,
    date: record.date,
    uberEats: clampMoney(record.uberEats),
    doorDash: clampMoney(record.doorDash),
    skip: clampMoney(record.skip),
    cash: clampMoney(record.cash),
    card: clampMoney(record.card),
    other: clampMoney(record.other),
    expectedPosSales: clampMoney(record.expectedPosSales),
    expectedPosEntered: record.expectedPosEntered ?? true,
    otherSourceName: record.otherSourceName?.trim() || "",
    refunds: clampMoney(record.refunds),
    discounts: clampMoney(record.discounts),
    tips: clampMoney(record.tips),
    fees: clampMoney(record.fees),
    manualAdjustment: clampMoney(record.manualAdjustment),
    variance: clampMoney(record.variance),
    status: record.status || "Needs Review",
    notes: record.notes?.trim() || "",
    confirmed: Boolean(record.confirmed),
    origin: record.origin || "user",
    createdAt,
    updatedAt: record.updatedAt || createdAt,
    savedAt,
  };
}

export function summarizeReconciliationDraft(draft: PilotReconciliationDraft) {
  const deliveryTotal = clampMoney(draft.uberEats + draft.doorDash + draft.skip);
  const otherPayments = clampMoney(draft.other);
  const positiveAdjustments = clampMoney(draft.tips + draft.manualAdjustment);
  const negativeAdjustments = clampMoney(draft.refunds + draft.discounts + draft.fees);
  const accountedTotal = clampMoney(
    draft.cash + draft.card + deliveryTotal + otherPayments + positiveAdjustments - negativeAdjustments,
  );
  const variance = clampMoney(accountedTotal - draft.expectedPosSales);
  const absVariance = Math.abs(variance);
  const hasBusinessDate = Boolean(draft.date.trim());
  const hasExpectedPos = draft.expectedPosEntered || draft.expectedPosSales !== 0;
  const hasAnyValue =
    draft.uberEats !== 0 ||
    draft.doorDash !== 0 ||
    draft.skip !== 0 ||
    draft.cash !== 0 ||
    draft.card !== 0 ||
    draft.other !== 0 ||
    draft.refunds !== 0 ||
    draft.discounts !== 0 ||
    draft.tips !== 0 ||
    draft.fees !== 0 ||
    draft.manualAdjustment !== 0;

  let status: PilotReconciliationStatus = "Incomplete";
  if (hasBusinessDate && hasExpectedPos) {
    if (absVariance <= BALANCED_TOLERANCE) {
      status = "Balanced";
    } else if (absVariance <= REVIEW_TOLERANCE) {
      status = "Small difference";
    } else {
      status = "Needs Review";
    }
  }

  const explanation =
    status === "Incomplete"
      ? "Enter the business date and POS total to begin reconciliation."
      : absVariance <= BALANCED_TOLERANCE
      ? "Balanced - all sales are accounted for."
        : variance > 0
          ? `${formatMoney(absVariance)} more was recorded than expected.`
          : `${formatMoney(absVariance)} is not yet accounted for.`;

  const breakdown = [
    { label: "Cash", value: clampMoney(draft.cash) },
    { label: "Card", value: clampMoney(draft.card) },
    { label: "Uber Eats", value: clampMoney(draft.uberEats) },
    { label: "DoorDash", value: clampMoney(draft.doorDash) },
    { label: "Skip", value: clampMoney(draft.skip) },
    { label: draft.otherSourceName?.trim() ? `Other: ${draft.otherSourceName.trim()}` : "Other payments", value: otherPayments },
    { label: "Tips", value: clampMoney(draft.tips) },
    { label: "Refunds", value: -clampMoney(draft.refunds) },
    { label: "Discounts", value: -clampMoney(draft.discounts) },
    { label: "Fees", value: -clampMoney(draft.fees) },
    { label: "Manual adjustment", value: clampMoney(draft.manualAdjustment) },
  ];

  const prompts = status === "Needs Review"
    ? [
        "Check cash count",
        "Check card settlement",
        "Confirm delivery-app totals",
        "Check refunds or discounts",
        "Add a note for unresolved differences",
      ]
    : status === "Small difference"
      ? [
          "Confirm rounding and missing minor items",
          "Check card settlement",
          "Confirm delivery-app totals",
        ]
      : [];

  return {
    accountedTotal,
    variance,
    absVariance,
    status,
    explanation,
    deliveryTotal,
    negativeAdjustments,
    positiveAdjustments,
    hasBusinessDate,
    hasExpectedPos,
    hasAnyValue,
    breakdown,
    prompts,
    balancedTolerance: BALANCED_TOLERANCE,
    reviewTolerance: REVIEW_TOLERANCE,
    requiresNote: absVariance > REVIEW_TOLERANCE,
  };
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

export function createDraftFromReconciliationRecord(record: PilotReconciliationRecord): PilotReconciliationDraft {
  return {
    id: record.id,
    date: record.date,
    uberEats: record.uberEats,
    doorDash: record.doorDash,
    skip: record.skip,
    cash: record.cash,
    card: record.card,
    other: record.other,
    expectedPosSales: record.expectedPosSales,
    expectedPosEntered: true,
    otherSourceName: record.otherSourceName || "",
    refunds: record.refunds || 0,
    discounts: record.discounts || 0,
    tips: record.tips || 0,
    fees: record.fees || 0,
    manualAdjustment: record.manualAdjustment || 0,
    variance: record.variance,
    status: record.status,
    notes: record.notes,
    confirmed: record.confirmed,
    savedAt: record.savedAt,
    origin: record.origin,
  };
}

export function buildReconciliationSaveConfirmation(record: Pick<PilotReconciliationRecord, "date" | "variance">) {
  return `${record.date} reconciliation saved successfully with ${formatMoney(Math.abs(record.variance))} variance.`;
}

export function deriveReconciliationRecord(existingRecords: PilotReconciliationRecord[], draft: PilotReconciliationDraft) {
  const now = nowIso();
  const existingById = draft.id ? existingRecords.find((record) => record.id === draft.id) : undefined;
  const existingByDate = existingRecords.find((record) => record.date === draft.date && record.id !== draft.id);
  const id = existingById?.id || existingByDate?.id || draft.id || `recon-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const createdAt = existingById?.createdAt || existingByDate?.createdAt || now;
  const summary = summarizeReconciliationDraft({ ...draft, expectedPosEntered: draft.expectedPosEntered ?? true });

  return {
    id,
    date: draft.date,
    uberEats: clampMoney(draft.uberEats),
    doorDash: clampMoney(draft.doorDash),
    skip: clampMoney(draft.skip),
    cash: clampMoney(draft.cash),
    card: clampMoney(draft.card),
    other: clampMoney(draft.other),
    expectedPosSales: clampMoney(draft.expectedPosSales),
    expectedPosEntered: draft.expectedPosEntered ?? true,
    otherSourceName: draft.otherSourceName?.trim() || "",
    refunds: clampMoney(draft.refunds),
    discounts: clampMoney(draft.discounts),
    tips: clampMoney(draft.tips),
    fees: clampMoney(draft.fees),
    manualAdjustment: clampMoney(draft.manualAdjustment),
    variance: summary.variance,
    status: summary.status,
    notes: draft.notes.trim(),
    confirmed: Boolean(draft.confirmed),
    origin: draft.origin || "user",
    createdAt,
    updatedAt: now,
    savedAt: now,
  } satisfies PilotReconciliationRecord;
}

export function sortReconciliationsNewestFirst(records: PilotReconciliationRecord[]) {
  return [...records].sort((a, b) => {
    const dateDelta = b.date.localeCompare(a.date);
    if (dateDelta !== 0) {
      return dateDelta;
    }

    const savedDelta = toMillis(b.savedAt) - toMillis(a.savedAt);
    if (savedDelta !== 0) {
      return savedDelta;
    }

    const updatedDelta = toMillis(b.updatedAt) - toMillis(a.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return toMillis(b.createdAt) - toMillis(a.createdAt);
  });
}

export function upsertReconciliationRecord(records: PilotReconciliationRecord[], record: PilotReconciliationRecord) {
  const index = records.findIndex((item) => item.id === record.id || item.date === record.date);
  if (index === -1) {
    return [record, ...records];
  }

  return [...records.slice(0, index), record, ...records.slice(index + 1)];
}

export function getRecentReconciliationPreview(records: PilotReconciliationRecord[], limit = 5) {
  const sorted = sortReconciliationsNewestFirst(records);
  return {
    visibleRecords: sorted.slice(0, limit),
    hasMore: sorted.length > limit,
    totalCount: sorted.length,
  };
}
