import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ title, children, onClose, labelledBy, size = "large" }: { title: string; children: ReactNode; onClose: () => void; labelledBy?: string; size?: "small" | "large" | "full" }) {
  const closeRef = useRef<HTMLButtonElement>(null);
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
  const width = size === "small" ? "max-w-lg" : size === "full" ? "max-w-[96rem]" : "max-w-5xl";
  const headingId = labelledBy || "flowtally-modal-title";
  return <div className="fixed inset-0 z-50 flex items-end bg-slate-950/35 p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby={headingId} className={`max-h-[94vh] w-full ${width} overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl`}>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-4"><h2 id={headingId} className="text-lg font-bold text-ink">{title}</h2><button ref={closeRef} type="button" aria-label={`Close ${title}`} onClick={onClose} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-slate-100 hover:text-ink">Close</button></header>
      <div className="p-5">{children}</div>
    </section>
  </div>;
}
