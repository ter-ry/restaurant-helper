import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Building2, ChevronDown, Menu, LogOut, MapPin, RefreshCw, X } from "lucide-react";
import { usePilotSession } from "./PilotSessionProvider";
import { initAnalytics, trackPageView } from "../lib/analytics";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard" },
  { to: "/app/purchases", label: "Purchases" },
  { to: "/app/inventory", label: "Inventory" },
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
  const { user, organization, currentLocation, locations, signOut, switchLocation, refreshSession } = usePilotSession();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Current location</p>
            {locations.length > 1 ? (
              <select className="input mt-2" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
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
              <p className="mt-1">Working with a single organization context.</p>
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
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Current location</p>
              {locations.length > 1 ? (
                <select className="input mt-2" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
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
