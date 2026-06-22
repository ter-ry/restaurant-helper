import { CalendarClock, FileText, Receipt, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";

export function CloseReportsPage() {
  return (
    <PageLayout
      title="Close & Reports"
      eyebrow="Demo shell / Back Office Core"
      description="The close-and-reporting hub for the next phase. Daily reconciliation and reporting stay accessible here while the detailed redesign is still in progress."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Daily close</p>
              <p className="text-xs text-muted">Enter platform totals, compare against POS, and capture variance notes.</p>
            </div>
          </div>
          <Link
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            to="../daily-reconciliation"
          >
            Open daily close
          </Link>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Reports and export</p>
              <p className="text-xs text-muted">Review variance history, supplier/category spend, and accountant-ready CSV exports.</p>
            </div>
          </div>
          <Link
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50"
            to="../reports"
          >
            Open reports
          </Link>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <SectionHeader
          title="MVP focus"
          description="QuickBooks sync stays future-only for now. The MVP target is a clear accountant-ready CSV and a clean review flow."
        />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">Daily reconciliation</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">Balanced or Needs Review, with variance history preserved locally.</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">Accounting export</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">QuickBooks-ready CSV export for the owner or bookkeeper.</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-sm font-bold text-ink">Monthly summary</p>
            <p className="mt-1 text-sm leading-6 text-slate-700">Supplier spend, category spend, and close history in one place.</p>
          </div>
        </div>
      </Card>

      <Card className="mt-6 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-amber-50 p-2 text-amber-700">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold text-ink">Future placeholder</p>
            <p className="text-xs text-muted">QuickBooks sync can be shown later once the export workflow is proven.</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">
          For this phase, keep the workflow simple: enter the close, review the variance, and export the accounting-ready file.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
          <Receipt className="h-3.5 w-3.5" />
          QuickBooks sync is not part of the MVP
        </div>
      </Card>
    </PageLayout>
  );
}
