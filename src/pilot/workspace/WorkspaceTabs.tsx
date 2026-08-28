import type { ReactNode } from "react";

export interface WorkspaceTabItem {
  id: string;
  label: string;
  badge?: ReactNode;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function WorkspaceTabs({ tabs, value, onChange, className = "" }: WorkspaceTabsProps) {
  return (
    <div className={`flex flex-wrap gap-2 rounded-2xl border border-line bg-slate-50 p-2 ${className}`}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              active ? "bg-ink text-white shadow-sm" : "bg-white text-muted hover:bg-brand-50 hover:text-ink"
            }`}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={active}
          >
            <span>{tab.label}</span>
            {tab.badge ? <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/15 text-white" : "bg-slate-100 text-muted"}`}>{tab.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
