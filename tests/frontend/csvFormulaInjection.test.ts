import { describe, expect, it } from "vitest";
import { buildExportCsv } from "../../src/lib/demoReadiness";
import { buildReorderCsv } from "../../src/lib/inventoryOperations";
import { buildCsv } from "../../src/lib/reportExports";

describe("CSV spreadsheet formula injection protection", () => {
  it("escapes formula-like cells while preserving legitimate numbers", () => {
    expect(buildCsv([
      { formula: "=1+1", atFormula: "@SUM(A1:A2)", plusFormula: "+cmd", dashFormula: "-1+1", negativeAmount: "-10.00", zero: 0, numeric: 12.5 },
    ])).toBe([
      "formula,atFormula,plusFormula,dashFormula,negativeAmount,zero,numeric",
      "'=1+1,'@SUM(A1:A2),'+cmd,'-1+1,-10.00,0,12.5",
    ].join("\n"));
  });

  it("protects the readiness and reorder export helpers too", () => {
    expect(buildExportCsv([{ supplier: "=HYPERLINK(\"https://evil.example\")", amount: "-10.00" }])).toBe(
      'supplier,amount\n"\'=HYPERLINK(""https://evil.example"")",-10.00',
    );

    const csv = buildReorderCsv([{
      supplier: "=HYPERLINK(\"https://evil.example\")",
      itemName: "Coffee",
      currentQuantity: 1,
      unit: "bag",
      parLevel: 2,
      suggestedQuantity: 1,
      latestPurchasePrice: -10,
      estimatedCost: -10,
      notes: "-10.00",
    }]);
    expect(csv).toContain("'=HYPERLINK(\"\"https://evil.example\"\")");
    expect(csv).toContain(",-10.00,-10.00,-10.00");
  });
});
