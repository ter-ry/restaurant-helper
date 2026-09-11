import type { ReactNode } from "react";

export interface WorkspaceMetric {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
}

interface WorkspacePageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  metrics?: WorkspaceMetric[];
  className?: string;
}

export function WorkspacePageHeader({ eyebrow, title, description, actions, metrics, className = "" }: WorkspacePageHeaderProps) {
  return (
    <section className={`surface-panel rounded-2xl border border-line bg-white p-3 shadow-soft sm:p-4 ${className}`}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-brand-700">{eyebrow}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      {metrics?.length ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-line bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{metric.label}</p>
              <p className="mt-1 min-w-0 text-lg font-bold text-ink">{metric.value}</p>
              {metric.helper ? <p className="mt-1 text-xs leading-5 text-muted">{metric.helper}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
