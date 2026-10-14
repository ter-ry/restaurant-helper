import { useSearchParams } from "react-router-dom";
import { PilotDashboardPage } from "./PilotDashboardPage";
import { PilotReportsPage } from "./PilotReportsPage";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs";

export function PilotDashboardWorkspacePage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") ?? "overview";
  const setView = (next: string) => {
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("view");
    else nextParams.set("view", next);
    setParams(nextParams);
  };

  return (
    <div className="workspace-page">
      <WorkspaceTabs
        value={view}
        onChange={setView}
        ariaLabel="Dashboard views"
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "daily", label: "Daily" },
          { id: "weekly", label: "Weekly" },
        ]}
      />
      <div className="mt-5">
        {view === "daily" || view === "weekly" ? <PilotReportsPage initialView={view} /> : <PilotDashboardPage />}
      </div>
    </div>
  );
}
