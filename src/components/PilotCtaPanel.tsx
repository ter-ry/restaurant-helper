import { ArrowRight, FileText, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "./Card";

export function PilotCtaPanel() {
  return (
    <Card className="overflow-hidden border-slate-300 bg-ink text-white">
      <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-100">Early pilot</p>
          <h2 className="mt-2 text-2xl font-bold tracking-normal">Would this invoice cost report be useful?</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Join the pilot list to share interest, or open the demo workspace to try the invoice and reconciliation flow.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-200">
            <span className="rounded-full bg-white/10 px-3 py-1">Join pilot</span>
            <span className="rounded-full bg-white/10 px-3 py-1">View demo</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Send 2-3 sample invoices</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Get a sample cost report</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <Link
            to="/pilot"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-brand-50"
          >
            <Send className="h-4 w-4 text-brand-700" />
            Join pilot
          </Link>
          <Link
            to="/demo"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white transition hover:border-brand-100 hover:bg-white/10"
          >
            <FileText className="h-4 w-4 text-brand-100" />
            View demo
          </Link>
          <Link
            to="/#contact"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white transition hover:border-brand-100 hover:bg-white/10"
          >
            <FileText className="h-4 w-4 text-brand-100" />
            Ask about reports
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
