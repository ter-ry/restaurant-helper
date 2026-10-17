import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "pilot-button-primary bg-ink text-white shadow-sm disabled:bg-ink disabled:text-white disabled:opacity-50 disabled:shadow-none",
  secondary: "pilot-button-secondary border border-line bg-white text-ink disabled:border-line disabled:bg-slate-100 disabled:text-muted disabled:opacity-50",
  ghost: "pilot-button-ghost text-muted disabled:text-muted disabled:opacity-50",
};

export function Button({ children, variant = "primary", icon, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`pilot-button inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
