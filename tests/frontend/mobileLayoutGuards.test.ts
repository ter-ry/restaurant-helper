import reorderSource from "../../src/pilot/PilotReorderPlanPage.tsx?raw";
import { describe, expect, it } from "vitest";

// jsdom has no layout engine; this guards the markup rule behind the #170 mobile overflow fix.
// (The `.workspace-table-wrap { position: relative }` rule in styles.css was verified in Chromium at 390px.)
describe("mobile layout guards", () => {
  it("keeps the reorder plan grid single-column (minmax(0,1fr)) below xl so wide tables cannot widen the page", () => {
    expect(reorderSource).toMatch(/grid grid-cols-1 gap-6 xl:grid-cols-\[1\.18fr_0\.82fr\]/);
  });
});
