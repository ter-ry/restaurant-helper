import { describe, expect, it } from "vitest";
import { formatAuditEventType, formatAuditMetadataKey } from "../../src/lib/auditLabels";

describe("audit labels", () => {
  it("humanizes dotted event types", () => {
    expect(formatAuditEventType("purchases.invoice_received")).toBe("Purchases: invoice received");
    expect(formatAuditEventType("menu_costing.recipe_ingredient_updated")).toBe("Menu costing: recipe ingredient updated");
    expect(formatAuditEventType("auth.login.success")).toBe("Signed in");
    expect(formatAuditEventType("purchases.ocr_discrepancy_override")).toContain("overridden");
  });
  it("handles unknown and single-word events", () => {
    expect(formatAuditEventType("widget.thing_done")).toBe("Widget: thing done");
    expect(formatAuditEventType("ping")).toBe("Ping");
  });
  it("humanizes metadata keys", () => {
    expect(formatAuditMetadataKey("invoice_id")).toBe("Invoice id");
    expect(formatAuditMetadataKey("supplierName")).toBe("Supplier name");
  });
});

import { dataImportScopeLabel } from "../../src/lib/dataImports";

describe("import scope labels", () => {
  it("shows owner-friendly names", () => {
    expect(dataImportScopeLabel("supplier")).toBe("Suppliers");
    expect(dataImportScopeLabel("opening_inventory")).toBe("Opening inventory");
    expect(dataImportScopeLabel("new_thing")).toBe("New thing");
  });
});
