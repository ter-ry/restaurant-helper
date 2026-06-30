import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "critical" | "info";

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
}

const tones: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-brand-50 text-brand-700",
  warning: "bg-amber-50 text-caution",
  danger: "bg-red-50 text-danger",
  critical: "bg-red-100 text-red-800 ring-1 ring-red-200",
  info: "bg-slate-100 text-slate-700",
};

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
