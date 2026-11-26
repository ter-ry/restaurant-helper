import type { ReactNode } from "react";

interface CompactFieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
}

/** Shared compact field chrome for authenticated operational forms. */
export function CompactField({ label, children, hint, className = "", labelClassName = "" }: CompactFieldProps) {
  return (
    <label className={`compact-field block min-w-0 ${className}`.trim()}>
      <span className={`compact-field-label text-xs font-semibold text-ink ${labelClassName}`.trim()}>{label}</span>
      {children}
      {hint ? <span className="compact-field-hint mt-1 block text-[11px] leading-4 text-muted">{hint}</span> : null}
    </label>
  );
}

interface CompactFieldGroupProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CompactFieldGroup({ label, children, className = "" }: CompactFieldGroupProps) {
  return (
    <div className={`compact-field-group min-w-0 ${className}`.trim()} role="group" aria-label={typeof label === "string" ? label : undefined}>
      <span className="compact-field-label text-xs font-semibold text-ink">{label}</span>
      <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,7rem)] gap-2">{children}</div>
    </div>
  );
}
