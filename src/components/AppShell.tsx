import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { initAnalytics, trackPageView } from "../lib/analytics";

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

export function AppShell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  return (
    <div className="flex min-h-screen bg-slate-50 overflow-x-hidden">
      <AnalyticsRouteTracker />
      <Sidebar />
      <div className="min-w-0 flex-1 lg:pl-72">
        <MobileNav />
        <Outlet />
      </div>
    </div>
  );
}
