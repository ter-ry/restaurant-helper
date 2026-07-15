import { Navigate } from "react-router-dom";
import { usePilotSession } from "./PilotSessionProvider";
import { PilotHomePage } from "./PilotHomePage";

export function PilotAppGate() {
  const { status } = usePilotSession();

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-sm text-muted">
        Loading pilot access...
      </main>
    );
  }

  if (status === "signedOut") {
    return <Navigate to="/app/login" replace />;
  }

  if (status === "disabled") {
    return <Navigate to="/" replace />;
  }

  return <PilotHomePage />;
}
