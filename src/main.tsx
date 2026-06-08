import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect } from "react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import "./styles.css";
import { DashboardPage } from "./pages/DashboardPage";
import { InvoiceUploadPage } from "./pages/InvoiceUploadPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LandingPage } from "./pages/LandingPage";
import { PilotPage } from "./pages/PilotPage";
import { PriceChangesPage } from "./pages/PriceChangesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
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
      { path: "upload", element: <InvoiceUploadPage /> },
      { path: "suppliers", element: <SuppliersPage /> },
      { path: "items", element: <ItemsPage /> },
      { path: "price-changes", element: <PriceChangesPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
];

const router = createBrowserRouter(routes, routerBasename ? { basename: routerBasename } : undefined);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

