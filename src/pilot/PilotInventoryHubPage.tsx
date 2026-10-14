import { useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import { PilotModuleGate } from "./PilotModuleGate";
import { PilotInventoryPage } from "./PilotInventoryPage";
import { PilotStockCountsPage } from "./PilotStockCountsPage";
import { PilotReorderPlanPage } from "./PilotReorderPlanPage";
import { PilotSquareUsagePage } from "./PilotSquareUsagePage";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";

export function PilotInventoryHubPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "stock";
  const setView = (next: string) => {
    const nextParams = new URLSearchParams(params);
    if (next === "stock") nextParams.delete("view");
    else nextParams.set("view", next);
    setParams(nextParams);
  };

  return (
    <div className="workspace-page">
      <div className="mb-4 flex items-center gap-3">
        <Package className="h-6 w-6 text-brand-700" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Operations</p>
          <h1 className="text-2xl font-bold text-ink">Inventory</h1>
        </div>
      </div>
      <WorkspaceTabs
        value={view}
        onChange={setView}
        ariaLabel="Inventory sections"
        tabs={[
          { id: "stock", label: "Stock" },
          { id: "counts", label: "Counts" },
          { id: "reorder", label: "Reorder" },
          { id: "usage", label: "Usage & Variance" },
        ]}
      />
      <div className="mt-5">
        {view === "counts" ? (
          <PilotModuleGate moduleKey="STOCK_COUNTS" moduleName="Stock Counts"><PilotStockCountsPage /></PilotModuleGate>
        ) : view === "reorder" ? (
          <PilotModuleGate moduleKey="REORDER_PLANS" moduleName="Reorder Plans"><PilotReorderPlanPage /></PilotModuleGate>
        ) : view === "usage" ? (
          <PilotModuleGate moduleKey="SQUARE_INTEGRATION" moduleName="Usage & Variance"><PilotSquareUsagePage /></PilotModuleGate>
        ) : (
          <PilotModuleGate moduleKey="INVENTORY" moduleName="Inventory"><PilotInventoryPage /></PilotModuleGate>
        )}
      </div>
    </div>
  );
}
