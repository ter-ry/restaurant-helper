import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: string;
  helper?: string;
  icon?: ReactNode;
  to?: string;
  state?: unknown;
}

export function StatCard({ label, value, helper, icon, to, state }: StatCardProps) {
  const content = (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-normal text-ink">{value}</p>
          {helper ? <p className="mt-1 text-xs text-muted">{helper}</p> : null}
        </div>
        {icon ? <div className="rounded-lg bg-slate-100 p-2 text-brand-700">{icon}</div> : null}
      </div>
    </Card>
  );

  if (!to) {
    return content;
  }

  return (
    <Link className="group block rounded-2xl transition hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus:ring-2 focus:ring-brand-200" to={to} state={state}>
      {content}
      <span className="sr-only">Open {label}</span>
    </Link>
  );
}
