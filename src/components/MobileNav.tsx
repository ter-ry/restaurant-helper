import { Menu } from "lucide-react";
import { NavLink } from "react-router-dom";

const links = [
  ["/app", "Dashboard"],
  ["/app/upload", "Upload"],
  ["/app/suppliers", "Suppliers"],
  ["/app/items", "Items"],
  ["/app/price-changes", "Prices"],
  ["/app/reports", "Reports"],
  ["/app/settings", "Settings"],
];

export function MobileNav() {
  return (
    <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        <Menu className="h-4 w-4" />
        Sample Cafe Cost-Control
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/app"}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                isActive ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
