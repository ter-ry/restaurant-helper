interface WorkspaceTab {
  id: string;
  label: string;
  badge?: number | string | null;
  count?: number | string | null;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function WorkspaceTabs({ tabs, value, onChange, className, ariaLabel = "Workspace sections" }: WorkspaceTabsProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`flex flex-wrap gap-2 rounded-2xl border border-line bg-slate-50 p-2 ${className ?? ""}`.trim()}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const tabBadge = tab.badge ?? tab.count;
        return (
          <button
            key={tab.id}
            aria-selected={active}
            aria-label={tab.label}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              active ? "bg-white text-ink shadow-soft" : "text-muted hover:bg-white/70 hover:text-ink"
            }`}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            {tabBadge !== undefined && tabBadge !== null ? <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-brand-50 text-brand-700" : "bg-slate-200 text-muted"}`}>{tabBadge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
