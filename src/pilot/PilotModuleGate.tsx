import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { usePilotSession } from "./PilotSessionProvider";

export function PilotModuleGate({
  moduleKey,
  moduleName,
  children,
}: {
  moduleKey: string;
  moduleName: string;
  children: ReactNode;
}) {
  const { enabledModuleKeys, organization } = usePilotSession();

  if (!organization) {
    return null;
  }

  if (!enabledModuleKeys.includes(moduleKey)) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-8">
        <section className="w-full max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-soft">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-3 text-amber-700">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-700">Module not enabled</p>
              <h1 className="text-2xl font-bold text-ink">{moduleName} is not available for this organization</h1>
              <p className="text-sm leading-6 text-amber-900">
                This organization does not currently have access to {moduleName.toLowerCase()}. You can continue with the modules that are enabled for the active organization.
              </p>
              <div className="pt-2">
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" to="/app/dashboard">
                  Back to dashboard
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return children;
}
