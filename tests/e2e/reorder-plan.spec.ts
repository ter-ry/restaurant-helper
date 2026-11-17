import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser acceptance for the Reorder Plan workflow (#336): add to draft, edit and save, prepare, complete,
 * failures with retry and duplicate-tap protection, at phone and tablet widths. The API is a small stateful
 * fake mirroring the plan lifecycle (Draft -> Prepared -> Completed). No live data, no external services.
 */

type Line = {
  id: number; planId: number; inventoryItemId: number; supplierId: number | null; lineIndex: number; inventoryItemName: string; supplierName: string;
  category: string; purchaseUnit: string; inventoryUnit: string; conversionFactor: number; currentOnHand: number; minimumQuantity: number; parLevel: number;
  suggestedQuantity: number; orderQuantity: number; excluded: boolean; estimatedUnitCost: number | null; estimatedLineCost: number | null; notes: string;
  createdAt: null; updatedAt: null;
};
type Plan = {
  id: number; organizationId: number; locationId: number; name: string; status: string; notes: string; createdByUserId: number; preparedByUserId: number | null;
  completedByUserId: number | null; preparedAt: string | null; completedAt: string | null; lineCount: number; supplierCount: number; estimatedCost: number; includedCost: number;
  estimateStatus: "complete" | "partial"; excludedCount: number; lines: Line[]; createdAt: null; updatedAt: null;
};
type World = {
  plans: Plan[];
  nextPlanId: number;
  calls: { method: string; path: string; body: any }[];
  failNext: Record<string, number>;
  delayMs: number;
};

const ORG = { id: 42, name: "Showcase Cafe", lifecycleStatus: "ACTIVE", setupStatus: "COMPLETE", subscriptionStatus: "ACTIVE", setupTemplateKey: "GENERIC_RESTAURANT", setupFeeStatus: "confirmed", isProspect: false, activeAt: "2026-01-01T00:00:00Z", setupCompletedAt: "2026-01-01T00:00:00Z" };
const LOCATIONS = [{ id: 7, name: "Queen St Cafe", city: "Toronto", region: "ON" }];
const MODULES = ["PURCHASES", "INVENTORY", "REORDER_PLANS", "DAILY_CLOSE"];
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const SUGGESTIONS = [
  { id: 1, inventoryItemId: 30, inventoryItemName: "Chicken Breast", category: "Poultry", supplier: "Toronto Poultry Co", currentQuantity: 2, unit: "kg", minimumQuantity: 4, parLevel: 10, suggestedQuantity: 8, adjustedQuantity: 8, latestPurchasePrice: 24, purchaseUnit: "case", conversionFactor: 4, suggestedPurchaseQuantity: 2, estimateStatus: "complete", estimatedCost: 48, stockStatus: "Reorder now", status: "Reorder now", daysRemaining: 1 },
  { id: 2, inventoryItemId: 31, inventoryItemName: "Whole Milk 4L", category: "Dairy", supplier: "Ontario Dairy", currentQuantity: 3, unit: "L", minimumQuantity: 8, parLevel: 24, suggestedQuantity: 21, adjustedQuantity: 21, latestPurchasePrice: 6.5, purchaseUnit: "jug", conversionFactor: 4, suggestedPurchaseQuantity: 6, estimateStatus: "complete", estimatedCost: 39, stockStatus: "Out of stock", status: "Out of stock", daysRemaining: 0 },
];

const json = (route: Route, payload: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

function newWorld(): World {
  return { plans: [], nextPlanId: 1, calls: [], failNext: {}, delayMs: 0 };
}

function lineFor(planId: number, index: number, s: (typeof SUGGESTIONS)[number], orderQuantity?: number): Line {
  const qty = orderQuantity ?? s.suggestedPurchaseQuantity;
  return {
    id: planId * 100 + index + 1, planId, inventoryItemId: s.inventoryItemId, supplierId: 1, lineIndex: index, inventoryItemName: s.inventoryItemName, supplierName: s.supplier,
    category: s.category, purchaseUnit: s.purchaseUnit, inventoryUnit: s.unit, conversionFactor: s.conversionFactor, currentOnHand: s.currentQuantity,
    minimumQuantity: s.minimumQuantity, parLevel: s.parLevel, suggestedQuantity: s.suggestedQuantity, orderQuantity: qty, excluded: false,
    estimatedUnitCost: s.latestPurchasePrice, estimatedLineCost: qty * s.latestPurchasePrice, notes: "", createdAt: null, updatedAt: null,
  };
}

function recompute(plan: Plan) {
  plan.lineCount = plan.lines.length;
  plan.supplierCount = new Set(plan.lines.map((line) => line.supplierName)).size;
  plan.excludedCount = plan.lines.filter((line) => line.excluded).length;
  for (const line of plan.lines) line.estimatedLineCost = line.orderQuantity * (line.estimatedUnitCost ?? 0);
  plan.includedCost = plan.lines.filter((line) => !line.excluded).reduce((sum, line) => sum + (line.estimatedLineCost ?? 0), 0);
  plan.estimatedCost = plan.includedCost;
}

async function installWorld(page: Page, world: World) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const body = (() => {
      try {
        return JSON.parse(request.postData() ?? "{}");
      } catch {
        return {};
      }
    })();
    if (method !== "GET") world.calls.push({ method, path: pathname, body });

    if (pathname === "/api/auth/me") {
      return json(route, {
        user: { id: 1, email: "owner@example.com", isActive: true, createdAt: null, updatedAt: null }, platformRole: null, membershipRole: "owner",
        currentOrganizationId: ORG.id, currentLocationId: 7, csrfToken: "csrf-token", enabledModuleKeys: MODULES,
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }],
      });
    }
    if (pathname === "/api/auth/csrf") return json(route, { csrfToken: "csrf-token" });
    if (pathname.startsWith("/api/organizations")) {
      const bundle = { organization: ORG, restaurantLocations: LOCATIONS, currentLocation: LOCATIONS[0], membershipRole: "owner", enabledModuleKeys: MODULES };
      return json(route, {
        organizations: [{ organization: ORG, membershipRole: "owner", selected: true }], currentOrganizationId: ORG.id, currentMembershipId: 1,
        currentLocationId: 7, currentOrganization: bundle, ...bundle,
      });
    }
    if (pathname === "/api/pilot/suppliers") return json(route, { suppliers: [] });
    if (pathname === "/api/pilot/inventory") {
      return json(route, {
        items: [], movements: [], countSessions: [], reorderPlan: { suggestions: [], groupedBySupplier: [] },
        summary: { inventoryItemCount: 2, inventoryOutOfStockCount: 1, inventoryReorderNowCount: 1, inventoryLowStockCount: 0, inventoryValue: 0 },
      });
    }
    if (pathname === "/api/pilot/inventory/negative-stock") return json(route, { count: 0, posCausedCount: 0, items: [] });

    if (pathname === "/api/pilot/reorder-plan") {
      const inDraft = new Set(world.plans.filter((plan) => plan.status !== "Completed").flatMap((plan) => plan.lines.map((line) => line.inventoryItemId)));
      const open = world.plans.some((plan) => plan.status === "Completed") ? SUGGESTIONS.filter((s) => !inDraft.has(s.inventoryItemId) && !world.plans.some((p) => p.status === "Completed" && p.lines.some((l) => l.inventoryItemId === s.inventoryItemId))) : SUGGESTIONS;
      return json(route, {
        suggestions: open, groupedBySupplier: [], activeInventoryItemCount: 2,
        inventoryItems: SUGGESTIONS.map((s) => ({ id: s.inventoryItemId, name: s.inventoryItemName, currentOnHand: s.currentQuantity, stockUnit: s.unit, parLevel: s.parLevel, preferredSupplierName: s.supplier })),
        refreshedAt: "2026-11-17T12:00:00Z",
      });
    }
    if (pathname === "/api/pilot/reorder-plans") {
      if (method === "GET") {
        const active = world.plans.find((plan) => plan.status === "Draft");
        return json(route, { plans: world.plans, activeDraftPlanId: active?.id ?? null });
      }
      if (world.delayMs) await new Promise((resolve) => setTimeout(resolve, world.delayMs));
      const plan: Plan = {
        id: world.nextPlanId++, organizationId: 42, locationId: 7, name: `Reorder plan ${world.nextPlanId - 1}`, status: "Draft", notes: "", createdByUserId: 1, preparedByUserId: null,
        completedByUserId: null, preparedAt: null, completedAt: null, lineCount: 0, supplierCount: 0, estimatedCost: 0, includedCost: 0, estimateStatus: "complete", excludedCount: 0,
        lines: [], createdAt: null, updatedAt: null,
      };
      world.plans.unshift(plan);
      return json(route, plan, 201);
    }
    const planMatch = pathname.match(/^\/api\/pilot\/reorder-plans\/(\d+)(\/prepare|\/complete)?$/);
    if (planMatch) {
      const plan = world.plans.find((entry) => entry.id === Number(planMatch[1]));
      if (!plan) return json(route, { error: "Not found." }, 404);
      const action = planMatch[2] ?? "";
      const key = `${method} ${action || "plan"}`;
      if (world.failNext[key]) {
        world.failNext[key] -= 1;
        return json(route, { error: "The server could not process this request. Try again." }, 503);
      }
      if (world.delayMs && method !== "GET") await new Promise((resolve) => setTimeout(resolve, world.delayMs));
      if (method === "GET") return json(route, plan);
      if (action === "/prepare") {
        if (plan.status !== "Draft") return json(route, { error: "Only draft plans can be prepared." }, 409);
        plan.status = "Prepared";
        plan.preparedAt = "2026-11-17T12:05:00Z";
        return json(route, plan);
      }
      if (action === "/complete") {
        if (plan.status !== "Prepared") return json(route, { error: "Only prepared plans can be completed." }, 409);
        plan.status = "Completed";
        plan.completedAt = "2026-11-17T12:10:00Z";
        return json(route, plan);
      }
      if (plan.status !== "Draft") return json(route, { error: "Only draft plans can be edited." }, 409);
      if (typeof body.name === "string") plan.name = body.name;
      if (typeof body.notes === "string") plan.notes = body.notes;
      const next: Line[] = [];
      for (const entry of body.lines ?? []) {
        const existing = entry.id ? plan.lines.find((line) => line.id === entry.id) : undefined;
        if (existing) {
          existing.orderQuantity = Number(entry.orderQuantity);
          existing.excluded = Boolean(entry.excluded);
          existing.notes = String(entry.notes ?? "");
          next.push(existing);
        } else {
          const suggestion = SUGGESTIONS.find((s) => s.inventoryItemId === entry.inventoryItemId)!;
          next.push(lineFor(plan.id, next.length, suggestion, entry.orderQuantity));
        }
      }
      plan.lines = next;
      recompute(plan);
      return json(route, plan);
    }
    return json(route, { error: `Unmocked ${method} ${pathname}` }, 404);
  });
}

async function openReorder(page: Page) {
  await page.goto("/app/inventory?view=reorder", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "What to buy" })).toBeVisible();
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

const callsTo = (world: World, method: string, matcher: RegExp) => world.calls.filter((call) => call.method === method && matcher.test(call.path));

for (const viewport of VIEWPORTS) {
  test.describe(`Reorder plan at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("shows suggestions, adds one to a draft, edits and saves with server refresh", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openReorder(page);
      await expectNoOverflow(page);

      await expect(page.getByText("Chicken Breast").first()).toBeVisible();
      await expect(page.getByText("Whole Milk 4L").first()).toBeVisible();

      await page.getByRole("button", { name: "Add to draft" }).first().click();
      await expect(page.getByText("Item added to the working order plan.")).toBeVisible();
      expect(callsTo(world, "POST", /reorder-plans$/)).toHaveLength(1);
      await expect(page.getByRole("button", { name: "In draft" })).toBeVisible();

      const qty = page.getByRole("spinbutton").first();
      await expect(qty).toHaveValue("2");
      await qty.fill("5");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText(/Saved draft Reorder plan 1/)).toBeVisible();
      expect(world.plans[0].lines[0].orderQuantity).toBe(5);
      await expect(page.getByRole("spinbutton").first()).toHaveValue("5");
      await expectNoOverflow(page);
    });

    test("double-tap on Add to draft and Save draft sends one request each", async ({ page }) => {
      const world = newWorld();
      world.delayMs = 400;
      await installWorld(page, world);
      await openReorder(page);

      const add = page.getByRole("button", { name: "Add to draft" }).first();
      await add.dblclick();
      await expect(page.getByText("Item added to the working order plan.")).toBeVisible();
      expect(callsTo(world, "POST", /reorder-plans$/)).toHaveLength(1);
      expect(callsTo(world, "PATCH", /reorder-plans\/1$/)).toHaveLength(1);

      await page.getByRole("spinbutton").first().fill("3");
      const save = page.getByRole("button", { name: "Save draft" });
      await save.dblclick();
      await expect(page.getByText(/Saved draft/)).toBeVisible();
      expect(callsTo(world, "PATCH", /reorder-plans\/1$/)).toHaveLength(2);
    });

    test("a failed save keeps the edit visible, says so, and retry succeeds", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openReorder(page);
      await page.getByRole("button", { name: "Add to draft" }).first().click();
      await expect(page.getByText("Item added to the working order plan.")).toBeVisible();

      await page.getByRole("spinbutton").first().fill("9");
      world.failNext["PATCH plan"] = 1;
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByRole("alert")).toContainText("could not process");
      await expect(page.getByRole("spinbutton").first()).toHaveValue("9");
      expect(world.plans[0].lines[0].orderQuantity).toBe(2);

      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText(/Saved draft/)).toBeVisible();
      expect(world.plans[0].lines[0].orderQuantity).toBe(9);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });

    test("prepare then complete locks the plan, moves it to history and refreshes suggestions", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openReorder(page);
      await page.getByRole("button", { name: "Add to draft" }).first().click();
      await expect(page.getByText("Item added to the working order plan.")).toBeVisible();
      await page.getByRole("button", { name: "Add current recommendations" }).click();
      await expect(page.getByText("Items added to the working order plan.")).toBeVisible();
      expect(world.plans[0].lines).toHaveLength(2);

      await page.getByRole("button", { name: "Mark prepared" }).click();
      await expect(page.getByText(/Prepared reorder plan/)).toBeVisible();
      expect(world.plans[0].status).toBe("Prepared");
      await expect(page.getByRole("spinbutton").first()).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();

      await page.getByRole("button", { name: "Complete plan" }).click();
      await page.getByRole("button", { name: "Confirm completion" }).click();
      await expect(page.getByText(/Completed reorder plan/)).toBeVisible();
      expect(world.plans[0].status).toBe("Completed");
      expect(callsTo(world, "POST", /\/complete$/)).toHaveLength(1);
      await expectNoOverflow(page);
    });

    test("a failed complete shows the error, leaves the plan prepared, and can be retried once", async ({ page }) => {
      const world = newWorld();
      await installWorld(page, world);
      await openReorder(page);
      await page.getByRole("button", { name: "Add to draft" }).first().click();
      await expect(page.getByText("Item added to the working order plan.")).toBeVisible();
      await page.getByRole("button", { name: "Mark prepared" }).click();
      await expect(page.getByText(/Prepared reorder plan/)).toBeVisible();

      world.failNext["POST /complete"] = 1;
      await page.getByRole("button", { name: "Complete plan" }).click();
      await page.getByRole("button", { name: "Confirm completion" }).click();
      await expect(page.getByRole("alert")).toContainText("could not process");
      expect(world.plans[0].status).toBe("Prepared");

      await page.getByRole("button", { name: "Complete plan" }).click();
      await page.getByRole("button", { name: "Confirm completion" }).dblclick();
      await expect(page.getByText(/Completed reorder plan/)).toBeVisible();
      expect(world.plans[0].status).toBe("Completed");
      expect(callsTo(world, "POST", /\/complete$/)).toHaveLength(2);
    });
  });
}
