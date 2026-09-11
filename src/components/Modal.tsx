import { useEffect, useId, useRef, type ReactNode } from "react";

export function Modal({ title, children, onClose, labelledBy, size = "large" }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string; size?: "small" | "large" | "full" | "fullscreen" }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const generatedHeadingId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest("section");
      const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute("hidden")) : [];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [onClose]);
  const width = size === "small" ? "max-w-lg" : size === "full" ? "max-w-[98vw]" : size === "fullscreen" ? "max-w-none" : "max-w-5xl";
  const shell = size === "fullscreen" ? "h-full max-h-none rounded-none" : "max-h-[calc(100vh-1rem)] rounded-t-3xl sm:rounded-3xl";
  const headingId = labelledBy || generatedHeadingId;
  return <div className={`fixed inset-0 z-50 flex items-end bg-slate-950/35 p-0 ${size === "fullscreen" ? "sm:items-stretch" : "sm:items-center sm:p-2"}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={headingId} className={`w-full ${width} ${shell} overflow-y-auto bg-white shadow-2xl`}>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-4 py-3"><h2 id={headingId} className="text-lg font-bold text-ink">{title}</h2><button ref={closeRef} type="button" aria-label={`Close ${title}`} onClick={onClose} className="min-h-10 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-slate-100 hover:text-ink">Close</button></header>
      <div className="p-4">{children}</div>
    </section>
  </div>;
}
