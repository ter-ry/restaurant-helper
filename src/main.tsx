import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { DashboardPage } from "./pages/DashboardPage";
import { InvoiceUploadPage } from "./pages/InvoiceUploadPage";
import { LandingPage } from "./pages/LandingPage";
import { PilotPage } from "./pages/PilotPage";
import { PriceChangesPage } from "./pages/PriceChangesPage";
import { ReportsPage } from "./pages/ReportsPage";
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
  { path: "/pilot", element: <PageWithHashScroll><PilotPage /></PageWithHashScroll> },
  {
    path: "/app",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "invoices", element: <InvoiceUploadPage /> },
      { path: "price-tracker", element: <PriceChangesPage /> },
      { path: "monthly-report", element: <ReportsPage /> },
      { path: "upload", element: <Navigate to="/app/invoices" replace /> },
      { path: "suppliers", element: <Navigate to="/app/price-tracker" replace /> },
      { path: "items", element: <Navigate to="/app/price-tracker" replace /> },
      { path: "price-changes", element: <Navigate to="/app/price-tracker" replace /> },
      { path: "reports", element: <Navigate to="/app/monthly-report" replace /> },
      { path: "settings", element: <Navigate to="/app" replace /> },
    ],
  },
];

const router = createBrowserRouter(routes, routerBasename ? { basename: routerBasename } : undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

