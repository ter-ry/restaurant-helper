import { describe, expect, it } from "vitest";
import { buildOcrPrintedEvidence, checkOcrLines } from "../../src/pilot/ocrReconciliation";
import type { PilotInvoiceOcrResponse } from "../../src/pilot/pilotApi";

const field = (value: string | number | null) => ({ value, confidence: 0.9, needsReview: false });

function response(fields: Partial<Record<"subtotal" | "tax" | "total", string | number | null>>, extra: Partial<PilotInvoiceOcrResponse> = {}): PilotInvoiceOcrResponse {
  return {
    provider: "mock", fileName: "a.pdf", contentType: "application/pdf", rawText: "",
    fields: {
      supplier: field("Cedar Meats"), invoiceDate: field("2026-11-10"), invoiceNumber: field("CM-1"),
      subtotal: field(fields.subtotal ?? null), tax: field(fields.tax ?? null), total: field(fields.total ?? null),
    },
    lineItems: [], warnings: [], overallConfidence: 0.8, needsReview: true, ...extra,
  };
}

describe("OCR reconciliation check", () => {
  it("flags a specific shortfall against the printed total with the exact difference", () => {
    const evidence = buildOcrPrintedEvidence(response({ total: 106.5, tax: 0 }));
    const check = checkOcrLines(evidence, [15]);
    expect(check.status).toBe("incomplete");
    expect(check.difference).toBe(91.5);
    expect(check.message).toBe("Extracted items total $15.00, but the invoice total is $106.50. Difference: $91.50. Review missing or incorrect items before receiving.");
  });

  it("compares with the printed subtotal when present and with total less tax otherwise", () => {
    expect(checkOcrLines(buildOcrPrintedEvidence(response({ subtotal: 100, tax: 13, total: 113 })), [100]).status).toBe("matched");
    const taxBasis = checkOcrLines(buildOcrPrintedEvidence(response({ tax: 13, total: 113 })), [60]);
    expect(taxBasis.status).toBe("incomplete");
    expect(taxBasis.expectedAmount).toBe(100);
    expect(taxBasis.message).toContain("the invoice total less tax is $100.00");
  });

  it("clears only when the lines themselves add up, within a cent", () => {
    const evidence = buildOcrPrintedEvidence(response({ subtotal: 106.5 }));
    expect(checkOcrLines(evidence, [15, 91.5]).status).toBe("matched");
    expect(checkOcrLines(evidence, [15, 91.49]).status).toBe("matched");
    expect(checkOcrLines(evidence, [15, 91.4]).status).toBe("incomplete");
  });

  it("warns when the items exceed the invoice instead of calling it missing items", () => {
    const check = checkOcrLines(buildOcrPrintedEvidence(response({ subtotal: 50 })), [80]);
    expect(check.status).toBe("incomplete");
    expect(check.message).toContain("Difference: $30.00");
    expect(check.message).toContain("duplicated or misread");
  });

  it("never treats unreadable totals as verified", () => {
    const evidence = buildOcrPrintedEvidence(response({}));
    const check = checkOcrLines(evidence, [15]);
    expect(check.status).toBe("unverified");
    expect(check.expectedAmount).toBeNull();
    expect(check.difference).toBeNull();
  });

  it("keeps backend warnings and the backend message, ignoring blanks", () => {
    const evidence = buildOcrPrintedEvidence(response({ total: 10 }, { warnings: ["Two rows could not be read.", " "], reconciliation: { status: "incomplete", message: "Two rows could not be read." } }));
    expect(evidence.warnings).toEqual(["Two rows could not be read."]);
    expect(evidence.serverMessage).toBe("Two rows could not be read.");
  });
});
