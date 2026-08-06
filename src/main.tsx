import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect } from "react";
import { createBrowserRouter, isRouteErrorResponse, Link, Navigate, RouterProvider, useLocation, useParams, useRouteError } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { DailyReconciliationPage } from "./pages/DailyReconciliationPage";
import { OwnerDashboardPage } from "./pages/OwnerDashboardPage";
import { InvoiceUploadPage } from "./pages/InvoiceUploadPage";
import { InventoryPage } from "./pages/InventoryPageNew";
import { LandingPage } from "./pages/LandingPage";
import { PilotPage } from "./pages/PilotPage";
import { MenuCostingPage } from "./pages/MenuCostingPage";
import { ReportsPage } from "./pages/ReportsPage";
import { CloseReportsPage } from "./pages/CloseReportsPage";
import { SchedulePage } from "./pages/SchedulePage";
import { PilotWorkspaceProvider } from "./lib/pilotWorkspace";
import { buildDemoPath, defaultDemoProfileSlug, isDemoProfileSlug } from "./data/demoProfiles";
import { initAnalytics, trackPageView } from "./lib/analytics";
import { PilotSessionProvider } from "./pilot/PilotSessionProvider";
import { PilotAppGate } from "./pilot/PilotAppGate";
import { PilotLoginPage } from "./pilot/PilotLoginPage";
import { PilotWorkspaceLayout } from "./pilot/PilotWorkspaceLayout";
import { PilotDashboardPage } from "./pilot/PilotDashboardPage";
import { PilotPurchasesPage } from "./pilot/PilotPurchasesPage";
import { PilotInventoryPage } from "./pilot/PilotInventoryPage";
import { PilotStockCountsPage } from "./pilot/PilotStockCountsPage";
import { PilotReorderPlanPage } from "./pilot/PilotReorderPlanPage";
import { pilotAppEnabled } from "./pilot/pilotConfig";
import { GoogleAuthCompletePage } from "./pages/GoogleAuthCompletePage";

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
        <RouterProvider router={router} />
      </PilotSessionProvider>
    </PilotWorkspaceProvider>
  </React.StrictMode>,
);

