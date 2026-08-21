import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, ChevronDown, Menu, LogOut, MapPin, RefreshCw, X } from "lucide-react";
import { usePilotSession } from "./PilotSessionProvider";
import { initAnalytics, trackPageView } from "../lib/analytics";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard" },
  { to: "/app/purchases", label: "Purchases" },
  { to: "/app/inventory", label: "Inventory" },
  { to: "/app/menu-costing", label: "Menu Costing" },
  { to: "/app/square-usage", label: "Usage / Variance" },
  { to: "/app/stock-counts", label: "Stock Counts" },
  { to: "/app/reorder-plan", label: "Reorder Plan" },
];

function AnalyticsTracker() {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
}

function NavItem({
  to,
  children,
  onClick,
}: {
  to: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold transition",
          isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-ink",
        ].join(" ")
      }
      onClick={onClick}
    >
      {children}
    </NavLink>
  );
}

export function PilotWorkspaceLayout() {
  const { error, user, organization, organizations, currentLocation, locations, signOut, switchLocation, switchOrganization, refreshSession } = usePilotSession();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeOrganizationId = organization?.id ?? "";
  const activeLocationId = currentLocation?.id ?? "";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const locationLabel = useMemo(() => {
    if (!currentLocation) {
      return "No location selected";
    }
    return `${currentLocation.name}`;
  }, [currentLocation]);

  const handleLocationChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const locationId = Number(event.target.value);
    if (Number.isNaN(locationId)) {
      return;
    }
    await switchLocation(locationId);
  };

  const handleOrganizationChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const organizationId = Number(event.target.value);
    if (Number.isNaN(organizationId)) {
      return;
    }
    await switchOrganization(organizationId);
  };

  if (!organization) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <AnalyticsTracker />
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-4xl items-center gap-8">
          <section className="space-y-5 rounded-3xl border border-line bg-ink p-6 text-white shadow-soft sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-100">Pilot access</p>
            <h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Choose the active organization</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              This account has more than one organization membership, so the pilot keeps the active organization explicit instead of guessing.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Selection", "Server-checked"],
                ["Tenant", "One active org"],
                ["Location", "Must match org"],
              ].map(([label, detail]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-brand-100">{label}</p>
                  <p className="mt-1 text-sm text-slate-200">{detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Organizations</p>
                <h2 className="mt-1 text-2xl font-bold text-ink">Pick the active workspace</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Choose the restaurant you want to work in. The pilot will then load locations for that organization and clear any stale location selection.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {error ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  {error}
                </div>
              ) : null}
              {organizations.length > 0 ? (
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Active organization</span>
                  <select className="input mt-1" value={activeOrganizationId} onChange={handleOrganizationChange}>
                    <option value="" disabled>
                      Select an organization
                    </option>
                    {organizations.map((entry) => (
                      <option key={entry.organization.id} value={entry.organization.id}>
                        {entry.organization.name} {entry.membershipRole === "owner" ? "(Owner)" : "(Manager)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  No pilot organization has been assigned to this account yet. Ask the owner to add a membership before continuing.
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={organizations.length === 0}
                  type="button"
                  onClick={() => void refreshSession()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh memberships
                </button>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  type="button"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
                  Public site
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!currentLocation) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-4xl items-center gap-8">
          <section className="space-y-5 rounded-3xl border border-line bg-ink p-6 text-white shadow-soft sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-100">Pilot access</p>
            <h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Choose the active location</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              The selected organization is ready, but the backend still needs a location choice before operational pages can load.
            </p>
          </section>

          <section className="rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
                <MapPin className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Locations</p>
                <h2 className="mt-1 text-2xl font-bold text-ink">Select where you are working</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  The active location must belong to the active organization. Once you choose it, the workspace will refresh and continue loading.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {organizations.length > 1 ? (
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Active organization</span>
                  <select className="input mt-1" value={organization.id} onChange={handleOrganizationChange}>
                    {organizations.map((entry) => (
                      <option key={entry.organization.id} value={entry.organization.id}>
                        {entry.organization.name} {entry.membershipRole === "owner" ? "(Owner)" : "(Manager)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {locations.length > 0 ? (
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Active location</span>
                  <select className="input mt-1" value={activeLocationId} onChange={handleLocationChange}>
                    <option value="" disabled>
                      Select a location
                    </option>
                    {locations.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  This organization does not have any locations yet.
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={locations.length === 0}
                  type="button"
                  onClick={() => void refreshSession()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh session
                </button>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  type="button"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
                <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
                  Public site
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-ink">
      <AnalyticsTracker />
      <div className="lg:flex">
        <aside className="sticky top-0 hidden h-screen w-80 shrink-0 border-r border-line bg-white px-5 py-6 shadow-sm lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">Private pilot</p>
              <h1 className="truncate text-lg font-bold">{organization?.name ?? "Flowtally pilot"}</h1>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
            {organizations.length > 1 ? (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Organization</p>
                <select className="input mt-2" value={organization.id} onChange={handleOrganizationChange}>
                  {organizations.map((entry) => (
                    <option key={entry.organization.id} value={entry.organization.id}>
                      {entry.organization.name} {entry.membershipRole === "owner" ? "(Owner)" : "(Manager)"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Current location</p>
            {locations.length > 1 ? (
              <select className="input mt-2" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
                {!currentLocation ? (
                  <option value="" disabled>
                    Select a location
                  </option>
                ) : null}
                {locations.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-2 font-semibold text-ink">{locationLabel}</p>
            )}
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map((item) => (
              <NavItem key={item.to} to={item.to}>
                {item.label}
              </NavItem>
            ))}
          </nav>

          <div className="mt-auto space-y-3 border-t border-line pt-5 text-sm text-muted">
            <div className="rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Signed in as</p>
              <p className="mt-1 truncate font-semibold text-ink">{user?.email ?? "Unknown user"}</p>
              <p className="mt-1">Working with an explicit organization context.</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                type="button"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              <Link
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                to="/"
              >
                Public site
              </Link>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-line bg-white/92 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:hidden">
              <button
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-white text-ink"
                type="button"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{organization?.name ?? "Flowtally pilot"}</p>
                <p className="truncate text-xs text-muted">{locationLabel}</p>
              </div>
              <button
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-white text-ink"
                type="button"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <div className="hidden items-center justify-between gap-4 px-6 py-4 lg:flex">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">Private pilot workspace</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">End-to-end purchasing and inventory control</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-line bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Location</p>
                  {locations.length > 1 ? (
                    <select className="input mt-1 min-w-56" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
                      {locations.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
                      <MapPin className="h-4 w-4 text-muted" />
                      {locationLabel}
                    </div>
                  )}
                </div>
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  type="button"
                  onClick={() => void refreshSession()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh session
                </button>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
            {error ? (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="alert" aria-live="polite">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Session issue</p>
                      <p className="mt-1">{error}</p>
                    </div>
                  </div>
                  <button
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
                    type="button"
                    onClick={() => void refreshSession()}
                  >
                    Retry session
                  </button>
                </div>
              </div>
            ) : null}
            <Outlet />
          </main>
        </div>
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button className="absolute inset-0 bg-slate-900/35" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
          <div className="absolute left-0 top-0 h-full w-[86%] max-w-sm border-r border-line bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">Private pilot</p>
                <h2 className="mt-1 text-lg font-bold text-ink">{organization?.name ?? "Flowtally pilot"}</h2>
              </div>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white text-ink"
                type="button"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
              {organizations.length > 1 ? (
                <div className="mb-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Organization</p>
                  <select className="input mt-2" value={organization.id} onChange={handleOrganizationChange}>
                    {organizations.map((entry) => (
                      <option key={entry.organization.id} value={entry.organization.id}>
                        {entry.organization.name} {entry.membershipRole === "owner" ? "(Owner)" : "(Manager)"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Current location</p>
              {locations.length > 1 ? (
                <select className="input mt-2" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
                  {!currentLocation ? (
                    <option value="" disabled>
                      Select a location
                    </option>
                  ) : null}
                  {locations.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 font-semibold text-ink">{locationLabel}</p>
              )}
            </div>

            <nav className="mt-6 space-y-2">
              {navItems.map((item) => (
                <NavItem key={item.to} to={item.to} onClick={() => setMobileNavOpen(false)}>
                  {item.label}
                </NavItem>
              ))}
            </nav>

            <div className="mt-6 space-y-2 border-t border-line pt-5">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                type="button"
                onClick={() => void signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              <Link
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                to="/"
                onClick={() => setMobileNavOpen(false)}
              >
                Public site
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
