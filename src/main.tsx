import React, { Suspense, lazy, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, isRouteErrorResponse, Link, Navigate, RouterProvider, useLocation, useParams, useRouteError } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { PilotWorkspaceProvider } from "./lib/pilotWorkspace";
import { buildDemoPath, defaultDemoProfileSlug, isDemoProfileSlug } from "./data/demoProfiles";
import { initAnalytics, trackPageView } from "./lib/analytics";
import { PilotSessionProvider } from "./pilot/PilotSessionProvider";
import { PilotAppGate } from "./pilot/PilotAppGate";
import { PilotWorkspaceLayout } from "./pilot/PilotWorkspaceLayout";
import { pilotAppEnabled } from "./pilot/pilotConfig";

const lazyNamed = (factory: () => Promise<any>, exportName: string) =>
  lazy(async () => {
    const module = await factory();
    return { default: module[exportName] as React.ComponentType<any> };
  });

const DailyReconciliationPage = lazyNamed(() => import("./pages/DailyReconciliationPage"), "DailyReconciliationPage");
const OwnerDashboardPage = lazyNamed(() => import("./pages/OwnerDashboardPage"), "OwnerDashboardPage");
const InvoiceUploadPage = lazyNamed(() => import("./pages/InvoiceUploadPage"), "InvoiceUploadPage");
const InventoryPage = lazyNamed(() => import("./pages/InventoryPageNew"), "InventoryPage");
const LandingPage = lazyNamed(() => import("./pages/LandingPage"), "LandingPage");
const PilotPage = lazyNamed(() => import("./pages/PilotPage"), "PilotPage");
const MenuCostingPage = lazyNamed(() => import("./pages/MenuCostingPage"), "MenuCostingPage");
const ReportsPage = lazyNamed(() => import("./pages/ReportsPage"), "ReportsPage");
const CloseReportsPage = lazyNamed(() => import("./pages/CloseReportsPage"), "CloseReportsPage");
const SchedulePage = lazyNamed(() => import("./pages/SchedulePage"), "SchedulePage");
const PilotLoginPage = lazyNamed(() => import("./pilot/PilotLoginPage"), "PilotLoginPage");
const PilotDashboardPage = lazyNamed(() => import("./pilot/PilotDashboardPage"), "PilotDashboardPage");
const PilotPurchasesPage = lazyNamed(() => import("./pilot/PilotPurchasesPage"), "PilotPurchasesPage");
const PilotInventoryPage = lazyNamed(() => import("./pilot/PilotInventoryPage"), "PilotInventoryPage");
const PilotMenuCostingPage = lazyNamed(() => import("./pilot/PilotMenuCostingPage"), "PilotMenuCostingPage");
const PilotSquareUsagePage = lazyNamed(() => import("./pilot/PilotSquareUsagePage"), "PilotSquareUsagePage");
const PilotStockCountsPage = lazyNamed(() => import("./pilot/PilotStockCountsPage"), "PilotStockCountsPage");
const PilotReorderPlanPage = lazyNamed(() => import("./pilot/PilotReorderPlanPage"), "PilotReorderPlanPage");
const GoogleAuthCompletePage = lazyNamed(() => import("./pages/GoogleAuthCompletePage"), "GoogleAuthCompletePage");
const InvitationAcceptPage = lazyNamed(() => import("./pages/InvitationAcceptPage"), "InvitationAcceptPage");
const TeamManagementPage = lazyNamed(() => import("./pages/TeamManagementPage"), "TeamManagementPage");
const OwnerAuditPage = lazyNamed(() => import("./pages/OwnerAuditPage"), "OwnerAuditPage");
const SetupConsolePage = lazyNamed(() => import("./pages/SetupConsolePage"), "SetupConsolePage");
const DataMigrationPage = lazyNamed(() => import("./pages/DataMigrationPage"), "DataMigrationPage");
const SquareIntegrationPage = lazyNamed(() => import("./pages/SquareIntegrationPage"), "SquareIntegrationPage");

function HashScroll() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document
        .querySelector(location.hash)
        ?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    });
  }, [location.pathname, location.hash]);

  return null;
}

function RouteScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  return null;
}

function AnalyticsRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
}

function TrackedNavigate({ to }: { to: string }) {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
    trackPageView(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return <Navigate to={to} replace />;
}

function PageWithHashScroll({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalyticsRouteTracker />
      <RouteScrollToTop />
      <HashScroll />
      {children}
    </>
  );
}

function RouteLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-soft">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">Loading workspace…</h1>
        <p className="mt-2 text-sm leading-6 text-muted">We’re loading the selected route and shared application state.</p>
      </div>
    </div>
  );
}

function DemoShell() {
  const params = useParams();

  if (!isDemoProfileSlug(params.profile)) {
    return <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace />;
  }

  return <AppShell />;
}

function DemoRouteErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "The demo workspace could not finish loading.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="max-w-xl rounded-2xl border border-line bg-white p-6 text-left shadow-soft">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally demo</p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Something went wrong while loading the pilot</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          The page hit a recoverable issue. If this happened because of a legacy local record, reloading the browser usually fixes it after the data is cleaned up.
        </p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to={buildDemoPath(defaultDemoProfileSlug)}>
            Return to summary
          </Link>
        </div>
      </div>
    </div>
  );
}

function normalizeRouterBasename(baseUrl: string | undefined) {
  const trimmed = baseUrl?.trim();

  if (!trimmed || trimmed === "/" || trimmed === "." || trimmed === "./" || trimmed === "/./") {
    return undefined;
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");

  return withoutTrailingSlash === "" || withoutTrailingSlash === "/." ? undefined : withoutTrailingSlash;
}

const routerBasename = normalizeRouterBasename(import.meta.env.BASE_URL);

const demoChildren = [
  { index: true, element: <OwnerDashboardPage /> },
  { path: "purchases", element: <InvoiceUploadPage /> },
  { path: "invoices", element: <Navigate to="../purchases" replace /> },
  { path: "inventory", element: <InventoryPage /> },
  { path: "menu-costing", element: <MenuCostingPage /> },
  { path: "schedule", element: <SchedulePage /> },
  { path: "close-reports", element: <CloseReportsPage /> },
  { path: "daily-reconciliation", element: <DailyReconciliationPage /> },
  { path: "reports", element: <ReportsPage /> },
  { path: "price-tracker", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "monthly-report", element: <Navigate to="../reports" replace /> },
  { path: "settings", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
];

const pilotAppRoutes = pilotAppEnabled
  ? [
      { path: "/app/login", element: <PilotLoginPage /> },
      {
        path: "/app",
        element: <PilotAppGate />,
        children: [
          {
            element: <PilotWorkspaceLayout />,
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: "dashboard", element: <PilotDashboardPage /> },
              { path: "purchases", element: <PilotPurchasesPage /> },
              { path: "inventory", element: <PilotInventoryPage /> },
              { path: "menu-costing", element: <PilotMenuCostingPage /> },
              { path: "square-usage", element: <PilotSquareUsagePage /> },
              { path: "stock-counts", element: <PilotStockCountsPage /> },
              { path: "reorder-plan", element: <PilotReorderPlanPage /> },
            ],
          },
        ],
      },
    ]
  : [];

const routes = [
  { path: "/", element: <PageWithHashScroll><LandingPage /></PageWithHashScroll> },
  { path: "/auth/google/complete", element: <PageWithHashScroll><GoogleAuthCompletePage /></PageWithHashScroll> },
  { path: "/invite/:token", element: <PageWithHashScroll><InvitationAcceptPage /></PageWithHashScroll> },
  { path: "/owner/team", element: <PageWithHashScroll><TeamManagementPage /></PageWithHashScroll> },
  { path: "/owner/audit", element: <PageWithHashScroll><OwnerAuditPage /></PageWithHashScroll> },
  { path: "/platform/setup", element: <PageWithHashScroll><SetupConsolePage /></PageWithHashScroll> },
  { path: "/imports", element: <PageWithHashScroll><DataMigrationPage /></PageWithHashScroll> },
  { path: "/integrations/square", element: <PageWithHashScroll><SquareIntegrationPage /></PageWithHashScroll> },
  { path: "/pilot", element: <PageWithHashScroll><PilotPage /></PageWithHashScroll> },
  { path: "/pilot/invoices", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "purchases")} replace /> },
  { path: "/pilot/purchases", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "purchases")} replace /> },
  { path: "/pilot/daily-reconciliation", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "daily-reconciliation")} replace /> },
  { path: "/pilot/inventory", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "inventory")} replace /> },
  { path: "/pilot/price-changes", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/demo", element: <TrackedNavigate to={buildDemoPath(defaultDemoProfileSlug)} /> },
  {
    path: "/demo/:profile",
    element: <DemoShell />,
    errorElement: <DemoRouteErrorBoundary />,
    children: demoChildren,
  },
  ...pilotAppRoutes,
];

const router = createBrowserRouter(routes, routerBasename ? { basename: routerBasename } : undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PilotWorkspaceProvider>
      <PilotSessionProvider>
        <Suspense fallback={<RouteLoadingScreen />}>
          <RouterProvider router={router} />
        </Suspense>
      </PilotSessionProvider>
    </PilotWorkspaceProvider>
  </React.StrictMode>,
);

