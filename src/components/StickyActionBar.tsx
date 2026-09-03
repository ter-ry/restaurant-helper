import type { ReactNode } from "react";

interface StickyActionBarProps {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  testId?: string;
}

export function StickyActionBar({ children, hint, className = "", testId }: StickyActionBarProps) {
  return (
    <div className={`sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-white/95 px-3 py-2 shadow-soft backdrop-blur ${className}`} data-testid={testId}>
      {hint ? <p className="text-xs font-semibold text-muted">{hint}</p> : <span />}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
