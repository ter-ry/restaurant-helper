import { describe, expect, it, vi } from "vitest";
import { buildCsv, downloadCsvFile } from "../src/lib/reportExports";
import { buildExportCsv } from "../src/lib/demoReadiness";

describe("report exports", () => {
  it("builds csv rows with escaped values", () => {
    const csv = buildCsv([
      { section: "Purchase CSV", status: "Ready", detail: 'Needs "quotes", commas, and newlines\nfor review' },
      { section: "Audit trail", status: "No events", detail: "Empty" },
    ]);

    expect(csv).toContain("section,status,detail");
    expect(csv).toContain('"Needs ""quotes"", commas, and newlines');
    expect(csv.split("\n")).toHaveLength(3);
  });

  it("neutralizes formula-like text without changing numeric values", () => {
    expect(buildCsv([
      { formula: "=1+1", atFormula: "@SUM(A1:A2)", plusFormula: "+cmd|' /C calc'!A0", dashFormula: "-1+1", negativeAmount: "-10.00", zero: 0, numeric: 12.5 },
    ])).toBe([
      "formula,atFormula,plusFormula,dashFormula,negativeAmount,zero,numeric",
      "'=1+1,'@SUM(A1:A2),'+cmd|' /C calc'!A0,'-1+1,-10.00,0,12.5",
    ].join("\n"));
  });

  it("protects the export-readiness CSV path too", () => {
    expect(buildExportCsv([{ supplier: "=HYPERLINK(\"https://evil.example\")", amount: "-10.00" }])).toBe(
      'supplier,amount\n"\'=HYPERLINK(""https://evil.example"")",-10.00',
    );
  });

  it("creates a downloadable csv blob", () => {
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report-csv");
    const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      rel: "",
      click: clickSpy,
    } as unknown as HTMLAnchorElement);

    downloadCsvFile("report.csv", [{ section: "Purchase CSV", status: "Ready" }]);

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    createElementSpy.mockRestore();
  });
});
