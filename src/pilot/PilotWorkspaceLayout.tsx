import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AlertTriangle, BarChart3, Building2, ChevronLeft, ChevronRight, ClipboardList, CircleDollarSign, ExternalLink, LayoutDashboard, MapPin, Menu, Package, ReceiptText, RefreshCw, ShoppingCart, SquareStack, UtensilsCrossed, LogOut, Settings, UserCircle, X } from "lucide-react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { usePilotSession } from "./PilotSessionProvider";
import { fetchPilotAttention, updatePilotLocation, type PilotLocation } from "./pilotApi";
import { initAnalytics, trackPageView } from "../lib/analytics";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", group: "Overview", icon: LayoutDashboard },
  { to: "/app/purchases", label: "Purchases", group: "Operations", icon: ReceiptText },
  { to: "/app/inventory", label: "Inventory", group: "Operations", icon: Package },
  { to: "/app/stock-counts", label: "Stock Counts", group: "Operations", icon: ClipboardList },
  { to: "/app/reorder-plan", label: "Reorder Plan", group: "Operations", icon: ShoppingCart },
  { to: "/app/menu-costing", label: "Menu Costing", group: "Menu & Cost", icon: UtensilsCrossed, moduleKey: "MENU_COSTING" },
  { to: "/app/square", label: "Square", group: "Sales & Close", icon: SquareStack, moduleKey: "SQUARE_INTEGRATION" },
  { to: "/app/square-usage", label: "Usage / Variance", group: "Sales & Close", icon: BarChart3, moduleKey: "SQUARE_INTEGRATION" },
  { to: "/app/daily-close", label: "Daily Close", group: "Sales & Close", icon: CircleDollarSign, moduleKey: "DAILY_CLOSE" },
];

const navigationGroups = ["Overview", "Operations", "Menu & Cost", "Sales & Close"] as const;

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
  label,
  collapsed = false,
  icon,
  onClick,
  badge,
}: {
  to: string;
  label: string;
  collapsed?: boolean;
  onClick?: () => void;
  badge?: number;
  icon: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        [
          "flex items-center justify-start gap-2 rounded-2xl py-3 text-sm font-semibold transition",
          collapsed ? "justify-center px-2" : "justify-start px-3",
          isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-ink",
        ].join(" ")
      }
      onClick={onClick}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-current">{icon}</span>
      <span className={collapsed ? "sr-only" : "flex min-w-0 flex-1 items-center justify-between gap-2 truncate"}>
        <span className="truncate">{label}</span>
        {badge && badge > 0 ? <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900" aria-label={`${badge} needs attention`}>{badge}</span> : null}
      </span>
    </NavLink>
  );
}

export function PilotWorkspaceLayout() {
  const { error, user, organization, enabledModuleKeys, organizations, currentLocation, locations, signOut, switchLocation, switchOrganization, refreshSession } = usePilotSession();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<PilotLocation | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [operationalAttention, setOperationalAttention] = useState<{ reorder: number }>({ reorder: 0 });
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem("flowtally:pilot-sidebar-collapsed") === "true";
  });
  const activeOrganizationId = organization?.id ?? "";
  const activeLocationId = currentLocation?.id ?? "";
  const enabledModuleKeySet = useMemo(() => new Set(enabledModuleKeys), [enabledModuleKeys]);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => !item.moduleKey || enabledModuleKeySet.has(item.moduleKey)),
    [enabledModuleKeySet],
  );
  const visibleNavigationGroups = useMemo(
    () => navigationGroups.map((label) => ({ label, items: visibleNavItems.filter((item) => item.group === label) })).filter((group) => group.items.length > 0),
    [visibleNavItems],
  );
  const locationLabel = useMemo(() => {
    if (!currentLocation) {
      return "No location selected";
    }
    return `${currentLocation.name}`;
  }, [currentLocation]);
  const currentSectionLabel = useMemo(() => {
    const current = [...visibleNavItems].reverse().find((item) => location.pathname.startsWith(item.to));
    return current?.label ?? "Workspace";
  }, [location.pathname, visibleNavItems]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const loadAttention = async () => {
      if (cancelled || inFlight || !activeOrganizationId || !activeLocationId) {
        return;
      }
      inFlight = true;
      try {
        const attention = await fetchPilotAttention();
        if (!cancelled) {
          setOperationalAttention({ reorder: attention.reorder.count });
        }
      } catch {
        // The sidebar should remain usable when the attention refresh is unavailable.
      } finally {
        inFlight = false;
      }
    };
    void loadAttention();
    const interval = window.setInterval(() => void loadAttention(), 60000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeOrganizationId, activeLocationId]);

  useEffect(() => {
    window.localStorage.setItem("flowtally:pilot-sidebar-collapsed", String(desktopSidebarCollapsed));
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

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

  const openSettings = () => {
    setSettingsDraft(currentLocation ? { ...currentLocation } : null);
    setSettingsError(null);
    setAccountMenuOpen(false);
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      await updatePilotLocation(settingsDraft.id, settingsDraft);
      await refreshSession();
      setSettingsOpen(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not save location settings.");
    } finally {
      setSettingsSaving(false);
    }
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
      <div className="xl:flex xl:h-dvh xl:overflow-hidden">
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 border-r border-line bg-white px-4 py-4 shadow-sm transition-[width] duration-200 xl:flex xl:flex-col ${
            desktopSidebarCollapsed ? "xl:w-16" : "xl:w-60"
          }`}
        >
          <div className={`flex ${desktopSidebarCollapsed ? "flex-col items-center gap-2" : "items-center justify-between gap-3"}`}>
            <div className={`flex items-center gap-3 ${desktopSidebarCollapsed ? "flex-col text-center" : ""}`}>
              <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
                <Building2 className="h-6 w-6" />
              </div>
            </div>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white text-ink transition hover:bg-slate-50"
              type="button"
              aria-label={desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setDesktopSidebarCollapsed((current) => !current)}
            >
              {desktopSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          {!desktopSidebarCollapsed ? (
            <div className="mt-3 rounded-xl border border-line bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Organization</p>
                {organizations.length > 1 ? (
                  <select className="input mt-1" value={organization.id} onChange={handleOrganizationChange}>
                    {organizations.map((entry) => (
                      <option key={entry.organization.id} value={entry.organization.id}>
                        {entry.organization.name} {entry.membershipRole === "owner" ? "(Owner)" : "(Manager)"}
                      </option>
                    ))}
                  </select>
                ) : (
                <p className="font-semibold text-ink">{organization?.name ?? "Flowtally pilot"}</p>
                )}
              </div>

              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Location</p>
                {locations.length > 1 ? (
                  <select className="input mt-1" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
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
                  <p className="font-semibold text-ink">{locationLabel}</p>
                )}
              </div>
            </div>
          ) : null}

          <nav className={`mt-4 space-y-4 ${desktopSidebarCollapsed ? "px-0.5" : ""}`} aria-label="Workspace navigation">
            {visibleNavigationGroups.map((group) => (
              <section key={group.label} aria-labelledby={`desktop-navigation-${group.label.replaceAll(" ", "-").replaceAll("&", "and")}`}>
                <p id={`desktop-navigation-${group.label.replaceAll(" ", "-").replaceAll("&", "and")}`} className={desktopSidebarCollapsed ? "sr-only" : "px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted"}>
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <NavItem key={item.to} to={item.to} label={item.label} icon={<item.icon className="h-5 w-5" />} collapsed={desktopSidebarCollapsed} badge={item.to === "/app/reorder-plan" ? operationalAttention.reorder : undefined} />
                  ))}
                </div>
              </section>
            ))}
          </nav>

        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-line bg-white/92 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5 xl:hidden">
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white text-ink shadow-sm"
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{currentSectionLabel}</p>
              </div>
              <button className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white text-ink shadow-sm" type="button" onClick={() => void refreshSession()} title="Refresh session" aria-label="Refresh session">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-white text-ink shadow-sm" type="button" aria-expanded={accountMenuOpen} aria-label="Open account menu" onClick={() => setAccountMenuOpen((value) => !value)}>
                <UserCircle className="h-4 w-4" />
              </button>
              {accountMenuOpen ? <div className="absolute right-4 top-14 z-40 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-4 shadow-xl" role="menu"><p className="truncate font-semibold text-ink">{user?.email}</p><p className="mt-1 text-sm text-muted">{organization.name} · {locationLabel}</p><button className="mt-4 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-slate-50" type="button" onClick={openSettings}><Settings className="h-4 w-4" />Settings</button><button className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50" type="button" onClick={() => void signOut()}><LogOut className="h-4 w-4" />Sign out</button></div> : null}
            </div>

            <div className="hidden items-center justify-between gap-4 px-5 py-3 xl:flex">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">Operations workspace</p>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">{currentSectionLabel}</h2>
              </div>
              <div className="relative flex items-center gap-3">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  type="button"
                  onClick={() => setDesktopSidebarCollapsed((current) => !current)}
                  title={desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {desktopSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  {desktopSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                </button>
                <div className="rounded-2xl border border-line bg-slate-50 px-3 py-2.5">
                  {locations.length > 1 ? (
                    <select className="input min-w-56" value={currentLocation?.id ?? ""} onChange={handleLocationChange}>
                      {locations.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <MapPin className="h-4 w-4 text-muted" />
                      {locationLabel}
                    </div>
                  )}
                </div>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  type="button"
                  onClick={() => void refreshSession()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh session
                </button>
                <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-ink px-3 py-2 text-sm font-semibold text-white" type="button" aria-expanded={accountMenuOpen} aria-label="Open account menu" onClick={() => setAccountMenuOpen((value) => !value)}><UserCircle className="h-4 w-4" />Account</button>
                {accountMenuOpen ? <div className="absolute right-5 top-16 z-40 w-80 rounded-2xl border border-line bg-white p-4 shadow-xl" role="menu"><p className="truncate font-semibold text-ink">{user?.email}</p><p className="mt-1 text-sm text-muted">{organization.name} · {locationLabel}</p><button className="mt-4 flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-slate-50" type="button" onClick={openSettings}><Settings className="h-4 w-4" />Settings</button><Link className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:bg-slate-50" to="/"><ExternalLink className="h-4 w-4" />Public site</Link><button className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50" type="button" onClick={() => { setAccountMenuOpen(false); void signOut(); }}><LogOut className="h-4 w-4" />Sign out</button></div> : null}
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1760px] px-4 py-4 sm:px-5 lg:px-6 xl:h-[calc(100dvh-4.5rem)] xl:overflow-y-auto xl:px-8">
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
        <div className="fixed inset-0 z-30 xl:hidden">
          <button className="absolute inset-0 bg-slate-900/35" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
          <div className="absolute left-0 top-0 flex h-full w-[86%] max-w-sm flex-col border-r border-line bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted">Workspace</p>
                <h2 className="mt-1 text-lg font-bold text-ink">{currentSectionLabel}</h2>
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

            <nav className="mt-6 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" aria-label="Workspace navigation">
              {visibleNavigationGroups.map((group) => (
                <section key={group.label} aria-labelledby={`mobile-navigation-${group.label.replaceAll(" ", "-").replaceAll("&", "and")}`}>
                  <p id={`mobile-navigation-${group.label.replaceAll(" ", "-").replaceAll("&", "and")}`} className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <NavItem key={item.to} to={item.to} label={item.label} icon={<item.icon className="h-5 w-5" />} badge={item.to === "/app/reorder-plan" ? operationalAttention.reorder : undefined} onClick={() => setMobileNavOpen(false)} />
                    ))}
                  </div>
                </section>
              ))}
            </nav>

            <div className="mt-4 shrink-0 space-y-2 border-t border-line pt-4">
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
      {settingsOpen && settingsDraft ? <Modal title="Restaurant location settings" size="large" onClose={() => setSettingsOpen(false)}><div className="mx-auto max-w-5xl space-y-5">{settingsError ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{settingsError}</p> : null}<div className="grid gap-4 lg:grid-cols-3"><section className="rounded-2xl border border-line bg-slate-50 p-4 lg:col-span-2"><p className="text-xs font-bold uppercase tracking-wide text-muted">Restaurant details and address</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{([['name','Location name'],['addressLine1','Address'],['addressLine2','Address line 2'],['city','City'],['region','Province / state'],['postalCode','Postal / ZIP code'],['country','Country']] as const).map(([field,label]) => <label key={field} className="block"><span className="text-sm font-semibold text-ink">{label}</span><input className="input mt-1" value={settingsDraft[field] ?? ""} onChange={(event) => setSettingsDraft((current) => current ? { ...current, [field]: event.target.value } : current)} /></label>)}</div></section><section className="rounded-2xl border border-line bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Regional settings</p><label className="mt-4 block"><span className="text-sm font-semibold text-ink">Timezone (IANA)</span><input className="input mt-1" value={settingsDraft.timezone ?? ""} onChange={(event) => setSettingsDraft((current) => current ? { ...current, timezone: event.target.value } : current)} placeholder="America/Toronto" /></label></section></div><div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setSettingsOpen(false)}>Cancel</Button><Button type="button" disabled={settingsSaving} onClick={() => void saveSettings()}>{settingsSaving ? 'Saving…' : 'Save settings'}</Button></div></div></Modal> : null}
    </div>
  );
}

