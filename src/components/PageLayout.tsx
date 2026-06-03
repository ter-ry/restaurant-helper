import type { ReactNode } from "react";

interface PageLayoutProps {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
}

export function PageLayout({ title, eyebrow = "Sample Cafe", description, children }: PageLayoutProps) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        <div className="mb-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-normal text-ink">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}
