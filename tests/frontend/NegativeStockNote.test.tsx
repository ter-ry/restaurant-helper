import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NegativeStockNote, negativeStockByItem, negativeStockShortLabel } from "../../src/pilot/NegativeStockNote";
import type { PilotNegativeStockPosition } from "../../src/pilot/pilotApi";

const base: PilotNegativeStockPosition = {
  inventoryItemId: 31, inventoryItemName: "Beef", unit: "kg", onHand: -1.8, shortfall: 1.8, cause: "pos_sale", provider: "Square",
  posConsumedQuantity: 1.8, orderCount: 1, crossedZeroAt: null, lastPosSaleAt: null,
  explanation: "1 Square order used 1.8 kg before enough stock was received; on hand is -1.8 kg. Record the delivery or count the item to reconcile.",
};

describe("negative stock note", () => {
  it("shows the actual quantity and the POS provider that caused it", () => {
    expect(negativeStockShortLabel(base)).toBe("Below zero: -1.8 kg · Square sales ahead of receipt");
    expect(negativeStockShortLabel({ ...base, provider: "Clover", onHand: -0.08, unit: "kg" })).toBe("Below zero: -0.08 kg · Clover sales ahead of receipt");
  });

  it("never blames POS sales when the ledger does not show them", () => {
    const unverified = { ...base, cause: "unverified" as const, provider: null, onHand: -2 };
    expect(negativeStockShortLabel(unverified)).toBe("Below zero: -2 kg · not from POS sales");
  });

  it("renders the full ledger explanation by default and the short label in dense lists", () => {
    const { rerender } = render(<NegativeStockNote position={base} />);
    expect(screen.getByTestId("negative-stock-31")).toHaveTextContent(base.explanation);
    rerender(<NegativeStockNote position={base} short />);
    expect(screen.getByTestId("negative-stock-31")).toHaveTextContent("Below zero: -1.8 kg · Square sales ahead of receipt");
  });

  it("indexes positions by inventory item and tolerates a failed or empty fetch", () => {
    expect(negativeStockByItem([base]).get(31)).toBe(base);
    expect(negativeStockByItem(undefined).size).toBe(0);
  });
});
