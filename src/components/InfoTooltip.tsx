import { Info } from "lucide-react";
import { useState } from "react";

export function InfoTooltip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <span>{label}</span>
      <button
        type="button"
        aria-label={`Explain ${label}`}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-slate-200 hover:text-ink focus-visible:outline"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setOpen(false)}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open ? <span role="tooltip" className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg border border-line bg-ink px-3 py-2 text-left text-xs font-medium normal-case tracking-normal text-white shadow-lg">{children}</span> : null}
    </span>
  );
}
