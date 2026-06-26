import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { buildDemoPath, useDemoProfile } from "../lib/demoProfile";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { InventoryItem, PilotPriceChangeRecord } from "../types";
import type { DemoProfileSlug } from "../data/demoProfiles";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

type RecipeStatus = "Complete" | "Draft" | "Needs review";
type MappingStatus = "Mapped" | "Demo only" | "Missing";
type MarginTone = "success" | "warning" | "danger" | "info";

type MenuIngredient = {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  inventoryMatch?: string;
  purchaseYield?: number;
  fallbackUnitCost: number;
  note?: string;
};

type MenuItemDraft = {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  recipeStatus: RecipeStatus;
  mappingStatus: MappingStatus;
  squarePosItem: string;
  packagingCost: number;
  ingredients: MenuIngredient[];
};

type ResolvedIngredient = MenuIngredient & {
  inventoryItem?: InventoryItem;
  sourceLabel: string;
  currentUnitCost: number;
  lineCost: number;
  recentPriceChange?: PilotPriceChangeRecord;
  sourceDate?: string;
};

type ResolvedMenuItem = MenuItemDraft & {
  ingredients: ResolvedIngredient[];
  estimatedIngredientCost: number;
  estimatedTotalCost: number;
  estimatedGrossProfit: number;
  estimatedMargin: number;
  riskReasons: string[];
  dataIssues: string[];
  marginTone: MarginTone;
};

type ActiveMenuPanel = null | { kind: "detail"; itemId: string } | { kind: "risks" };

const editableFieldClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand-300 focus:ring-2 focus:ring-brand-100";

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:x|hrs?|hours?|hr|h)\b/g, " ")
    .replace(/\b(?:qty|quantity|case|cs|pack|pkg|box|bottle|bag|roll|cup|cups|straw|straws)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cloneIngredient(ingredient: MenuIngredient): MenuIngredient {
  return { ...ingredient };
}

function cloneItem(item: MenuItemDraft): MenuItemDraft {
  return {
    ...item,
    ingredients: item.ingredients.map(cloneIngredient),
  };
}

function seedIngredient(label: string, quantity: number, unit: string, fallbackUnitCost: number, inventoryMatch?: string, purchaseYield?: number, note?: string): MenuIngredient {
  return {
    id: `${normalizeKey(label)}-${Math.random().toString(16).slice(2, 8)}`,
    label,
    quantity,
    unit,
    inventoryMatch,
    purchaseYield,
    fallbackUnitCost,
    note,
  };
}

const seedMenuItems: MenuItemDraft[] = [
  {
    id: "classic-milk-tea",
    name: "Classic Milk Tea",
    category: "Signature drinks",
    sellingPrice: 7.95,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Classic Milk Tea - 20 oz",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Black tea leaves", 6, "g", 0.04, "Black tea leaves 1kg", 1000, "Recent purchase price"),
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Brown sugar syrup", 30, "ml", 0.008, "Brown sugar syrup 5L", 5000, "Recent purchase price"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "brown-sugar-boba",
    name: "Brown Sugar Boba",
    category: "Signature drinks",
    sellingPrice: 8.45,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Brown Sugar Boba - 20 oz",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Tapioca pearls", 80, "g", 0.02, "Tapioca pearls 3kg bag", 3000, "Recent purchase price"),
      seedIngredient("Brown sugar syrup", 35, "ml", 0.008, "Brown sugar syrup 5L", 5000, "Recent purchase price"),
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "taro-milk-tea",
    name: "Taro Milk Tea",
    category: "Signature drinks",
    sellingPrice: 8.95,
    recipeStatus: "Needs review",
    mappingStatus: "Demo only",
    squarePosItem: "Taro Milk Tea - future Square item",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Tapioca pearls", 80, "g", 0.02, "Tapioca pearls 3kg bag", 3000, "Recent purchase price"),
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Taro powder", 35, "g", 0.12, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "oat-latte",
    name: "Iced Oat Latte",
    category: "Espresso / iced drinks",
    sellingPrice: 5.95,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Iced Oat Latte - 12 oz",
    packagingCost: 0.09,
    ingredients: [
      seedIngredient("Oat milk", 300, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Espresso blend", 16, "g", 0.08, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
    ],
  },
  {
    id: "black-tea",
    name: "Fresh Black Tea",
    category: "Tea",
    sellingPrice: 3.75,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Fresh Black Tea - 16 oz",
    packagingCost: 0.08,
    ingredients: [
      seedIngredient("Black tea leaves", 6, "g", 0.04, "Black tea leaves 1kg", 1000, "Recent purchase price"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "citrus-green-tea",
    name: "Lemon Green Tea",
    category: "Tea",
    sellingPrice: 6.95,
    recipeStatus: "Complete",
    mappingStatus: "Demo only",
    squarePosItem: "Lemon Green Tea - future Square item",
    packagingCost: 0.09,
    ingredients: [
      seedIngredient("Green tea leaves", 6, "g", 0.05, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Lemon syrup", 35, "ml", 0.04, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "matcha-cloud-latte",
    name: "Strawberry Matcha",
    category: "Signature drinks",
    sellingPrice: 8.95,
    recipeStatus: "Needs review",
    mappingStatus: "Missing",
    squarePosItem: "Strawberry Matcha - not mapped",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Matcha powder", 25, "g", 0.18, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Strawberry puree", 20, "g", 0.08, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "seasonal-strawberry-matcha",
    name: "Breakfast Sandwich",
    category: "Food / bakery",
    sellingPrice: 7.85,
    recipeStatus: "Draft",
    mappingStatus: "Missing",
    squarePosItem: "Breakfast Sandwich - draft Square item",
    packagingCost: 0.08,
    ingredients: [
      seedIngredient("Breakfast sandwich bun", 1, "each", 0.18, "Breakfast Sandwich Buns", 1, "Draft item"),
      seedIngredient("Egg", 2, "each", 0.15, undefined, undefined, "Draft item"),
      seedIngredient("Cheese slice", 1, "each", 0.12, undefined, undefined, "Draft item"),
      seedIngredient("Butter", 8, "g", 0.03, undefined, undefined, "Draft item"),
    ],
  },
];

function findInventoryMatch(item: MenuIngredient, inventoryItems: InventoryItem[]) {
  const searchTerms = [item.inventoryMatch, item.label].filter(Boolean).map((value) => normalizeKey(String(value)));
  if (searchTerms.length === 0) {
    return null;
  }

  return inventoryItems.find((inventoryItem) => {
    const keys = [inventoryItem.itemMatchKey, inventoryItem.normalizedName, inventoryItem.name].map(normalizeKey);
    return searchTerms.some((searchTerm) => keys.some((key) => key === searchTerm || key.includes(searchTerm) || searchTerm.includes(key)));
  }) ?? null;
}

function findPriceChangeForItem(item: MenuIngredient, inventoryItem: InventoryItem | undefined, priceChanges: PilotPriceChangeRecord[]) {
  const searchTerms = [item.inventoryMatch, inventoryItem?.name, inventoryItem?.preferredSupplier, item.label]
    .filter(Boolean)
    .map((value) => normalizeKey(String(value)));

  return (
    priceChanges.find((change) => {
      const keys = [change.itemName, change.supplier, change.category].map(normalizeKey);
      return searchTerms.some((searchTerm) => keys.some((key) => key === searchTerm || key.includes(searchTerm) || searchTerm.includes(key)));
    }) ?? null
  );
}

function resolveIngredient(item: MenuIngredient, inventoryItems: InventoryItem[], priceChanges: PilotPriceChangeRecord[]): ResolvedIngredient {
  const inventoryItem = findInventoryMatch(item, inventoryItems);
  const priceChange = findPriceChangeForItem(item, inventoryItem ?? undefined, priceChanges);

  const currentUnitCost =
    inventoryItem && item.purchaseYield && item.purchaseYield > 0
      ? inventoryItem.latestPurchasePrice / item.purchaseYield
      : item.fallbackUnitCost;

  const lineCost = Number((item.quantity * currentUnitCost).toFixed(2));
  let sourceLabel = "Fallback demo cost";
  if (inventoryItem && item.purchaseYield && item.purchaseYield > 0) {
    sourceLabel = priceChange && priceChange.changePercent > 0 ? "Supplier price change" : "Recent purchase price";
  } else if (inventoryItem) {
    sourceLabel = "Inventory item cost";
  }

  return {
    ...item,
    inventoryItem: inventoryItem ?? undefined,
    sourceLabel,
    currentUnitCost,
    lineCost,
    recentPriceChange: priceChange ?? undefined,
    sourceDate: priceChange?.invoiceDate || inventoryItem?.lastReceivedAt,
  };
}

function resolveMenuItem(item: MenuItemDraft, inventoryItems: InventoryItem[], priceChanges: PilotPriceChangeRecord[]): ResolvedMenuItem {
  const ingredients = item.ingredients.map((ingredient) => resolveIngredient(ingredient, inventoryItems, priceChanges));
  const ingredientCost = ingredients.reduce((sum, ingredient) => sum + ingredient.lineCost, 0);
  const totalCost = Number((ingredientCost + item.packagingCost).toFixed(2));
  const grossProfit = Number((item.sellingPrice - totalCost).toFixed(2));
  const margin = item.sellingPrice > 0 ? Number(((grossProfit / item.sellingPrice) * 100).toFixed(1)) : 0;

  const riskReasons: string[] = [];
  if (margin < 50) {
    riskReasons.push("Thin margin");
  }

  const dataIssues: string[] = [];
  if (item.recipeStatus !== "Complete") {
    dataIssues.push("Recipe incomplete");
  }
  if (item.mappingStatus !== "Mapped") {
    dataIssues.push("POS mapping missing");
  }
  if (ingredients.some((ingredient) => !ingredient.inventoryItem)) {
    dataIssues.push("Demo cost in recipe");
  }
  if (ingredients.some((ingredient) => ingredient.recentPriceChange && ingredient.recentPriceChange.changePercent > 5)) {
    dataIssues.push("Ingredient price increased");
  }

  let marginTone: MarginTone = "success";
  if (riskReasons.length > 0) {
    marginTone = "danger";
  } else if (dataIssues.length > 0) {
    marginTone = "warning";
  }

  return {
    ...item,
    ingredients,
    estimatedIngredientCost: Number(ingredientCost.toFixed(2)),
    estimatedTotalCost: totalCost,
    estimatedGrossProfit: grossProfit,
    estimatedMargin: margin,
    riskReasons,
    dataIssues,
    marginTone,
  };
}

function marginStatusLabel(margin: number) {
  if (margin < 45) {
    return "Margin risk";
  }
  if (margin < 55) {
    return "Watch";
  }
  return "Healthy";
}

function toneForMargin(margin: number): MarginTone {
  if (margin < 45) {
    return "danger";
  }
  if (margin < 55) {
    return "warning";
  }
  return "success";
}

function toneForRisk(reasonCount: number): MarginTone {
  if (reasonCount >= 3) {
    return "danger";
  }
  if (reasonCount > 0) {
    return "warning";
  }
  return "success";
}

function createBlankIngredient(index: number): MenuIngredient {
  return {
    id: `blank-ingredient-${Date.now()}-${index}`,
    label: "New ingredient",
    quantity: 1,
    unit: "each",
    fallbackUnitCost: 0,
    note: "Draft ingredient",
  };
}

export function MenuCostingPage() {
  const demo = useDemoProfile();
  const { inventoryItems, priceChanges } = usePilotWorkspace();
  const profileSlug = demo.slug as DemoProfileSlug;
  const purchasesRoute = buildDemoPath(profileSlug, "purchases");
  const inventoryRoute = buildDemoPath(profileSlug, "inventory");

  const [menuItems, setMenuItems] = useState<MenuItemDraft[]>(() => seedMenuItems.map(cloneItem));
  const [selectedMenuItemId, setSelectedMenuItemId] = useState(seedMenuItems[0].id);
  const [activePanel, setActivePanel] = useState<ActiveMenuPanel>(null);

  const resolvedMenuItems: ResolvedMenuItem[] = useMemo(
    () => menuItems.map((item) => resolveMenuItem(item, inventoryItems, priceChanges)),
    [inventoryItems, menuItems, priceChanges],
  );

  const selectedResolvedMenuItem: ResolvedMenuItem | undefined = resolvedMenuItems.find((item) => item.id === selectedMenuItemId) ?? resolvedMenuItems[0];

  const allItems = useMemo(() => [...resolvedMenuItems].sort((a, b) => {
    if (a.id === "seasonal-strawberry-matcha") {
      return -1;
    }
    if (b.id === "seasonal-strawberry-matcha") {
      return 1;
    }
    return b.estimatedMargin - a.estimatedMargin;
  }), [resolvedMenuItems]);

  const metrics = useMemo(() => {
    const recipeComplete = resolvedMenuItems.filter((item) => item.recipeStatus === "Complete").length;
    const averageMargin =
      resolvedMenuItems.length > 0
        ? resolvedMenuItems.reduce((sum, item) => sum + item.estimatedMargin, 0) / resolvedMenuItems.length
        : 0;
    const riskItems = resolvedMenuItems.filter((item) => item.riskReasons.length > 0).length;
    const dataIssueItems = resolvedMenuItems.filter((item) => item.dataIssues.length > 0).length;
    const squareReady = resolvedMenuItems.filter((item) => item.recipeStatus === "Complete" && item.mappingStatus === "Mapped").length;
    return {
      menuItems: resolvedMenuItems.length,
      recipeComplete,
      averageMargin: Number(averageMargin.toFixed(1)),
      riskItems,
      dataIssueItems,
      squareReady,
    };
  }, [resolvedMenuItems]);

  const selectedDraft = menuItems.find((item) => item.id === selectedMenuItemId) ?? menuItems[0];

  const selectedIngredients: ResolvedIngredient[] = selectedResolvedMenuItem?.ingredients ?? [];
  const costSourceRows: ResolvedIngredient[] = selectedIngredients;
  const marginRiskItems = useMemo(
    () =>
      [...resolvedMenuItems]
        .filter((item) => item.riskReasons.length > 0)
        .sort((a, b) => b.riskReasons.length - a.riskReasons.length || a.estimatedMargin - b.estimatedMargin)
        .slice(0, 4),
    [resolvedMenuItems],
  );

  const updateItemField = (id: string, patch: Partial<MenuItemDraft>) => {
    setMenuItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const updateIngredientField = (itemId: string, ingredientId: string, patch: Partial<MenuIngredient>) => {
    setMenuItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        return {
          ...item,
          ingredients: item.ingredients.map((ingredient) => (ingredient.id === ingredientId ? { ...ingredient, ...patch } : ingredient)),
        };
      }),
    );
  };

  const addIngredient = (itemId: string) => {
    setMenuItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          ingredients: [...item.ingredients, createBlankIngredient(item.ingredients.length + 1)],
        };
      }),
    );
  };

  const removeIngredient = (itemId: string, ingredientId: string) => {
    setMenuItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        return {
          ...item,
          ingredients: item.ingredients.filter((ingredient) => ingredient.id !== ingredientId),
        };
      }),
    );
  };

  const createMenuItem = () => {
    const draftId = "seasonal-strawberry-matcha";
    setSelectedMenuItemId(draftId);
    setActivePanel({ kind: "detail", itemId: draftId });
  };

  const reviewMarginRisks = () => {
    const targetId = marginRiskItems[0]?.id ?? selectedMenuItemId;
    setSelectedMenuItemId(targetId);
    setActivePanel({ kind: "risks" });
  };

  const mapPosItem = () => {
    const missingMapping = resolvedMenuItems.find((item) => item.mappingStatus !== "Mapped");
    if (missingMapping) {
      setSelectedMenuItemId(missingMapping.id);
      setActivePanel({ kind: "detail", itemId: missingMapping.id });
    }
  };

  const openMenuItemDetail = (itemId: string) => {
    setSelectedMenuItemId(itemId);
    setActivePanel({ kind: "detail", itemId });
  };

  const detailMenuItem = activePanel?.kind === "detail" ? resolvedMenuItems.find((item) => item.id === activePanel.itemId) ?? selectedResolvedMenuItem : null;

  return (
    <PageLayout
      title="Menu & Costing"
      eyebrow="Back Office Core / Demo-real workspace"
      description="Recipes, item cost, margin."
    >
      <div className="grid gap-6">
        <Card className="surface-panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">Menu & Costing</p>
              <h1 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">Recipes, item cost, margin.</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={createMenuItem}>
                Build recipe
              </Button>
              <Button type="button" variant="secondary" onClick={reviewMarginRisks}>
                Review margin risks
              </Button>
              <Button type="button" variant="secondary" onClick={mapPosItem}>
                POS mapping demo
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="info">Costed items {metrics.menuItems}</Badge>
            <button type="button" className="inline-flex" onClick={reviewMarginRisks} aria-label="Open margin risks">
              <Badge tone={metrics.riskItems > 0 ? "warning" : "success"}>Margin risks {metrics.riskItems}</Badge>
            </button>
            <Badge tone={metrics.dataIssueItems > 0 ? "warning" : "neutral"}>Data gaps {metrics.dataIssueItems}</Badge>
            <Badge tone={metrics.squareReady > 0 ? "success" : "neutral"}>Square-ready demo {metrics.squareReady}</Badge>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Menu item list" action={<Badge tone="neutral">{resolvedMenuItems.length} demo items</Badge>} />
          <div className="mt-4 space-y-2">
            {allItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openMenuItemDetail(item.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  item.id === selectedMenuItemId ? "border-brand-300 bg-brand-50 shadow-soft" : "border-line bg-white hover:border-brand-100 hover:bg-slate-50"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-ink">{item.name}</h3>
                      <Badge tone={toneForMargin(item.estimatedMargin)}>{formatPercent(item.estimatedMargin)} margin</Badge>
                      <Badge tone={item.recipeStatus === "Complete" ? "success" : "warning"}>{item.recipeStatus}</Badge>
                      <Badge tone={item.mappingStatus === "Mapped" ? "success" : "warning"}>{item.mappingStatus}</Badge>
                      {item.riskReasons.length > 0 ? <Badge tone="danger">Margin risk</Badge> : null}
                      {item.dataIssues.length > 0 ? <Badge tone="warning">Needs data</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-ink">{formatCurrency(item.sellingPrice)}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">selling</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                  <span>Ingredient cost {formatCurrency(item.estimatedIngredientCost)}</span>
                  <span>Gross profit {formatCurrency(item.estimatedGrossProfit)}</span>
                  <span>Open recipe</span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Margin risks" action={<Button type="button" variant="secondary" onClick={() => setActivePanel({ kind: "risks" })}>View all risks</Button>} />
          {marginRiskItems.length > 0 ? (
            <div className="mt-4 space-y-2">
              {marginRiskItems.slice(0, 3).map((item) => (
                <button
                  key={`risk-preview-${item.id}`}
                  type="button"
                  onClick={() => openMenuItemDetail(item.id)}
                  className="w-full rounded-xl border border-line bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{item.name}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {item.category} | {formatPercent(item.estimatedMargin)} margin | {formatCurrency(item.sellingPrice)}
                      </p>
                    </div>
                  {item.riskReasons.length > 0 ? <Badge tone={toneForRisk(item.riskReasons.length)}>Margin risk</Badge> : null}
                  {item.dataIssues.length > 0 ? <Badge tone="warning">Needs data</Badge> : null}
                </div>
              </button>
            ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
              No margin-risk items yet. Add a draft item or increase an ingredient cost to surface a warning.
            </div>
          )}
        </Card>
      </div>

      {detailMenuItem ? (
        <MenuDrawerShell
          title={detailMenuItem.name}
          description={`${detailMenuItem.category} | ${formatPercent(detailMenuItem.estimatedMargin)} margin`}
          onClose={() => setActivePanel(null)}
          wide
        >
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <div className="space-y-5">
              <Card className="p-5">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={detailMenuItem.marginTone}>{formatPercent(detailMenuItem.estimatedMargin)} margin</Badge>
                  <Badge tone={detailMenuItem.estimatedMargin < 50 ? "danger" : "success"}>{detailMenuItem.estimatedMargin < 50 ? "Margin pressure" : "Healthy margin"}</Badge>
                  <Badge tone={detailMenuItem.mappingStatus === "Mapped" ? "success" : "warning"}>
                    {detailMenuItem.mappingStatus === "Mapped" ? "Square-ready demo" : "Future Square connection"}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Menu item name</span>
                    <input className={editableFieldClass} value={selectedDraft.name} onChange={(event) => updateItemField(selectedDraft.id, { name: event.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Category</span>
                    <input className={editableFieldClass} value={selectedDraft.category} onChange={(event) => updateItemField(selectedDraft.id, { category: event.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Selling price</span>
                    <input type="number" step="0.01" className={editableFieldClass} value={selectedDraft.sellingPrice} onChange={(event) => updateItemField(selectedDraft.id, { sellingPrice: Number(event.target.value || 0) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Square POS item</span>
                    <input className={editableFieldClass} value={selectedDraft.squarePosItem} onChange={(event) => updateItemField(selectedDraft.id, { squarePosItem: event.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Recipe status</span>
                    <select className={editableFieldClass} value={selectedDraft.recipeStatus} onChange={(event) => updateItemField(selectedDraft.id, { recipeStatus: event.target.value as RecipeStatus })}>
                      <option value="Complete">Complete</option>
                      <option value="Needs review">Needs review</option>
                      <option value="Draft">Draft</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">POS mapping</span>
                    <select className={editableFieldClass} value={selectedDraft.mappingStatus} onChange={(event) => updateItemField(selectedDraft.id, { mappingStatus: event.target.value as MappingStatus })}>
                      <option value="Mapped">Mapped</option>
                      <option value="Demo only">Demo only</option>
                      <option value="Missing">Missing</option>
                    </select>
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => addIngredient(selectedDraft.id)}>
                    Add ingredient
                  </Button>
                  <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={purchasesRoute}>
                    Open Purchases
                  </Link>
                  <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={inventoryRoute}>
                    Open Inventory
                  </Link>
                </div>
              </Card>

              <Card className="p-5">
                <SectionHeader title="Recipe builder" />
                <div className="mt-4 space-y-3">
                  {selectedIngredients.map((ingredient) => (
                    <div key={ingredient.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-ink">{ingredient.label}</p>
                            <Badge tone={ingredient.inventoryItem ? "success" : "warning"}>{ingredient.inventoryItem ? "Inventory-backed" : "Demo cost"}</Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
                            {ingredient.inventoryItem ? ingredient.inventoryItem.preferredSupplier : "No inventory match yet"}
                          </p>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => removeIngredient(selectedDraft.id, ingredient.id)}>
                          Remove
                        </Button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="space-y-1">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Quantity per sale</span>
                          <input
                            type="number"
                            step="0.1"
                            className={editableFieldClass}
                            value={ingredient.quantity}
                            onChange={(event) => updateIngredientField(selectedDraft.id, ingredient.id, { quantity: Number(event.target.value || 0) })}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Unit</span>
                          <input className={editableFieldClass} value={ingredient.unit} onChange={(event) => updateIngredientField(selectedDraft.id, ingredient.id, { unit: event.target.value })} />
                        </label>
                        <div className="rounded-xl border border-line bg-white p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Current unit cost</p>
                          <p className="mt-2 text-base font-bold text-ink">{formatCurrency(ingredient.currentUnitCost)}</p>
                        </div>
                        <div className="rounded-xl border border-line bg-white p-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Line cost</p>
                          <p className="mt-2 text-base font-bold text-ink">{formatCurrency(ingredient.lineCost)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="p-5">
                <SectionHeader title="Cost summary" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <SummaryChip label="Ingredient cost" value={formatCurrency(detailMenuItem.estimatedIngredientCost)} />
                  <SummaryChip label="Packaging cost" value={formatCurrency(selectedDraft.packagingCost)} />
                  <SummaryChip label="Total cost" value={formatCurrency(detailMenuItem.estimatedTotalCost)} />
                  <SummaryChip label="Selling price" value={formatCurrency(selectedDraft.sellingPrice)} />
                  <SummaryChip label="Gross profit" value={formatCurrency(detailMenuItem.estimatedGrossProfit)} />
                  <SummaryChip label="Margin" value={formatPercent(detailMenuItem.estimatedMargin)} />
                </div>
              </Card>

              <Card className="p-5">
                <SectionHeader title="Ingredient cost source" />
                <div className="mt-4 space-y-2">
                  {costSourceRows.map((ingredient) => (
                    <div key={`source-${ingredient.id}`} className="rounded-xl border border-line bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink">{ingredient.label}</p>
                          <p className="mt-1 text-xs leading-5 text-muted">{ingredient.inventoryItem ? ingredient.inventoryItem.preferredSupplier : "Demo fallback cost"}</p>
                        </div>
                        <Badge tone={ingredient.inventoryItem ? "success" : "warning"}>{ingredient.sourceLabel}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                        <span>Unit {formatCurrency(ingredient.currentUnitCost)}</span>
                        <span>Line {formatCurrency(ingredient.lineCost)}</span>
                        {ingredient.sourceDate ? <span>{formatDate(ingredient.sourceDate)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <SectionHeader title="Square-ready mapping demo" />
                <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">Demo / future connection</Badge>
                    <Badge tone={detailMenuItem.mappingStatus === "Mapped" ? "success" : "warning"}>{detailMenuItem.mappingStatus}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Square POS item</p>
                      <p className="mt-2 text-base font-bold text-ink">{selectedDraft.squarePosItem}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally menu item</p>
                      <p className="mt-2 text-base font-bold text-ink">{detailMenuItem.name}</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selectedIngredients.map((ingredient) => (
                      <div key={`deduct-${ingredient.id}`} className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-sm">
                        <span className="min-w-0 font-medium text-ink">
                          {ingredient.label} <span className="text-muted">({ingredient.inventoryItem ? ingredient.inventoryItem.name : "demo cost"})</span>
                        </span>
                        <span className="font-semibold text-ink">
                          {ingredient.quantity} {ingredient.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </MenuDrawerShell>
      ) : null}

      {activePanel?.kind === "risks" ? (
        <MenuDrawerShell title="Margin risks" description="Compact review list for items that need attention." onClose={() => setActivePanel(null)} wide>
          <div className="space-y-3">
            {marginRiskItems.length ? (
              marginRiskItems.map((item) => (
                <div key={`drawer-risk-${item.id}`} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-ink">{item.name}</p>
                      {item.riskReasons.length > 0 ? <Badge tone={toneForRisk(item.riskReasons.length)}>Margin risk</Badge> : null}
                      {item.dataIssues.length > 0 ? <Badge tone="warning">Needs data</Badge> : null}
                    </div>
                      <p className="mt-1 text-sm text-muted">
                        {item.category} | {formatPercent(item.estimatedMargin)} margin | {formatCurrency(item.sellingPrice)} selling price
                      </p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => openMenuItemDetail(item.id)}>
                      Open recipe
                    </Button>
                  </div>
                  {item.dataIssues.length > 0 ? (
                    <p className="mt-2 text-sm leading-6 text-slate-700">Data gaps: {item.dataIssues.join(" | ")}</p>
                  ) : null}
                  {item.riskReasons.length > 0 ? (
                    <p className="mt-2 text-sm leading-6 text-slate-700">Margin risk: {item.riskReasons.join(" | ")}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                No margin-risk items yet. Add a draft item or increase an ingredient cost to surface a warning.
              </div>
            )}
          </div>
        </MenuDrawerShell>
      ) : null}
    </PageLayout>
  );
}

function MenuDrawerShell({
  title,
  description,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-4" onMouseDown={closeOnBackdrop} role="dialog" aria-modal="true">
      <div className={`mx-auto flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:rounded-2xl ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
        <div className="flex items-start justify-between gap-4 border-b border-line bg-white p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Focused workflow</p>
            <h2 className="mt-1 text-lg font-bold text-ink sm:text-xl">{title}</h2>
            {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
