import type { PilotNegativeStockPosition } from "./pilotApi";

export function negativeStockByItem(items: PilotNegativeStockPosition[] | null | undefined) {
  return new Map((items ?? []).map((position) => [position.inventoryItemId, position]));
}

function quantity(value: number) {
  return Number(value.toFixed(4)).toString();
}

/** One short line for dense lists: the actual quantity and what caused it. */
export function negativeStockShortLabel(position: PilotNegativeStockPosition) {
  const cause = position.cause === "pos_sale" && position.provider ? `${position.provider} sales ahead of receipt` : "not from POS sales";
  const review = position.reviewOrderCount > 0 ? " · order under review" : "";
  return `Below zero: ${quantity(position.onHand)} ${position.unit} · ${cause}${review}`;
}

/** The full evidence sentence from the ledger (quantities, order count, what to do). */
export function NegativeStockNote({ position, short = false }: { position: PilotNegativeStockPosition; short?: boolean }) {
  return (
    <p className="negative-stock-note mt-1 text-xs leading-5 text-amber-800" data-testid={`negative-stock-${position.inventoryItemId}`}>
      {short ? negativeStockShortLabel(position) : position.explanation}
    </p>
  );
}
