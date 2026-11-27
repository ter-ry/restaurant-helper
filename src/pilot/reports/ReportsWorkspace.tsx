import { useMemo, useState } from "react";
import { Download, Info, TrendingDown, TrendingUp } from "lucide-react";
import { calendarWeekRange, customRange, lastSevenDaysRange, rangeLabel, type ReportDateRange, type ReportRangePreset } from "./reportDateRange";

export type ReportAvailability = "available" | "partial" | "unavailable" | "zero";
export type ReportSection = "overview" | "sales" | "purchases" | "inventory" | "exports";

export type ReportMetric = {
  label: string;
  value: string;
  availability?: ReportAvailability;
  helper?: string;
  change?: { value: string; direction: "up" | "down" | "flat" };
};

export type ReportTrendPoint = {
  label: string;
  value: number | null;
  displayValue?: string;
};

export type ReportsWorkspaceSnapshot = {
  generatedAt?: string;
  salesStatus: ReportAvailability;
  salesStatusMessage?: string;
  overview: { metrics: ReportMetric[]; salesTrend: ReportTrendPoint[]; purchaseTrend: ReportTrendPoint[] };
  sales: { metrics: ReportMetric[]; byItem: Array<{ label: string; value: string; helper?: string }> };
  purchases: { metrics: ReportMetric[]; receivedSpendLabel?: string; pendingSpendLabel?: string; historyCountLabel?: string };
  inventory: { metrics: ReportMetric[]; exceptions: Array<{ label: string; value: string; helper?: string }> };
  exports: { bookkeepingReady: boolean; auditReady: boolean; historyReady: boolean; notes: string[] };
};

type ReportsWorkspaceProps = {
  today: string;
  initialRange?: ReportDateRange;
  snapshot: ReportsWorkspaceSnapshot;
  initialSection?: ReportSection;
  onRangeChange?: (range: ReportDateRange) => void;
  onExport?: (kind: "bookkeeping" | "history" | "audit") => void;
};

const sections: Array<{ id: ReportSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Sales" },
  { id: "purchases", label: "Purchases" },
  { id: "inventory", label: "Inventory" },
  { id: "exports", label: "Exports" },
];

function StateNotice({ status, message }: { status: ReportAvailability; message?: string }) {
  if (status === "available") return null;
  const title = status === "partial" ? "Partially verified data" : status === "zero" ? "Confirmed zero" : "Data unavailable";
  return <div role="status" className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{title}.</strong> {message ?? (status === "zero" ? "The authoritative source confirms no activity in this period." : "The authoritative source did not provide a complete figure for this period. We do not show it as zero.")}</span></div>;
}

function MetricCard({ metric }: { metric: ReportMetric }) {
  const change = metric.change;
  return <article className="rounded-xl border border-line bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{metric.label}</p><p className="mt-2 text-2xl font-bold text-ink">{metric.value}</p>{metric.helper ? <p className="mt-1 text-xs text-muted">{metric.helper}</p> : null}{change ? <p className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${change.direction === "down" ? "text-emerald-700" : change.direction === "up" ? "text-rose-700" : "text-muted"}`}>{change.direction === "down" ? <TrendingDown className="h-3.5 w-3.5" /> : change.direction === "up" ? <TrendingUp className="h-3.5 w-3.5" /> : null}{change.value}</p> : null}</article>;
}

function TrendChart({ title, points, unavailable }: { title: string; points: ReportTrendPoint[]; unavailable?: boolean }) {
  const values = points.map((point) => point.value).filter((value): value is number => value != null && Number.isFinite(value));
  const max = Math.max(...values, 0);
  return <section className="rounded-xl border border-line bg-white p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-ink">{title}</h3><span className="text-xs text-muted">{points.length} periods</span></div>{unavailable ? <p className="mt-6 text-sm text-muted">Chart unavailable until the selected period is fully verified.</p> : values.length === 0 ? <p className="mt-6 text-sm text-muted">No activity confirmed for this period.</p> : <><div className="mt-5 flex h-36 items-end gap-1 border-b border-line px-1" aria-label={`${title} chart`}>{points.map((point) => <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${point.label}: ${point.displayValue ?? point.value}`}><div className="w-full max-w-8 rounded-t bg-teal-600" style={{ height: `${Math.max(4, ((point.value ?? 0) / max) * 100)}%` }} /><span className="max-w-full truncate text-[10px] text-muted">{point.label}</span></div>)}</div><p className="mt-3 text-xs text-muted">Bars use authoritative values only; unavailable points are left empty.</p></>}</section>;
}

function DateRangePicker({ today, value, onChange }: { today: string; value: ReportDateRange; onChange: (range: ReportDateRange) => void }) {
  const [preset, setPreset] = useState<ReportRangePreset>(value.preset);
  const selectPreset = (next: ReportRangePreset) => { setPreset(next); if (next === "this-week") onChange(calendarWeekRange(today)); if (next === "last-7-days") onChange(lastSevenDaysRange(today)); };
  return <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-muted">Date range<select aria-label="Report date range" className="input mt-1 min-w-40" value={preset} onChange={(event) => selectPreset(event.target.value as ReportRangePreset)}><option value="this-week">This week</option><option value="last-7-days">Last 7 days</option><option value="custom">Custom range</option></select></label>{preset === "custom" ? <><label className="text-xs font-semibold text-muted">From<input aria-label="Report start date" className="input mt-1" type="date" value={value.startDate} onChange={(event) => onChange(customRange(event.target.value, value.endDate))} /></label><label className="text-xs font-semibold text-muted">To<input aria-label="Report end date" className="input mt-1" type="date" value={value.endDate} onChange={(event) => onChange(customRange(value.startDate, event.target.value))} /></label></> : null}</div>;
}

function SectionBody({ section, snapshot, onExport }: { section: ReportSection; snapshot: ReportsWorkspaceSnapshot; onExport?: ReportsWorkspaceProps["onExport"] }) {
  if (section === "exports") return <div className="grid gap-4 md:grid-cols-3">{(["bookkeeping", "history", "audit"] as const).map((kind) => { const ready = kind === "bookkeeping" ? snapshot.exports.bookkeepingReady : kind === "history" ? snapshot.exports.historyReady : snapshot.exports.auditReady; const label = kind === "bookkeeping" ? "Bookkeeping export" : kind === "history" ? "All-status purchase history" : "Audit export"; return <article key={kind} className="rounded-xl border border-line bg-white p-4"><h3 className="font-semibold text-ink">{label}</h3><p className="mt-2 text-sm text-muted">{ready ? "Ready for the selected date range." : "Not ready: review the completeness notes below."}</p><button type="button" aria-label={`Export ${label}`} disabled={!ready} onClick={() => onExport?.(kind)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" />Export</button></article>; })}<div className="md:col-span-3 rounded-xl border border-line bg-slate-50 p-4"><h3 className="font-semibold text-ink">Export completeness</h3><ul className="mt-2 space-y-1 text-sm text-muted">{snapshot.exports.notes.map((note) => <li key={note}>• {note}</li>)}</ul></div></div>;
  const content = section === "overview" ? snapshot.overview : section === "sales" ? snapshot.sales : section === "purchases" ? snapshot.purchases : snapshot.inventory;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{content.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div>{section === "overview" ? <div className="grid gap-4 lg:grid-cols-2"><TrendChart title="Sales trend" points={snapshot.overview.salesTrend} unavailable={snapshot.salesStatus === "unavailable" || snapshot.salesStatus === "partial"} /><TrendChart title="Received purchases" points={snapshot.overview.purchaseTrend} /></div> : null}{section === "sales" ? <div className="rounded-xl border border-line bg-white p-4"><h3 className="font-semibold text-ink">Sales by item</h3><div className="mt-3 divide-y divide-line">{snapshot.sales.byItem.map((row) => <div key={row.label} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="font-medium text-ink">{row.label}<span className="ml-2 text-xs text-muted">{row.helper}</span></span><span className="font-semibold text-ink">{row.value}</span></div>)}</div></div> : null}{section === "purchases" ? <div className="grid gap-3 sm:grid-cols-3"><MetricCard metric={{ label: "Received spend", value: snapshot.purchases.receivedSpendLabel ?? "Unavailable" }} /><MetricCard metric={{ label: "Pending review", value: snapshot.purchases.pendingSpendLabel ?? "Unavailable", helper: "Excluded from bookkeeping export" }} /><MetricCard metric={{ label: "Purchase history", value: snapshot.purchases.historyCountLabel ?? "Unavailable", helper: "All statuses, including corrections" }} /></div> : null}{section === "inventory" ? <div className="rounded-xl border border-line bg-white p-4"><h3 className="font-semibold text-ink">Inventory exceptions</h3><div className="mt-3 divide-y divide-line">{snapshot.inventory.exceptions.map((row) => <div key={row.label} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="font-medium text-ink">{row.label}<span className="ml-2 text-xs text-muted">{row.helper}</span></span><span className="font-semibold text-ink">{row.value}</span></div>)}</div></div> : null}</div>;
}

export function ReportsWorkspace({ today, initialRange = calendarWeekRange(today), snapshot, initialSection = "overview", onRangeChange, onExport }: ReportsWorkspaceProps) {
  const [section, setSection] = useState(initialSection);
  const [range, setRange] = useState(initialRange);
  const updateRange = (next: ReportDateRange) => { setRange(next); onRangeChange?.(next); };
  const title = useMemo(() => sections.find((item) => item.id === section)?.label ?? "Overview", [section]);
  return <div className="workspace-page" data-testid="reports-workspace"><header className="surface-panel rounded-2xl border p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Reports</p><h1 className="mt-2 text-3xl font-bold text-ink">{title}</h1><p className="mt-2 text-sm text-muted">Applied range: <strong className="text-ink">{rangeLabel(range)}</strong></p></div><DateRangePicker today={today} value={range} onChange={updateRange} /></div><nav aria-label="Report sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">{sections.map((item) => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${section === item.id ? "border-teal-600 text-teal-700" : "border-transparent text-muted"}`}>{item.label}</button>)}</nav></header><StateNotice status={snapshot.salesStatus} message={snapshot.salesStatusMessage} /><SectionBody section={section} snapshot={snapshot} onExport={onExport} /></div>;
}

