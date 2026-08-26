import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div className={`rounded-2xl border border-line bg-white shadow-soft ${className}`} {...props}>
      {children}
    </div>
  );
}
