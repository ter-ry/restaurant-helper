import { CheckCircle2, Plus, ReceiptText, Store, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { StatCard } from "../components/StatCard";
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
  marginTone: MarginTone;
};

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
    name: "Oat Latte",
    category: "Espresso",
    sellingPrice: 5.95,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Oat Latte - 12 oz",
    packagingCost: 0.09,
    ingredients: [
      seedIngredient("Oat milk", 300, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Espresso blend", 16, "g", 0.08, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
    ],
  },
  {
    id: "black-tea",
    name: "Black Tea",
    category: "Tea",
    sellingPrice: 3.75,
    recipeStatus: "Complete",
    mappingStatus: "Mapped",
    squarePosItem: "Black Tea - 16 oz",
    packagingCost: 0.08,
    ingredients: [
      seedIngredient("Black tea leaves", 6, "g", 0.04, "Black tea leaves 1kg", 1000, "Recent purchase price"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "citrus-green-tea",
    name: "Citrus Green Tea",
    category: "Tea",
    sellingPrice: 6.95,
    recipeStatus: "Complete",
    mappingStatus: "Demo only",
    squarePosItem: "Citrus Green Tea - future Square item",
    packagingCost: 0.09,
    ingredients: [
      seedIngredient("Green tea leaves", 6, "g", 0.05, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Citrus syrup", 35, "ml", 0.04, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "matcha-cloud-latte",
    name: "Matcha Cloud Latte",
    category: "Signature drinks",
    sellingPrice: 8.95,
    recipeStatus: "Needs review",
    mappingStatus: "Missing",
    squarePosItem: "Matcha Cloud Latte - not mapped",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Matcha powder", 25, "g", 0.18, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cloud foam", 20, "g", 0.03, undefined, undefined, "Fallback demo cost"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
    ],
  },
  {
    id: "seasonal-strawberry-matcha",
    name: "Seasonal Strawberry Matcha",
    category: "Seasonal",
    sellingPrice: 9.25,
    recipeStatus: "Draft",
    mappingStatus: "Missing",
    squarePosItem: "Seasonal Strawberry Matcha - draft Square item",
    packagingCost: 0.12,
    ingredients: [
      seedIngredient("Strawberry puree", 35, "ml", 0.08, undefined, undefined, "Draft item"),
      seedIngredient("Matcha powder", 20, "g", 0.18, undefined, undefined, "Draft item"),
      seedIngredient("Oat milk", 250, "ml", 0.006, "Oat milk cartons", 12000, "Recent purchase price"),
      seedIngredient("Cup", 1, "each", 0.26, "700ml plastic cups", 250, "Packaging item"),
      seedIngredient("Straw", 1, "each", 0.04, "Straws", 500, "Packaging item"),
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
  if (item.recipeStatus !== "Complete") {
    riskReasons.push("Recipe incomplete");
  }
  if (item.mappingStatus !== "Mapped") {
    riskReasons.push("POS mapping missing");
  }
  if (ingredients.some((ingredient) => !ingredient.inventoryItem)) {
    riskReasons.push("Demo cost in recipe");
  }
  if (ingredients.some((ingredient) => ingredient.recentPriceChange && ingredient.recentPriceChange.changePercent > 5)) {
    riskReasons.push("Ingredient price increased");
  }

  let marginTone: MarginTone = "success";
  if (riskReasons.some((reason) => reason === "Thin margin")) {
    marginTone = "danger";
  } else if (riskReasons.length > 0) {
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
    const squareReady = resolvedMenuItems.filter((item) => item.recipeStatus === "Complete" && item.mappingStatus === "Mapped").length;
    return {
      menuItems: resolvedMenuItems.length,
      recipeComplete,
      averageMargin: Number(averageMargin.toFixed(1)),
      riskItems,
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
  };

  const reviewMarginRisks = () => {
    setSelectedMenuItemId(marginRiskItems[0]?.id ?? selectedMenuItemId);
  };

  const mapPosItem = () => {
    const missingMapping = resolvedMenuItems.find((item) => item.mappingStatus !== "Mapped");
    if (missingMapping) {
      setSelectedMenuItemId(missingMapping.id);
    }
  };

  return (
    <PageLayout
      title="Menu & Costing"
      eyebrow="Back Office Core / Demo-real workspace"
      description="Cost recipes, track margin pressure, and prepare menu items for POS-connected inventory deduction."
    >
      <Card className="p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Restaurant demo</Badge>
              <Badge tone={metrics.riskItems > 0 ? "warning" : "success"}>{metrics.squareReady} Square-ready mappings</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink">
              Cost recipes, track margin pressure, and prepare menu items for POS-connected inventory deduction.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              This workspace shows how purchase prices flow into inventory ingredient costs, then into recipes, menu item margin, and a future Square mapping preview.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={createMenuItem}>
              Create menu item
            </Button>
            <Button type="button" variant="secondary" onClick={reviewMarginRisks}>
              Review margin risks
            </Button>
            <Button type="button" variant="secondary" onClick={mapPosItem}>
              Map POS item
            </Button>
          </div>
        </div>
      </Card>

      <section className="mt-8">
        <SectionHeader title="Menu health" description="Compact signals for recipe completeness, margin pressure, and Square-ready mappings." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Menu items" value={String(metrics.menuItems)} helper="Demo menu items currently shown" icon={<ReceiptText className="h-5 w-5" />} />
          <StatCard label="Recipes complete" value={String(metrics.recipeComplete)} helper="Ready for costing review" icon={<CheckCircle2 className="h-5 w-5" />} />
          <StatCard label="Average estimated margin" value={formatPercent(metrics.averageMargin)} helper="Across the demo menu" icon={<TrendingUp className="h-5 w-5" />} />
          <StatCard label="Margin-risk items" value={String(metrics.riskItems)} helper="Thin margin, missing recipe, or mapping" icon={<TrendingDown className="h-5 w-5" />} />
          <StatCard label="Square-ready mappings" value={String(metrics.squareReady)} helper="Demo mapping only, not live POS" icon={<Store className="h-5 w-5" />} />
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader
              title="Menu item list"
              description="Select a menu item to see its recipe, cost, margin, and future POS mapping."
              action={
                <Badge tone="neutral">
                  {resolvedMenuItems.length} demo items
                </Badge>
              }
            />
            <div className="mt-5 space-y-3">
              {allItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedMenuItemId(item.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    item.id === selectedMenuItemId ? "border-brand-300 bg-brand-50 shadow-soft" : "border-line bg-white hover:border-brand-100 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-ink">{item.name}</h3>
                        <Badge tone={item.marginTone}>{marginStatusLabel(item.estimatedMargin)}</Badge>
                        {item.riskReasons.length > 0 ? <Badge tone={toneForRisk(item.riskReasons.length)}>Risk</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {item.category} • {item.recipeStatus} recipe • {item.mappingStatus} mapping
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      <span>{formatCurrency(item.sellingPrice)}</span>
                      <span className="text-muted">selling</span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Ingredient cost</p>
                      <p className="mt-2 text-lg font-bold text-ink">{formatCurrency(item.estimatedIngredientCost)}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Margin</p>
                      <p className="mt-2 text-lg font-bold text-ink">{formatPercent(item.estimatedMargin)}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Recipe status</p>
                      <p className="mt-2 text-lg font-bold text-ink">{item.recipeStatus}</p>
                    </div>
                    <div className="rounded-xl border border-line bg-white p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Mapping</p>
                      <p className="mt-2 text-lg font-bold text-ink">{item.mappingStatus}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone={item.marginTone}>Est. gross profit {formatCurrency(item.estimatedGrossProfit)}</Badge>
                    {item.riskReasons.map((reason) => (
                      <Badge key={reason} tone="warning">
                        {reason}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Margin risk list" description="Items that need recipe review, cost checks, or POS mapping before they are reliable." />
            {marginRiskItems.length > 0 ? (
              <div className="mt-5 space-y-3">
                {marginRiskItems.map((item) => (
                  <div key={`risk-${item.id}`} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-ink">{item.name}</p>
                          <Badge tone={toneForRisk(item.riskReasons.length)}>Risk</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {item.category} • {formatPercent(item.estimatedMargin)} margin • {formatCurrency(item.sellingPrice)} selling price
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{item.riskReasons.join(" • ")}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={() => setSelectedMenuItemId(item.id)}>
                          Review recipe
                        </Button>
                        <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={purchasesRoute}>
                          Check price change
                        </Link>
                        <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={inventoryRoute}>
                          Map POS item
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                No margin-risk items yet. Add a draft item or increase an ingredient cost to surface a warning.
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader
              title="Selected menu item"
              description="Edit the demo fields below. Changes stay local to the workspace and help illustrate a light recipe editor."
              action={<Badge tone={selectedResolvedMenuItem?.marginTone ?? "neutral"}>{selectedResolvedMenuItem ? marginStatusLabel(selectedResolvedMenuItem.estimatedMargin) : "No item"}</Badge>}
            />
            {selectedResolvedMenuItem ? (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Menu item name</span>
                    <input
                      className={editableFieldClass}
                      value={selectedDraft.name}
                      onChange={(event) => updateItemField(selectedDraft.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Category</span>
                    <input
                      className={editableFieldClass}
                      value={selectedDraft.category}
                      onChange={(event) => updateItemField(selectedDraft.id, { category: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Selling price</span>
                    <input
                      type="number"
                      step="0.01"
                      className={editableFieldClass}
                      value={selectedDraft.sellingPrice}
                      onChange={(event) => updateItemField(selectedDraft.id, { sellingPrice: Number(event.target.value || 0) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Square POS item</span>
                    <input
                      className={editableFieldClass}
                      value={selectedDraft.squarePosItem}
                      onChange={(event) => updateItemField(selectedDraft.id, { squarePosItem: event.target.value })}
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">Recipe status</span>
                    <select
                      className={editableFieldClass}
                      value={selectedDraft.recipeStatus}
                      onChange={(event) => updateItemField(selectedDraft.id, { recipeStatus: event.target.value as RecipeStatus })}
                    >
                      <option value="Complete">Complete</option>
                      <option value="Needs review">Needs review</option>
                      <option value="Draft">Draft</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">POS mapping</span>
                    <select
                      className={editableFieldClass}
                      value={selectedDraft.mappingStatus}
                      onChange={(event) => updateItemField(selectedDraft.id, { mappingStatus: event.target.value as MappingStatus })}
                    >
                      <option value="Mapped">Mapped</option>
                      <option value="Demo only">Demo only</option>
                      <option value="Missing">Missing</option>
                    </select>
                  </label>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Badge tone={selectedResolvedMenuItem.marginTone}>{formatPercent(selectedResolvedMenuItem.estimatedMargin)} margin</Badge>
                  <Badge tone={selectedResolvedMenuItem.estimatedMargin < 50 ? "danger" : "success"}>{selectedResolvedMenuItem.estimatedMargin < 50 ? "Margin pressure" : "Healthy margin"}</Badge>
                  <Badge tone={selectedResolvedMenuItem.mappingStatus === "Mapped" ? "success" : "warning"}>
                    {selectedResolvedMenuItem.mappingStatus === "Mapped" ? "Square-ready demo" : "Future Square connection"}
                  </Badge>
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                No menu item selected.
              </div>
            )}
          </Card>

          <Card className="p-6">
            <SectionHeader
              title="Recipe builder / detail"
              description="Ingredients, quantities, and line cost stay editable here. The editor is demo-only and does not write to a backend."
              action={
                <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => addIngredient(selectedDraft.id)}>
                  Add ingredient
                </Button>
              }
            />
            <div className="mt-5 space-y-3">
              {selectedIngredients.map((ingredient) => (
                <div key={ingredient.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                      <input
                        className={editableFieldClass}
                        value={ingredient.unit}
                        onChange={(event) => updateIngredientField(selectedDraft.id, ingredient.id, { unit: event.target.value })}
                      />
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
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {ingredient.inventoryItem ? <span>Linked inventory item: {ingredient.inventoryItem.name}</span> : <span>No inventory match</span>}
                    <span>•</span>
                    <span>{ingredient.sourceLabel}</span>
                    {ingredient.recentPriceChange ? (
                      <>
                        <span>•</span>
                        <span className={ingredient.recentPriceChange.changePercent > 0 ? "text-danger" : "text-brand-700"}>
                          {formatPercent(ingredient.recentPriceChange.changePercent)} vs prior invoice
                        </span>
                      </>
                    ) : null}
                  </div>
                  {ingredient.note ? <p className="mt-2 text-sm leading-6 text-slate-700">{ingredient.note}</p> : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="Cost summary" description="Purchase prices and inventory counts roll up into a simple estimated cost and margin view." />
            {selectedResolvedMenuItem ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Total ingredient cost</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatCurrency(selectedResolvedMenuItem.estimatedIngredientCost)}</p>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Packaging cost</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatCurrency(selectedDraft.packagingCost)}</p>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Total estimated cost</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatCurrency(selectedResolvedMenuItem.estimatedTotalCost)}</p>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Selling price</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatCurrency(selectedDraft.sellingPrice)}</p>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Estimated gross profit</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatCurrency(selectedResolvedMenuItem.estimatedGrossProfit)}</p>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Estimated margin</p>
                  <p className="mt-2 text-xl font-bold text-ink">{formatPercent(selectedResolvedMenuItem.estimatedMargin)}</p>
                </div>
                <div className="sm:col-span-2 rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={selectedResolvedMenuItem.marginTone}>{marginStatusLabel(selectedResolvedMenuItem.estimatedMargin)}</Badge>
                    <Badge tone={selectedResolvedMenuItem.estimatedMargin < 50 ? "warning" : "success"}>
                      {selectedResolvedMenuItem.estimatedMargin < 50 ? "Thin margin" : "Healthy margin"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    This is a demo-real estimate built from ingredient costs, packaging overhead, and the currently selected recipe quantities. If a purchase price rises, the cost summary updates immediately.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                Select a menu item to see the cost summary.
              </div>
            )}
          </Card>

          <Card className="p-6">
            <SectionHeader
              title="Ingredient cost source panel"
              description="Show exactly where the recipe cost is coming from so the connection to Purchases and Inventory is obvious."
            />
            {costSourceRows.length > 0 ? (
              <div className="mt-5 space-y-3">
                {costSourceRows.map((ingredient) => (
                  <div key={`source-${ingredient.id}`} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-ink">{ingredient.label}</p>
                          <Badge tone={ingredient.inventoryItem ? "success" : "warning"}>{ingredient.sourceLabel}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {ingredient.inventoryItem
                            ? `${ingredient.inventoryItem.preferredSupplier} • last purchase ${formatDate(ingredient.inventoryItem.lastReceivedAt)} • purchase price ${formatCurrency(ingredient.inventoryItem.latestPurchasePrice)}`
                            : "Fallback demo cost because no tracked inventory item is linked yet."}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">Unit cost</p>
                        <p className="mt-1 text-lg font-bold text-ink">{formatCurrency(ingredient.currentUnitCost)}</p>
                        <p className="text-xs text-muted">Line cost {formatCurrency(ingredient.lineCost)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ingredient.recentPriceChange ? (
                        <Badge tone={ingredient.recentPriceChange.changePercent > 0 ? "danger" : "success"}>
                          {ingredient.recentPriceChange.changePercent > 0 ? "Price increased" : "Price stable"} {formatPercent(ingredient.recentPriceChange.changePercent)}
                        </Badge>
                      ) : (
                        <Badge tone={ingredient.inventoryItem ? "info" : "neutral"}>{ingredient.inventoryItem ? "Recent purchase price" : "Demo fallback"}</Badge>
                      )}
                      {ingredient.note ? <Badge tone="neutral">{ingredient.note}</Badge> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                No ingredient sources available yet.
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={purchasesRoute}>
                Open Purchases
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={inventoryRoute}>
                Open Inventory
              </Link>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader
              title="Square-ready POS mapping demo"
              description="This is a labeled future connection, not a live Square integration."
            />
            {selectedResolvedMenuItem ? (
              <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">Demo / future connection</Badge>
                  <Badge tone={selectedResolvedMenuItem.mappingStatus === "Mapped" ? "success" : "warning"}>{selectedResolvedMenuItem.mappingStatus}</Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Square POS item</p>
                    <p className="mt-2 text-base font-bold text-ink">{selectedDraft.squarePosItem}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-white p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally menu item</p>
                    <p className="mt-2 text-base font-bold text-ink">{selectedResolvedMenuItem.name}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Expected deduction per sale</p>
                  <div className="mt-3 space-y-2">
                    {selectedIngredients.map((ingredient) => (
                      <div key={`deduct-${ingredient.id}`} className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-sm">
                        <span className="font-medium text-ink">
                          {ingredient.label} <span className="text-muted">({ingredient.inventoryItem ? ingredient.inventoryItem.name : "demo cost"})</span>
                        </span>
                        <span className="font-semibold text-ink">
                          {ingredient.quantity} {ingredient.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
                Select a menu item to see the Square mapping demo.
              </div>
            )}
          </Card>

          <Card className="p-6">
            <SectionHeader
              title="Future loop"
              description="How this workspace becomes operational once POS data is connected."
            />
            <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50 p-5">
              <p className="text-sm leading-6 text-slate-800">
                When POS sales are connected, Flowtally can estimate ingredient usage from recipes and compare expected usage with stock counts. That turns purchase prices, recipe costs, and inventory movement into one connected back-office loop.
              </p>
            </div>
          </Card>
        </div>
      </section>
    </PageLayout>
  );
}
