// @ts-nocheck
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ReconciliationRecordModal } from "../src/components/ReconciliationRecordModal";
import {
  buildReconciliationSaveConfirmation,
  createBlankReconciliationDraft,
  createDraftFromReconciliationRecord,
  deriveReconciliationRecord,
  getRecentReconciliationPreview,
  normalizeStoredReconciliationRecord,
  sortReconciliationsNewestFirst,
  summarizeReconciliationDraft,
  upsertReconciliationRecord,
} from "../src/lib/reconciliationWorkflow";
import { PilotWorkspaceProvider } from "../src/lib/pilotWorkspace";
import { DailyReconciliationPage } from "../src/pages/DailyReconciliationPage";
import type { PilotReconciliationDraft, PilotReconciliationRecord } from "../src/types";

function createDraft(overrides: Partial<PilotReconciliationDraft> = {}): PilotReconciliationDraft {
  return {
    id: undefined,
    date: "2026-06-18",
    uberEats: 40,
    doorDash: 30,
    skip: 20,
    cash: 100,
    card: 50,
    other: 10,
    expectedPosSales: 240,
    expectedPosEntered: true,
    otherSourceName: "Gift card",
    refunds: 5,
    discounts: 10,
    tips: 2,
    fees: 3,
    manualAdjustment: 6,
    variance: 0,
    status: "Balanced",
    notes: "",
    confirmed: true,
    savedAt: undefined,
    origin: "user",
    ...overrides,
  };
}

function createRecord(overrides: Partial<PilotReconciliationRecord> = {}): PilotReconciliationRecord {
  const draft = createDraft(overrides);
  const existing = overrides.id
    ? [
        {
          ...draft,
          id: overrides.id,
          createdAt: overrides.createdAt ?? "2026-06-18T08:00:00.000Z",
          updatedAt: overrides.updatedAt ?? "2026-06-18T08:00:00.000Z",
          savedAt: overrides.savedAt ?? "2026-06-18T08:00:00.000Z",
        } satisfies PilotReconciliationRecord,
      ]
    : [];

  return deriveReconciliationRecord(existing, {
    ...draft,
    id: overrides.id,
    confirmed: overrides.confirmed ?? true,
    origin: overrides.origin ?? "user",
    savedAt: overrides.savedAt,
  });
}

function testEquationAndStatuses() {
  const balanced = summarizeReconciliationDraft(
    createDraft({
      expectedPosSales: 250,
      manualAdjustment: 16,
      variance: 0,
    }),
  );
  assert.equal(balanced.accountedTotal, 250);
  assert.equal(balanced.variance, 0);
  assert.equal(balanced.status, "Balanced");
  assert.ok(balanced.explanation.includes("Balanced"));

  const smallDifference = summarizeReconciliationDraft(
    createDraft({
      expectedPosSales: 243,
      manualAdjustment: 16,
    }),
  );
  assert.equal(smallDifference.variance, 7);
  assert.equal(smallDifference.status, "Small difference");
  assert.ok(smallDifference.prompts.length > 0);

  const needsReview = summarizeReconciliationDraft(
    createDraft({
      expectedPosSales: 215,
      manualAdjustment: 16,
    }),
  );
  assert.equal(needsReview.variance, 35);
  assert.equal(needsReview.status, "Needs Review");
  assert.equal(needsReview.requiresNote, true);
}

function testIncompleteAndEmptyState() {
  const blank = createBlankReconciliationDraft();
  const summary = summarizeReconciliationDraft(blank);
  assert.equal(summary.status, "Incomplete");
  assert.equal(summary.accountedTotal, 0);
  assert.equal(summary.variance, 0);
  assert.ok(summary.explanation.includes("Enter the business date and POS total"));
}

function testDuplicateDateUpdateAndPersistence() {
  const existing = [
    createRecord({
      id: "recon-1",
      date: "2026-06-17",
      expectedPosSales: 200,
      manualAdjustment: 0,
      notes: "Original note",
      savedAt: "2026-06-17T20:00:00.000Z",
      updatedAt: "2026-06-17T20:00:00.000Z",
      createdAt: "2026-06-17T20:00:00.000Z",
    }),
  ];

  const updated = deriveReconciliationRecord(existing, createDraft({ id: undefined, date: "2026-06-17", expectedPosSales: 234, manualAdjustment: 0, notes: "Updated note" }));
  assert.equal(updated.id, "recon-1");
  assert.equal(updated.expectedPosSales, 234);
  assert.equal(updated.notes, "Updated note");
  assert.equal(updated.variance, 0);

  const next = upsertReconciliationRecord(existing, updated);
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "recon-1");
  assert.equal(next[0].notes, "Updated note");
}

function testNewestFivePreview() {
  const records = [
    createRecord({ id: "a", date: "2026-06-13", savedAt: "2026-06-13T20:00:00.000Z", createdAt: "2026-06-13T20:00:00.000Z", updatedAt: "2026-06-13T20:00:00.000Z" }),
    createRecord({ id: "b", date: "2026-06-14", savedAt: "2026-06-14T20:00:00.000Z", createdAt: "2026-06-14T20:00:00.000Z", updatedAt: "2026-06-14T20:00:00.000Z" }),
    createRecord({ id: "c", date: "2026-06-15", savedAt: "2026-06-15T20:00:00.000Z", createdAt: "2026-06-15T20:00:00.000Z", updatedAt: "2026-06-15T20:00:00.000Z" }),
    createRecord({ id: "d", date: "2026-06-16", savedAt: "2026-06-16T20:00:00.000Z", createdAt: "2026-06-16T20:00:00.000Z", updatedAt: "2026-06-16T20:00:00.000Z" }),
    createRecord({ id: "e", date: "2026-06-17", savedAt: "2026-06-17T20:00:00.000Z", createdAt: "2026-06-17T20:00:00.000Z", updatedAt: "2026-06-17T20:00:00.000Z" }),
    createRecord({ id: "f", date: "2026-06-18", savedAt: "2026-06-18T20:00:00.000Z", createdAt: "2026-06-18T20:00:00.000Z", updatedAt: "2026-06-18T20:00:00.000Z" }),
  ];

  const sorted = sortReconciliationsNewestFirst(records);
  assert.equal(sorted[0].id, "f");
  assert.equal(sorted[1].id, "e");

  const preview = getRecentReconciliationPreview(records, 5);
  assert.equal(preview.visibleRecords.length, 5);
  assert.equal(preview.visibleRecords[0].id, "f");
  assert.equal(preview.hasMore, true);
  assert.equal(preview.totalCount, 6);
}

function testLegacyRecordNormalization() {
  const normalized = normalizeStoredReconciliationRecord({
    id: "legacy",
    date: "2026-06-11",
    uberEats: 1,
    doorDash: 2,
    skip: 3,
    cash: 4,
    card: 5,
    other: 6,
    expectedPosSales: 21,
    variance: 0,
    status: "Needs Review",
    notes: "  Needs a note  ",
    confirmed: false,
    otherSourceName: "  Delivery cash  ",
    refunds: 1,
    discounts: 2,
    tips: 3,
    fees: 4,
    manualAdjustment: 5,
    origin: "seed",
    createdAt: "2026-06-11T20:00:00.000Z",
    updatedAt: "2026-06-11T21:00:00.000Z",
  } as unknown as PilotReconciliationRecord);

  assert.equal(normalized.savedAt, "2026-06-11T21:00:00.000Z");
  assert.equal(normalized.otherSourceName, "Delivery cash");
  assert.equal(normalized.notes, "Needs a note");
  assert.equal(normalized.expectedPosEntered, true);
}

function testReopenModalAndSaveCopy() {
  const record = createRecord({
    id: "recon-modal",
    date: "2026-06-18",
    expectedPosSales: 250,
    manualAdjustment: 16,
    notes: "Reopened from history",
    savedAt: "2026-06-18T20:00:00.000Z",
    createdAt: "2026-06-18T20:00:00.000Z",
    updatedAt: "2026-06-18T20:00:00.000Z",
  });
  const draft = createDraftFromReconciliationRecord(record);
  assert.equal(draft.id, "recon-modal");
  assert.equal(draft.notes, "Reopened from history");
  assert.equal(draft.manualAdjustment, 16);

  const html = renderToStaticMarkup(
    createElement(ReconciliationRecordModal, {
      open: true,
      record,
      onClose: () => undefined,
      onEdit: () => undefined,
      onDelete: () => undefined,
    }),
  );
  assert.ok(html.includes("Saved reconciliation"));
  assert.ok(html.includes("Reopened from history"));
  assert.ok(html.includes("Original description") || html.includes("Breakdown"));

  const confirmation = buildReconciliationSaveConfirmation(record);
  assert.ok(confirmation.includes("reconciliation saved successfully"));
}

function testSaveConfirmationAndDeleteShape() {
  const record = createRecord({ id: "recon-delete", date: "2026-06-19", expectedPosSales: 240, manualAdjustment: 6, notes: "Manual review needed" });
  assert.equal(record.status, "Balanced");
  assert.equal(buildReconciliationSaveConfirmation(record), "2026-06-19 reconciliation saved successfully with $0.00 variance.");
}

function renderDailyReconciliationPage() {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/demo/cafe/daily-reconciliation"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/demo/:profile/daily-reconciliation",
          element: createElement(PilotWorkspaceProvider, null, createElement(DailyReconciliationPage, null)),
        }),
      ),
    ),
  );
}

function testDailyReconciliationLayout() {
  const html = renderDailyReconciliationPage();
  assert.ok(!html.includes("Report imports"));
  assert.ok(html.includes("Import report"));
  assert.ok(html.includes("Daily close"));
  assert.ok(html.includes("Payments received"));
  assert.ok(html.includes("Add adjustment"));
  assert.ok(html.includes("Restore sample data"));
  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Edit"));
  assert.ok(html.includes("Delete"));
  assert.ok(html.includes("Today at a glance"));
  assert.ok(/Today(?:&#x27;|')s status/.test(html));
  assert.ok(/Today(?:&#x27;|')s variance/.test(html));
  assert.ok(html.includes("Unresolved days"));
  assert.ok(html.includes("7-day unresolved exposure"));
  assert.ok(html.includes("xl:grid-cols-[minmax(0,2.75fr)_minmax(320px,1fr)]"));
  assert.ok(html.indexOf("Daily close") < html.indexOf("Live result"));
  assert.ok(html.indexOf("Live result") < html.indexOf("Recent reconciliation records"));
  assert.ok(!html.includes("Optional import helper"));
}

testEquationAndStatuses();
testIncompleteAndEmptyState();
testDuplicateDateUpdateAndPersistence();
testNewestFivePreview();
testLegacyRecordNormalization();
testReopenModalAndSaveCopy();
testSaveConfirmationAndDeleteShape();
testDailyReconciliationLayout();

console.log("reconciliation_workflow_ui.test.tsx passed");
