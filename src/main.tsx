import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { DailyReconciliationPage } from "./pages/DailyReconciliationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InvoiceUploadPage } from "./pages/InvoiceUploadPage";
import { LandingPage } from "./pages/LandingPage";
import { PriceChangesPage } from "./pages/PriceChangesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PilotWorkspaceProvider } from "./lib/pilotWorkspace";
import { buildDemoPath, defaultDemoProfileSlug, isDemoProfileSlug } from "./data/demoProfiles";
import { initAnalytics, trackPageView } from "./lib/analytics";

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

function AnalyticsRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);

  return null;
}

function PageWithHashScroll({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalyticsRouteTracker />
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

function normalizeRouterBasename(baseUrl: string | undefined) {
  const trimmed = baseUrl?.trim();

  if (!trimmed || trimmed === "/" || trimmed === "." || trimmed === "./" || trimmed === "/./") {
    return undefined;
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");

  return withoutTrailingSlash === "" || withoutTrailingSlash === "/." ? undefined : withoutTrailingSlash;
}

const routerBasename = normalizeRouterBasename(import.meta.env.BASE_URL);

const routes = [
  { path: "/", element: <PageWithHashScroll><LandingPage /></PageWithHashScroll> },
  { path: "/pilot", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/pilot/invoices", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "invoices")} replace /> },
  { path: "/pilot/daily-reconciliation", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "daily-reconciliation")} replace /> },
  { path: "/pilot/price-changes", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/demo", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  {
    path: "/app/demo/:profile",
    element: <DemoShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "daily-reconciliation", element: <DailyReconciliationPage /> },
      { path: "invoices", element: <InvoiceUploadPage /> },
      { path: "price-tracker", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
      { path: "monthly-report", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
      { path: "settings", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
    ],
  },
  { path: "/app/daily-reconciliation", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "daily-reconciliation")} replace /> },
  { path: "/app/invoices", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "invoices")} replace /> },
  { path: "/app/upload", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug, "invoices")} replace /> },
  { path: "/app/price-tracker", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/monthly-report", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/suppliers", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/items", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/price-changes", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/reports", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
  { path: "/app/settings", element: <Navigate to={buildDemoPath(defaultDemoProfileSlug)} replace /> },
];

const router = createBrowserRouter(routes, routerBasename ? { basename: routerBasename } : undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PilotWorkspaceProvider>
      <RouterProvider router={router} />
    </PilotWorkspaceProvider>
  </React.StrictMode>,
);

