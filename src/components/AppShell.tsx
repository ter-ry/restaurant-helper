import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search]);

  return (
    <div className="flex min-h-screen bg-slate-50 overflow-x-hidden">
      <Sidebar />
      <div className="min-w-0 flex-1 lg:pl-72">
        <MobileNav />
        <Outlet />
      </div>
    </div>
  );
}
