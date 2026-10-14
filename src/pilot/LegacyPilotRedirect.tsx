import { Navigate, useLocation } from "react-router-dom";

export function LegacyPilotRedirect({ view, dashboard = false }: { view: string; dashboard?: boolean }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const requestedView = params.get("view");
  const targetView = dashboard && (requestedView === "daily" || requestedView === "weekly") ? requestedView : view;
  params.set("view", targetView);
  return <Navigate to={(dashboard ? "/app/dashboard" : "/app/inventory") + "?" + params.toString()} replace />;
}
