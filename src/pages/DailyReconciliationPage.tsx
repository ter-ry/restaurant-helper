import { AlertTriangle, Banknote, Calculator, CalendarClock, CheckCircle2, FileUp, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DataTable, type Column } from "../components/DataTable";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import { captureReconciliationDocument, type ReconciliationExtractResult, type ReconciliationSourceKey } from "../lib/reconciliationCapture";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { PilotReconciliationDraft, PilotReconciliationRecord } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const SOURCE_CARDS: Array<{
  key: ReconciliationSourceKey;
  label: string;
  helper: string;
  targetField: keyof Pick<PilotReconciliationDraft, "uberEats" | "doorDash" | "skip" | "cash" | "card" | "expectedPosSales">;
}> = [
  { key: "uber_eats", label: "Uber Eats", helper: "Upload the daily report or payout export.", targetField: "uberEats" },
  { key: "doordash", label: "DoorDash", helper: "Upload the daily report or settlement export.", targetField: "doorDash" },
  { key: "skip", label: "Skip", helper: "Upload the daily report or payout export.", targetField: "skip" },
  { key: "pos", label: "POS sales report", helper: "Upload the end-of-day POS close report.", targetField: "expectedPosSales" },
  { key: "card", label: "Card processor", helper: "Upload the batch or settlement report.", targetField: "card" },
  { key: "cash", label: "Cash close record", helper: "Upload an optional cash count or drawer close.", targetField: "cash" },
];

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

function formatMaybeNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatCurrency(value) : "—";
}

function amountForSource(result: ReconciliationExtractResult | undefined, targetField: string) {
  if (!result) {
    return 0;
  }
  if (targetField === "uberEats" || targetField === "doorDash" || targetField === "skip") {
    return result.fields.netSalesOrPayout.value || result.fields.grossSales.value || result.fields.suggestedAmount.value || 0;
  }
  if (targetField === "expectedPosSales") {
    return result.fields.posExpectedSales.value || result.fields.suggestedAmount.value || 0;
  }
  if (targetField === "card") {
    return result.fields.cardBatchTotal.value || result.fields.suggestedAmount.value || 0;
  }
  if (targetField === "cash") {
    return result.fields.cashCount.value || result.fields.suggestedAmount.value || 0;
  }
  return result.fields.suggestedAmount.value || 0;
}

function businessDateForSource(result: ReconciliationExtractResult | undefined) {
  return result?.fields.businessDate.value || "";
}

export function DailyReconciliationPage() {
  const demo = useDemoProfile();
  const { saveReconciliation, reconciliations } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotReconciliationDraft>(createBlankReconciliation());
  const [imports, setImports] = useState<Partial<Record<ReconciliationSourceKey, ReconciliationExtractResult>>>({});
  const [isImporting, setIsImporting] = useState<ReconciliationSourceKey | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const inputRefs = useRef<Partial<Record<ReconciliationSourceKey, HTMLInputElement | null>>>({});

  useEffect(() => {
    setDraft(createBlankReconciliation());
    setImports({});
    setIsImporting(null);
    setMessage("");
    setErrorMessage("");
    setConfirmed(false);
    inputRefs.current = {};
  }, [demo.slug]);

  const actualSales = useMemo(
    () => draft.uberEats + draft.doorDash + draft.skip + draft.cash + draft.card + draft.other,
    [draft.card, draft.cash, draft.doorDash, draft.other, draft.skip, draft.uberEats],
  );

  const variance = Number((actualSales - draft.expectedPosSales).toFixed(2));
  const derivedStatus = Math.abs(variance) < 1 ? "Balanced" : "Needs Review";

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

  const investigationChecklist = [
    "missing platform order",
    "refund or cancellation",
    "promotion recorded differently",
    "tips or taxes included inconsistently",
    "card batch mismatch",
    "cash count difference",
    "wrong business date",
    "gross sales confused with net payout",
  ];

  const importableTypes = ".csv,.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

  const handleImport = async (source: ReconciliationSourceKey, file: File) => {
    if (!file) {
      return;
    }
    setIsImporting(source);
    setErrorMessage("");
    setMessage(`Processing ${file.name} for ${SOURCE_CARDS.find((item) => item.key === source)?.label ?? source}...`);

    try {
      const extracted = await captureReconciliationDocument(file, source);
      setImports((current) => ({ ...current, [source]: extracted }));
      setMessage(`Extracted ${file.name}. Review the values before applying them to the close.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Reconciliation extraction failed.";
      setErrorMessage(text);
      setMessage("");
    } finally {
      setIsImporting(null);
    }
  };

  const applyImport = (source: ReconciliationSourceKey) => {
    const extracted = imports[source];
    if (!extracted) {
      return;
    }

    const sourceCard = SOURCE_CARDS.find((item) => item.key === source);
    if (!sourceCard) {
      return;
    }

    const amount = amountForSource(extracted, sourceCard.targetField);
    const businessDate = businessDateForSource(extracted);

    setDraft((current) => ({
      ...current,
      date: businessDate || current.date,
      [sourceCard.targetField]: amount,
    }));
    setConfirmed(false);
    setMessage(`Applied extracted values from ${extracted.fileName}.`);
  };

  const setField = <K extends keyof PilotReconciliationDraft>(field: K, value: PilotReconciliationDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setConfirmed(false);
  };

  const handleSave = () => {
    const saved = saveReconciliation({
      ...draft,
      variance,
      status: draft.status || derivedStatus,
    });
    setMessage(`Saved the ${formatDate(saved.date)} close with ${formatCurrency(saved.variance)} variance.`);
    setErrorMessage("");
    setDraft(createBlankReconciliation());
    setConfirmed(false);
    setImports({});
  };

  return (
    <PageLayout
      title="Daily reconciliation"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="Upload exported delivery, POS, and card reports, review the extracted totals, then confirm and save the close locally."
    >
      <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
        <Card className="surface-panel p-6">
          <SectionHeader
            title="Report imports"
            description="Each source is uploaded separately. Extracted values are review-only until you apply them to the close."
            action={<Badge tone="info">Manual confirmation required</Badge>}
          />

          <div className="grid gap-4 md:grid-cols-2">
            {SOURCE_CARDS.map((source) => {
              const imported = imports[source.key];
              const isBusy = isImporting === source.key;
              const suggestedAmount = imported ? amountForSource(imported, source.targetField) : 0;
              return (
                <div key={source.key} className="rounded-xl border border-line bg-white p-4 shadow-soft">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-ink">{source.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{source.helper}</p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      icon={<FileUp className="h-4 w-4" />}
                      onClick={() => inputRefs.current[source.key]?.click()}
                      disabled={isBusy}
                    >
                      Upload
                    </Button>
                  </div>
                  <input
                    ref={(node) => {
                      inputRefs.current[source.key] = node;
                    }}
                    accept={importableTypes}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void handleImport(source.key, file);
                      }
                    }}
                    type="file"
                  />

                  {isBusy ? (
                    <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing file
                      </span>
                    </div>
                  ) : null}

                  {imported ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted">Suggested amount</p>
                          <Badge tone={imported.needsReview ? "warning" : "success"}>
                            {Math.round(imported.overallConfidence * 100)}%
                          </Badge>
                        </div>
                        <p className="mt-1 text-lg font-bold text-ink">{formatCurrency(suggestedAmount)}</p>
                        <p className="mt-1 text-xs text-muted">Source: {imported.fields.suggestedAmountType.value}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <MiniField label="Business date" value={imported.fields.businessDate.value || "—"} />
                        <MiniField label="Orders" value={String(imported.fields.orderCount.value)} />
                        <MiniField label="Gross sales" value={formatMaybeNumber(imported.fields.grossSales.value)} />
                        <MiniField label="Discounts" value={formatMaybeNumber(imported.fields.discounts.value)} />
                        <MiniField label="Refunds" value={formatMaybeNumber(imported.fields.refunds.value)} />
                        <MiniField label="Tax" value={formatMaybeNumber(imported.fields.tax.value)} />
                        <MiniField label="Tips" value={formatMaybeNumber(imported.fields.tips.value)} />
                        <MiniField label="Fees" value={formatMaybeNumber(imported.fields.fees.value)} />
                        <MiniField label="Net / payout" value={formatMaybeNumber(imported.fields.netSalesOrPayout.value)} />
                        <MiniField label="Card batch" value={formatMaybeNumber(imported.fields.cardBatchTotal.value)} />
                        <MiniField label="POS expected" value={formatMaybeNumber(imported.fields.posExpectedSales.value)} />
                        <MiniField label="Cash count" value={formatMaybeNumber(imported.fields.cashCount.value)} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => applyImport(source.key)} icon={<CheckCircle2 className="h-4 w-4" />}>
                          Apply to close
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<RefreshCw className="h-4 w-4" />}
                          onClick={() => setImports((current) => ({ ...current, [source.key]: undefined }))}
                        >
                          Clear
                        </Button>
                      </div>
                      {imported.warnings.length ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                          <p className="font-semibold">Review warnings</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {imported.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <details className="rounded-lg border border-line bg-slate-50 p-3">
                        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Source text</summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">{imported.rawText}</pre>
                      </details>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs leading-5 text-muted">Upload a CSV, PDF, JPG, JPEG, PNG, or WEBP file for this source.</p>
                  )}
                </div>
              );
            })}
          </div>

          {message ? (
            <div className="mt-4 rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm leading-6 text-slate-700" role="status">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-brand-600" />
                Import state
              </div>
              <p className="mt-1">{message}</p>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Import problem
              </div>
              <p className="mt-1">{errorMessage}</p>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <Metric label="Calculated sales" value={formatCurrency(actualSales)} helper="Sum of the current manual values" />
            <Metric label="Expected POS" value={formatCurrency(draft.expectedPosSales)} helper="Manual or imported POS total" />
            <Metric label="Variance" value={formatCurrency(variance)} helper="Auto-calculated against expected POS" />
            <Metric label="Suggested status" value={derivedStatus} helper="Balanced or Needs Review from variance" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Date">
              <input value={draft.date} onChange={(event) => setField("date", event.target.value)} className="input" type="date" />
            </Field>
            <Field label="Expected POS sales">
              <input
                value={draft.expectedPosSales}
                onChange={(event) => setField("expectedPosSales", Number(event.target.value) || 0)}
                className="input"
                min="0"
                step="0.01"
                type="number"
              />
            </Field>
            <Field label="Uber Eats">
              <input value={draft.uberEats} onChange={(event) => setField("uberEats", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="DoorDash">
              <input value={draft.doorDash} onChange={(event) => setField("doorDash", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Skip">
              <input value={draft.skip} onChange={(event) => setField("skip", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Cash">
              <input value={draft.cash} onChange={(event) => setField("cash", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Card">
              <input value={draft.card} onChange={(event) => setField("card", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Other">
              <input value={draft.other} onChange={(event) => setField("other", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" />
            </Field>
            <Field label="Status">
              <select value={draft.status} onChange={(event) => setField("status", event.target.value as PilotReconciliationDraft["status"])} className="input">
                <option value="Balanced">Balanced</option>
                <option value="Needs Review">Needs Review</option>
              </select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Notes">
              <textarea
                value={draft.notes}
                onChange={(event) => setField("notes", event.target.value)}
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

          <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-line text-brand-600"
                type="checkbox"
              />
              <span>
                I reviewed the imported totals and understand that the reconciliation is only saved after confirmation.
              </span>
            </label>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                icon={<Save className="h-4 w-4" />}
                onClick={handleSave}
                type="button"
                disabled={!confirmed}
              >
                Confirm and save
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
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-ink p-3 text-white">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Current close</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  The manual totals below remain editable even after imports. Imports only prefill values and never save automatically.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="Variance checklist"
              description="Use this as a triage list, not as proof of the actual cause."
            />
            <div className="space-y-2">
              {investigationChecklist.map((item) => (
                <div
                  key={item}
                  className={`rounded-lg border px-3 py-2 text-sm leading-6 ${
                    item.includes("business date") && !draft.date
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-line bg-white text-slate-700"
                  }`}
                >
                  {item}
                </div>
              ))}
            </div>
          </Card>

          <Card className="surface-panel p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-brand-600 p-3 text-white">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Manual support still allowed</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Uploads are optional. You can still enter all numbers by hand if a report is malformed, rotated, or unavailable.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Recent reconciliation records" description="The latest daily close entries saved in the local pilot store." />
            <DataTable columns={recentColumns} data={reconciliations.slice(0, 8)} getRowKey={(row) => row.id} />
          </Card>
        </div>
      </div>
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

function Metric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
