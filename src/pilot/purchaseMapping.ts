// Suggestion helper for unmapped invoice lines. It never maps anything by itself:
// the owner must click to accept a suggestion (exact-name auto-mapping lives elsewhere).

const STOP_WORDS = new Set(["the", "and", "of", "pack", "case", "box", "each", "ea", "fresh", "extra"]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !/^\d+(\.\d+)?$/.test(token));
}

/**
 * Returns the single inventory item whose name best overlaps the invoice description,
 * or null when nothing overlaps or two items tie (ambiguous: do not guess).
 */
export function suggestInventoryItem<T extends { id: number; name: string }>(description: string, items: T[]): T | null {
  const wanted = new Set(tokens(description));
  if (wanted.size === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const item of items) {
    const itemTokens = new Set(tokens(item.name));
    if (itemTokens.size === 0) continue;
    let shared = 0;
    itemTokens.forEach((token) => { if (wanted.has(token)) shared += 1; });
    if (shared === 0) continue;
    // Every word of the inventory name should appear on the invoice line, so "Milk" suggests for "Whole Milk 2L".
    if (shared < itemTokens.size) continue;
    const score = shared / Math.max(wanted.size, itemTokens.size);
    if (score > bestScore) { best = item; bestScore = score; tie = false; }
    else if (score === bestScore) tie = true;
  }
  return tie ? null : best;
}

export type LineBlockerInput = { inventoryItemId: number | null; quantity: number; conversionFactor: number; unitPrice: number; lineTotal: number };

/** Per-line reasons a line cannot be received yet (empty = ready). */
export function lineBlockers(line: LineBlockerInput): string[] {
  const reasons: string[] = [];
  if (!line.inventoryItemId) reasons.push("Choose or create the inventory item this line adds to.");
  if (!(line.quantity > 0)) reasons.push("Enter a quantity greater than 0.");
  if (!(line.conversionFactor > 0)) reasons.push("Enter a valid conversion to inventory units.");
  const calculated = Math.round((line.quantity || 0) * (line.unitPrice || 0) * 100) / 100;
  if (Math.abs(calculated - Math.round((line.lineTotal || 0) * 100) / 100) > 0.01) {
    reasons.push(`Quantity × unit price is ${calculated.toFixed(2)} but the line total is ${(line.lineTotal || 0).toFixed(2)}.`);
  }
  return reasons;
}
