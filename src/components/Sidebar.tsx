import { CalendarDays, ChefHat, ClipboardList, Gauge, FileText, Package } from "lucide-react";
import { NavLink } from "react-router-dom";
import { FlowtallyMark } from "./FlowtallyMark";
import { buildDemoPath, defaultDemoProfileSlug, useDemoProfile } from "../lib/demoProfile";

const navGroups = [
  {
    label: "Overview",
    items: [{ path: buildDemoPath(defaultDemoProfileSlug), label: "Dashboard", icon: Gauge, end: true }],
  },
  {
    label: "Operations",
    items: [
      { path: buildDemoPath(defaultDemoProfileSlug, "purchases"), label: "Purchases", icon: FileText },
      { path: buildDemoPath(defaultDemoProfileSlug, "inventory"), label: "Inventory", icon: Package },
      { path: buildDemoPath(defaultDemoProfileSlug, "menu-costing"), label: "Menu & Costing", icon: ChefHat },
      { path: buildDemoPath(defaultDemoProfileSlug, "schedule"), label: "Schedule", icon: CalendarDays },
    ],
  },
  {
    label: "Finance",
    items: [{ path: buildDemoPath(defaultDemoProfileSlug, "close-reports"), label: "Close & Reports", icon: ClipboardList }],
  },
] as const;

export function Sidebar() {
  const demo = useDemoProfile();

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-line bg-white p-5 lg:block">
      <NavLink to="/" className="flex items-center gap-3 rounded-lg text-ink">
        <FlowtallyMark className="h-10 w-10 shrink-0" />
        <span>
          <span className="block text-sm font-bold">Flowtally</span>
          <span className="block text-xs text-muted">{demo.customization.restaurantName} restaurant operations</span>
        </span>
      </NavLink>
      <nav className="mt-8 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-muted">{group.label}</p>
            <div className="mt-2 space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={"end" in item ? item.end : false}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                        isActive ? "bg-slate-100 text-ink" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-8 rounded-lg border border-line bg-slate-50 p-4">
        <p className="text-sm font-bold text-ink">Restaurant operations</p>
        <p className="mt-1 text-xs leading-5 text-muted">Single-restaurant demo data stored locally in this browser.</p>
      </div>
    </aside>
  );
}
