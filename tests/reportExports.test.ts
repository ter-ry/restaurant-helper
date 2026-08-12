import { describe, expect, it, vi } from "vitest";
import { buildCsv, downloadCsvFile } from "../src/lib/reportExports";

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
