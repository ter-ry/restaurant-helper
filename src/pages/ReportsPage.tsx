import { Download, Mail, Wand2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { categorySpend, priceChanges, recommendedActions, reportCards } from "../data/mockData";
import { formatCurrency, formatPercent } from "../utils/format";

export function ReportsPage() {
  const [message, setMessage] = useState("");
  const biggestIncreases = [...priceChanges]
    .filter((item) => item.changePercent > 5)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 4);

  const showFeedback = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2400);
  };

  return (
    <PageLayout title="Reports" description="Owner-ready summaries that turn invoice data into cost-control decisions.">
      <SectionHeader title="Report Library" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {reportCards.map((report) => (
          <Card key={report.title} className="p-5">
            <Badge tone="info">{report.cadence}</Badge>
            <h2 className="mt-4 text-base font-bold text-ink">{report.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{report.description}</p>
          </Card>
        ))}
      </div>

      <section className="mt-8">
        <SectionHeader title="Sample Cafe - Biweekly Cost-Control Report" description="Period: May 1 - May 15, 2026" />
        <Card className="p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div>
              <h3 className="text-lg font-bold text-ink">Executive summary</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Supplier spending was $8,420 for the period. The main issue is not total spend alone; it is several
                quiet item-level increases that can squeeze margins before anyone notices. Cooking oil is up 21.8%,
                chicken is up 9.6%, and packaging costs are moving higher.
              </p>
              <div className="mt-5 rounded-lg bg-brand-50 p-4">
                <p className="text-sm font-semibold text-brand-700">Total supplier spending</p>
                <p className="mt-1 text-3xl font-bold text-ink">$8,420</p>
                <p className="mt-1 text-xs font-semibold text-brand-700">34 invoices across 7 suppliers</p>
              </div>
              <h3 className="mt-6 text-lg font-bold text-ink">Recommended actions</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {recommendedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-5">
              <div>
                <h3 className="mb-3 text-sm font-bold text-ink">What got more expensive</h3>
                <div className="space-y-2">
                  {biggestIncreases.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
                      <span className="font-semibold text-slate-700">{item.item}</span>
                      <Badge tone={item.severity === "High" ? "danger" : "warning"}>{formatPercent(item.changePercent)}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-ink">Where spending went</h3>
                <div className="space-y-2">
                  {categorySpend.slice(0, 5).map((item) => (
                    <div key={item.category} className="rounded-lg bg-slate-50 p-3">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-slate-700">{item.category}</span>
                        <span className="text-muted">{formatCurrency(item.spend)}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${item.share}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={() => showFeedback("Report generated for Sample Cafe.")} icon={<Wand2 className="h-4 w-4" />}>
            Generate Report
          </Button>
          <Button variant="secondary" onClick={() => showFeedback("PDF export queued for this demo.")} icon={<Download className="h-4 w-4" />}>
            Download PDF
          </Button>
          <Button variant="secondary" onClick={() => showFeedback("Email preview sent in demo mode.")} icon={<Mail className="h-4 w-4" />}>
            Email Report
          </Button>
          {message ? <span className="text-sm font-semibold text-brand-700">{message}</span> : null}
        </div>
      </section>
    </PageLayout>
  );
}
