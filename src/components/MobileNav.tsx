import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  return (
    <>
      <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{demo.customization.restaurantName}</p>
            <p className="text-xs text-muted">Restaurant operations</p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-ink"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-slate-950/45 lg:hidden" onMouseDown={() => setOpen(false)}>
          <div className="ml-auto flex h-full w-[86vw] max-w-xs flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <div>
                <p className="text-sm font-bold text-ink">Flowtally</p>
                <p className="text-xs text-muted">{demo.customization.restaurantName}</p>
              </div>
              <button
                type="button"
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-ink"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {links.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={"end" in item ? item.end : false}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ${
                      isActive ? "bg-ink text-white" : "bg-slate-100 text-slate-700"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
