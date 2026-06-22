import { Menu } from "lucide-react";
import { NavLink } from "react-router-dom";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";

const links = [
  { path: buildDemoPath(defaultDemoProfileSlug), label: "Dashboard", end: true },
  { path: buildDemoPath(defaultDemoProfileSlug, "purchases"), label: "Purchases" },
  { path: buildDemoPath(defaultDemoProfileSlug, "inventory"), label: "Inventory" },
  { path: buildDemoPath(defaultDemoProfileSlug, "menu-costing"), label: "Menu & Costing" },
  { path: buildDemoPath(defaultDemoProfileSlug, "schedule"), label: "Schedule" },
  { path: buildDemoPath(defaultDemoProfileSlug, "close-reports"), label: "Close & Reports" },
] as const;

export function MobileNav() {
  const demo = useDemoProfile();

  return (
    <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        <Menu className="h-4 w-4" />
        {demo.customization.restaurantName} back office core
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {links.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              `min-w-0 rounded-full px-3 py-2 text-center text-xs font-semibold leading-4 ${
                isActive ? "bg-ink text-white" : "bg-slate-100 text-slate-700"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
