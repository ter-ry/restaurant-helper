import { ArrowRight, Layers3, ReceiptText, Sparkles } from "lucide-react";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";

export function MenuCostingPage() {
  return (
    <PageLayout
      title="Menu & Costing"
      eyebrow="Demo shell / Back Office Core"
      description="Phase 1 placeholder for menu item costing, recipe mapping, and Square-ready POS concepts. The real costing workflow will be added in a later step."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <ReceiptText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Menu items</p>
              <p className="text-xs text-muted">Placeholder for the menu list and cost summary.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <Layers3 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Recipes</p>
              <p className="text-xs text-muted">Placeholder for ingredient mapping and estimated item cost.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Square-ready demo</p>
              <p className="text-xs text-muted">Placeholder for POS item to recipe mapping without a live API.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <SectionHeader
          title="Coming next"
          description="This page will become the demo-real costing workspace after the shell is in place."
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-muted">
              <ArrowRight className="h-3.5 w-3.5" />
              Placeholder only
            </div>
          }
        />
        <ul className="grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
          <li className="rounded-lg border border-line bg-slate-50 p-4">Menu item to recipe ingredients</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Current ingredient cost and estimated item cost</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Margin summary for each menu item</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Square-ready POS mapping preview</li>
        </ul>
      </Card>
    </PageLayout>
  );
}
