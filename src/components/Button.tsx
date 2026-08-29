import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-brand-700 shadow-sm disabled:bg-ink disabled:text-white disabled:opacity-50 disabled:shadow-none disabled:hover:bg-ink",
  secondary: "border border-line bg-white text-ink hover:border-brand-100 hover:bg-brand-50 disabled:border-line disabled:bg-slate-100 disabled:text-muted disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-slate-100",
  ghost: "text-muted hover:bg-slate-100 hover:text-ink disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted",
};

export function Button({ children, variant = "primary", icon, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
