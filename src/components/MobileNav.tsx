import { Menu } from "lucide-react";
import { NavLink } from "react-router-dom";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";

const links = [
  { path: buildDemoPath(defaultDemoProfileSlug), label: "Summary", end: true },
  { path: buildDemoPath(defaultDemoProfileSlug, "invoices"), label: "Invoices" },
  { path: buildDemoPath(defaultDemoProfileSlug, "inventory"), label: "Inventory" },
  { path: buildDemoPath(defaultDemoProfileSlug, "daily-reconciliation"), label: "Reconciliation" },
] as const;

export function MobileNav() {
  const demo = useDemoProfile();

  return (
    <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        <Menu className="h-4 w-4" />
        {demo.customization.restaurantName} pilot
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {links.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
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
