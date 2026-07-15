import type { ReactNode } from "react";
import { LogOut, MapPin, RefreshCw, ShieldCheck, UserCircle2 } from "lucide-react";
import { usePilotSession } from "./PilotSessionProvider";

export function PilotHomePage() {
  const { user, organization, currentLocation, membershipRole, locations, signOut, refreshSession, status } = usePilotSession();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-700">Flowtally pilot app</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Pilot foundation is live</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                This private area is ready for the first restaurant tenant, with session-based access and a single organization context.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                type="button"
                onClick={() => void refreshSession()}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                type="button"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <StatusCard
              icon={<UserCircle2 className="h-5 w-5" />}
              label="User"
              value={user?.email ?? "No user loaded"}
              helper={membershipRole ? `Role: ${membershipRole}` : "Role unavailable"}
            />
            <StatusCard
              icon={<ShieldCheck className="h-5 w-5" />}
              label="Organization"
              value={organization?.name ?? "No organization loaded"}
              helper={status === "signedIn" ? "Tenant context confirmed" : "Session pending"}
            />
            <StatusCard
              icon={<MapPin className="h-5 w-5" />}
              label="Location"
              value={currentLocation?.name ?? "No location loaded"}
              helper={locations.length ? `${locations.length} location(s) in this tenant` : "No locations returned"}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusCard({ icon, label, value, helper }: { icon: ReactNode; label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-lg font-bold text-ink">{value}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{helper}</p>
        </div>
        <div className="rounded-xl bg-brand-50 p-2 text-brand-700">{icon}</div>
      </div>
    </div>
  );
}
