import { Outlet } from "react-router-dom";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

export function AppShell() {
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
