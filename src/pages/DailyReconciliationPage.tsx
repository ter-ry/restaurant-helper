import { Banknote, Calculator, CalendarClock, Save } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { PilotReconciliationDraft, PilotReconciliationRecord } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

function createBlankReconciliation(): PilotReconciliationDraft {
  return {
    date: new Date().toISOString().slice(0, 10),
    uberEats: 0,
    doorDash: 0,
    skip: 0,
    cash: 0,
    card: 0,
    other: 0,
    expectedPosSales: 0,
    variance: 0,
    status: "Balanced",
    notes: "",
  };
}

export function DailyReconciliationPage() {
  const demo = useDemoProfile();
  const { saveReconciliation, reconciliations } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotReconciliationDraft>(createBlankReconciliation());
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft(createBlankReconciliation());
    setMessage("");
  }, [demo.slug]);

  const actualSales = useMemo(
    () => draft.uberEats + draft.doorDash + draft.skip + draft.cash + draft.card + draft.other,
    [draft.card, draft.cash, draft.doorDash, draft.other, draft.skip, draft.uberEats],
  );

  const variance = Number((actualSales - draft.expectedPosSales).toFixed(2));
  const recentColumns: Column<PilotReconciliationRecord>[] = [
    { header: "Date", accessor: (row) => formatDate(row.date) },
    { header: "Uber Eats", accessor: (row) => formatCurrency(row.uberEats) },
    { header: "DoorDash", accessor: (row) => formatCurrency(row.doorDash) },
    { header: "Skip", accessor: (row) => formatCurrency(row.skip) },
    { header: "Cash", accessor: (row) => formatCurrency(row.cash) },
    { header: "Card", accessor: (row) => formatCurrency(row.card) },
    { header: "Other", accessor: (row) => formatCurrency(row.other) },
    { header: "Expected POS", accessor: (row) => formatCurrency(row.expectedPosSales) },
    { header: "Variance", accessor: (row) => <Badge tone={Math.abs(row.variance) >= 1 ? "danger" : "success"}>{formatCurrency(row.variance)}</Badge> },
    { header: "Status", accessor: (row) => <Badge tone={row.status === "Balanced" ? "success" : "warning"}>{row.status}</Badge> },
    { header: "Notes", accessor: "notes", className: "min-w-72" },
  ];

  const handleSave = () => {
    const saved = saveReconciliation({ ...draft, variance });
    setMessage(`Saved the ${formatDate(saved.date)} close with ${formatCurrency(saved.variance)} variance.`);
    setDraft(createBlankReconciliation());
  };

  return (
    <PageLayout
      title="Daily reconciliation"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="Enter the daily delivery, cash, and card totals, compare them with the expected POS sales, and store the close locally."
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="p-6">
          <SectionHeader title="Daily close entry" description="This is a simple pilot form, not a full accounting system." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date">
              <input value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="input" type="date" />
            </Field>
            <Field label="Expected POS sales">
              <input
                value={draft.expectedPosSales}
                onChange={(event) => setDraft({ ...draft, expectedPosSales: Number(event.target.value) || 0 })}
                className="input"
                min="0"
                step="0.01"
                type="number"
              />
            </Field>
            <Field label="Uber Eats">
              <input value={draft.uberEats} onChange={(event) => setDraft({ ...draft, uberEats: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="DoorDash">
              <input value={draft.doorDash} onChange={(event) => setDraft({ ...draft, doorDash: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Skip">
              <input value={draft.skip} onChange={(event) => setDraft({ ...draft, skip: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Cash">
              <input value={draft.cash} onChange={(event) => setDraft({ ...draft, cash: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Card">
              <input value={draft.card} onChange={(event) => setDraft({ ...draft, card: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Other">
              <input value={draft.other} onChange={(event) => setDraft({ ...draft, other: Number(event.target.value) || 0 })} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Status">
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as PilotReconciliationDraft["status"] })} className="input">
                <option value="Balanced">Balanced</option>
                <option value="Needs Review">Needs Review</option>
              </select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Notes">
              <textarea
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                className="input min-h-32"
                placeholder="Reason for a variance, missing payout, cash count note, or manager follow-up."
              />
            </Field>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Auto variance</p>
              <p className="mt-2 text-2xl font-bold text-ink">{formatCurrency(variance)}</p>
              <p className="mt-1 text-sm text-muted">Actual sales {formatCurrency(actualSales)}</p>
            </div>
          </div>

          {message ? (
            <p className="mt-4 rounded-lg border border-line bg-white px-4 py-3 text-sm leading-6 text-slate-700" role="status">
              {message}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button icon={<Save className="h-4 w-4" />} onClick={handleSave} type="button">
              Save reconciliation
            </Button>
            <Button
              variant="secondary"
              icon={<Calculator className="h-4 w-4" />}
              onClick={() => setDraft((current) => ({ ...current, variance }))}
              type="button"
            >
              Refresh variance
            </Button>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Today&apos;s close</p>
                <p className="mt-3 text-3xl font-bold text-ink">{formatCurrency(variance)}</p>
                <p className="mt-2 text-sm text-muted">Calculated automatically from the six payment buckets and the expected POS total.</p>
              </div>
              <div className="rounded-lg bg-slate-100 p-3 text-slate-700">
                <Banknote className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card className="surface-panel p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-ink p-3 text-white">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Pilot note</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  This workflow keeps the restaurant on a single browser-stored record set. There is no POS integration yet, so the manager still enters the daily totals by hand.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <section className="mt-8">
        <SectionHeader title="Recent reconciliation records" description="The latest daily close entries saved in the local pilot store." />
        <DataTable columns={recentColumns} data={reconciliations.slice(0, 8)} getRowKey={(row) => row.id} />
      </section>
    </PageLayout>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
