import {
  BarChart3,
  FileUp,
  Gauge,
  LineChart,
  PackageSearch,
  Settings,
  Store,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { FlowtallyMark } from "./FlowtallyMark";

const navItems = [
  { to: "/app", label: "Dashboard", icon: Gauge },
  { to: "/app/upload", label: "Upload Invoice", icon: FileUp },
  { to: "/app/suppliers", label: "Suppliers", icon: Store },
  { to: "/app/items", label: "Items", icon: PackageSearch },
  { to: "/app/price-changes", label: "Price Changes", icon: LineChart },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-line bg-white p-5 lg:block">
      <NavLink to="/" className="flex items-center gap-3 rounded-lg text-ink">
        <FlowtallyMark className="h-10 w-10 shrink-0" />
        <span>
          <span className="block text-sm font-bold">Cost-Control</span>
          <span className="block text-xs text-muted">Sample Cafe</span>
        </span>
      </NavLink>
      <nav className="mt-8 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="mt-8 rounded-lg border border-line bg-slate-50 p-4">
        <p className="text-sm font-bold text-ink">MVP Demo</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Demo data now. The value story is cost changes, supplier spend, and action-ready reports.
        </p>
      </div>
    </aside>
  );
}
