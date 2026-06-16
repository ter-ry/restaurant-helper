import type { ReactNode } from "react";
import { useDemoProfile } from "../lib/demoProfile";

interface PageLayoutProps {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
}

export function PageLayout({ title, eyebrow, description, children }: PageLayoutProps) {
  const demo = useDemoProfile();
  const resolvedEyebrow = eyebrow ?? `${demo.customization.restaurantName} / ${demo.period}`;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        <div className="mb-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">{resolvedEyebrow}</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-bold tracking-normal text-ink">{title}</h1>
            <span className="inline-flex w-fit items-center rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">
              {demo.sampleLabel}
            </span>
          </div>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {demo.customization.restaurantName} in {demo.customization.city} - Primary supplier: {demo.customization.primarySupplier}
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
