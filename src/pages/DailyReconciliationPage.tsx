import { AlertTriangle, Banknote, CalendarClock, CheckCircle2, FileUp, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { ReconciliationRecordModal } from "../components/ReconciliationRecordModal";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import { captureReconciliationDocument, type ReconciliationExtractResult, type ReconciliationSourceKey } from "../lib/reconciliationCapture";
import {
  buildReconciliationSaveConfirmation,
  createBlankReconciliationDraft,
  createDraftFromReconciliationRecord,
  getRecentReconciliationPreview,
  summarizeReconciliationDraft,
  sortReconciliationsNewestFirst,
} from "../lib/reconciliationWorkflow";
import { usePilotWorkspace } from "../lib/pilotWorkspace";
import type { PilotReconciliationDraft, PilotReconciliationRecord } from "../types";
import { formatCurrency, formatDate } from "../utils/format";

const DRAFT_STORAGE_KEY = "flowtally.pilot.reconciliation.draft.v1";

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

function localDateString(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

function isDraftBlank(draft: PilotReconciliationDraft) {
  return (
    draft.id === undefined &&
    draft.date.trim() === localDateString() &&
    draft.expectedPosSales === 0 &&
    !draft.expectedPosEntered &&
    draft.uberEats === 0 &&
    draft.doorDash === 0 &&
    draft.skip === 0 &&
    draft.cash === 0 &&
    draft.card === 0 &&
    draft.other === 0 &&
    draft.refunds === 0 &&
    draft.discounts === 0 &&
    draft.tips === 0 &&
    draft.fees === 0 &&
    draft.manualAdjustment === 0 &&
    !draft.otherSourceName.trim() &&
    !draft.notes.trim() &&
    !draft.confirmed
  );
}

function formatMaybeNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatCurrency(value) : "Not entered";
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

function loadPersistedDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<PilotReconciliationDraft>;
    const draft = {
      ...createBlankReconciliationDraft(),
      ...parsed,
      expectedPosEntered: Boolean(parsed.expectedPosEntered),
    } satisfies PilotReconciliationDraft;
    return isDraftBlank(draft) ? null : draft;
  } catch {
    return null;
  }
}

function persistDraft(draft: PilotReconciliationDraft) {
  if (typeof window === "undefined") {
    return;
  }

  if (isDraftBlank(draft)) {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function DailyReconciliationPage() {
  const demo = useDemoProfile();
  const { saveReconciliation, deleteReconciliation, reconciliations, summary, resetWorkspace } = usePilotWorkspace();
  const [draft, setDraft] = useState<PilotReconciliationDraft>(() => loadPersistedDraft() ?? createBlankReconciliationDraft());
  const [imports, setImports] = useState<Partial<Record<ReconciliationSourceKey, ReconciliationExtractResult>>>({});
  const [isImporting, setIsImporting] = useState<ReconciliationSourceKey | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const inputRefs = useRef<Partial<Record<ReconciliationSourceKey, HTMLInputElement | null>>>({});
  const saveLockRef = useRef(false);

  useEffect(() => {
    setDraft(loadPersistedDraft() ?? createBlankReconciliationDraft());
    setImports({});
    setIsImporting(null);
    setMessage("");
    setErrorMessage("");
    setConfirmed(false);
    setIsSaving(false);
    setShowAllHistory(false);
    setSelectedRecordId(null);
    inputRefs.current = {};
  }, [demo.slug]);

  useEffect(() => {
    persistDraft(draft);
  }, [draft]);

  const reconciliationSummary = useMemo(() => summarizeReconciliationDraft(draft), [draft]);
  const recentPreview = useMemo(() => getRecentReconciliationPreview(reconciliations, 5), [reconciliations]);
  const selectedRecord = useMemo(() => reconciliations.find((record) => record.id === selectedRecordId) ?? null, [reconciliations, selectedRecordId]);
  const visibleHistory = useMemo(
    () => (showAllHistory ? sortReconciliationsNewestFirst(reconciliations) : recentPreview.visibleRecords),
    [recentPreview.visibleRecords, reconciliations, showAllHistory],
  );

  const updateDraft = (updater: (current: PilotReconciliationDraft) => PilotReconciliationDraft) => {
    setDraft((current) => {
      const next = updater(current);
      return { ...next, confirmed: false };
    });
    setConfirmed(false);
  };

  const setField = <K extends keyof PilotReconciliationDraft>(field: K, value: PilotReconciliationDraft[K]) => {
    updateDraft((current) => ({ ...current, [field]: value }));
  };

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

    updateDraft((current) => ({
      ...current,
      date: businessDate || current.date,
      expectedPosEntered: sourceCard.targetField === "expectedPosSales" ? true : current.expectedPosEntered,
      [sourceCard.targetField]: amount,
    }));
    setMessage(`Applied extracted values from ${extracted.fileName}.`);
  };

  const handleSave = () => {
    if (isSaving || saveLockRef.current || !confirmed || reconciliationSummary.status === "Incomplete" || (reconciliationSummary.requiresNote && !draft.notes.trim())) {
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);

    try {
      const saved = saveReconciliation({
        ...draft,
        confirmed,
        variance: reconciliationSummary.variance,
        status: reconciliationSummary.status,
      });
      setMessage(buildReconciliationSaveConfirmation(saved));
      setErrorMessage("");
      setDraft(createBlankReconciliationDraft());
      setImports({});
      setConfirmed(false);
      setShowAllHistory(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleEditRecord = (record: PilotReconciliationRecord) => {
    setSelectedRecordId(null);
    setDraft(createDraftFromReconciliationRecord(record));
    setConfirmed(Boolean(record.confirmed));
    setImports({});
    setMessage(`Editing ${formatDate(record.date)} reconciliation.`);
    setErrorMessage("");
  };

  const handleDeleteRecord = (record: PilotReconciliationRecord) => {
    deleteReconciliation(record.id);
    if (selectedRecordId === record.id) {
      setSelectedRecordId(null);
    }
    setMessage(`Deleted ${formatDate(record.date)} reconciliation.`);
    setErrorMessage("");
  };

  const handleResetDraft = () => {
    setDraft(createBlankReconciliationDraft());
    setMessage("");
    setErrorMessage("");
    setIsImporting(null);
    setIsSaving(false);
    setConfirmed(false);
    setImports({});
    setSelectedRecordId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
    if (inputRefs.current) {
      inputRefs.current = {};
    }
  };

  const handleRestoreSamples = () => {
    if (typeof window !== "undefined" && window.confirm("Restore the sample reconciliation data for this pilot browser?")) {
      resetWorkspace();
      handleResetDraft();
      setMessage("Sample reconciliation data restored.");
    }
  };

  return (
    <PageLayout
      title="Daily reconciliation"
      eyebrow={`${demo.customization.restaurantName} / Pilot workspace`}
      description="Enter the business date, POS total, and daily payment totals. Import reports where helpful, review the difference, then save the close locally."
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
                    <Button type="button" variant="secondary" icon={<FileUp className="h-4 w-4" />} onClick={() => inputRefs.current[source.key]?.click()} disabled={isBusy}>
                      Upload
                    </Button>
                  </div>
                  <input
                    ref={(node) => {
                      inputRefs.current[source.key] = node;
                    }}
                    accept=".csv,.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
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
                          <Badge tone={imported.needsReview ? "warning" : "success"}>{Math.round(imported.overallConfidence * 100)}%</Badge>
                        </div>
                        <p className="mt-1 text-lg font-bold text-ink">{formatCurrency(suggestedAmount)}</p>
                        <p className="mt-1 text-xs text-muted">Source: {imported.fields.suggestedAmountType.value}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <MiniField label="Business date" value={imported.fields.businessDate.value || "Not entered"} />
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
                        <Button type="button" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setImports((current) => ({ ...current, [source.key]: undefined }))}>
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
            <Metric label="Status" value={reconciliationSummary.status} helper={reconciliationSummary.explanation} />
            <Metric label="Expected POS" value={reconciliationSummary.hasExpectedPos ? formatCurrency(draft.expectedPosSales) : "Not entered"} helper={reconciliationSummary.hasExpectedPos ? "Entered manually or imported" : "Required to begin reconciliation"} />
            <Metric label="Accounted total" value={formatCurrency(reconciliationSummary.accountedTotal)} helper="Cash + card + delivery + adjustments" />
            <Metric label="Difference" value={formatCurrency(reconciliationSummary.variance)} helper={`Balanced within ${formatCurrency(reconciliationSummary.balancedTolerance)}.`} />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Business date">
              <input value={draft.date} onChange={(event) => setField("date", event.target.value)} className="input" type="date" inputMode="numeric" />
            </Field>
            <Field label="POS expected sales">
              <input
                value={draft.expectedPosSales}
                onChange={(event) => {
                  updateDraft((current) => ({ ...current, expectedPosSales: Number(event.target.value) || 0, expectedPosEntered: event.target.value.trim().length > 0 }));
                }}
                className="input"
                min="0"
                step="0.01"
                type="number"
                inputMode="decimal"
              />
            </Field>
            <Field label="Cash">
              <input value={draft.cash} onChange={(event) => setField("cash", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="Card">
              <input value={draft.card} onChange={(event) => setField("card", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="Uber Eats">
              <input value={draft.uberEats} onChange={(event) => setField("uberEats", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="DoorDash">
              <input value={draft.doorDash} onChange={(event) => setField("doorDash", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="Skip">
              <input value={draft.skip} onChange={(event) => setField("skip", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="Other payment amount">
              <input value={draft.other} onChange={(event) => setField("other", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
            </Field>
            <Field label="Other payment source">
              <input value={draft.otherSourceName} onChange={(event) => setField("otherSourceName", event.target.value)} className="input" placeholder="Gift cards, cash drop, etc." type="text" />
            </Field>
          </div>

          <details className="mt-5 rounded-xl border border-line bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-bold text-ink">Add adjustment</summary>
            <p className="mt-2 text-sm leading-6 text-muted">
              Use these only when a value legitimately explains the difference. Positive adjustments add to the accounted total. Refunds, discounts, and fees subtract from it.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Refunds">
                <input value={draft.refunds} onChange={(event) => setField("refunds", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
              </Field>
              <Field label="Discounts">
                <input value={draft.discounts} onChange={(event) => setField("discounts", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
              </Field>
              <Field label="Tips">
                <input value={draft.tips} onChange={(event) => setField("tips", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
              </Field>
              <Field label="Fees / platform adjustments">
                <input value={draft.fees} onChange={(event) => setField("fees", Number(event.target.value) || 0)} className="input" min="0" step="0.01" type="number" inputMode="decimal" />
              </Field>
              <Field label="Manual adjustment">
                <input value={draft.manualAdjustment} onChange={(event) => setField("manualAdjustment", Number(event.target.value) || 0)} className="input" step="0.01" type="number" inputMode="decimal" />
              </Field>
              <Field label="Notes">
                <textarea
                  value={draft.notes}
                  onChange={(event) => setField("notes", event.target.value)}
                  className="input min-h-32"
                  placeholder="Reason for a variance, missing payout, cash count note, or manager follow-up."
                />
              </Field>
            </div>
          </details>

          <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
            <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-line text-brand-600"
                type="checkbox"
              />
              <span>I reviewed the imported totals and understand that the reconciliation is only saved after confirmation.</span>
            </label>
            {reconciliationSummary.requiresNote && !draft.notes.trim() ? (
              <p className="mt-3 text-sm font-semibold text-amber-800">Add a note before saving this unresolved day.</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                icon={<Save className="h-4 w-4" />}
                onClick={handleSave}
                type="button"
                disabled={!confirmed || isSaving || reconciliationSummary.status === "Incomplete" || (reconciliationSummary.requiresNote && !draft.notes.trim())}
              >
                {isSaving ? "Saving..." : draft.id ? "Update close" : "Confirm and save"}
              </Button>
              <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={handleResetDraft} type="button">
                Clear draft
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
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Live result</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{reconciliationSummary.explanation}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SummaryRow label="Business date" value={draft.date || "Not entered"} />
              <SummaryRow label="Expected POS" value={formatCurrency(draft.expectedPosSales)} />
              <SummaryRow label="Accounted total" value={formatCurrency(reconciliationSummary.accountedTotal)} />
              <SummaryRow label="Difference" value={formatCurrency(reconciliationSummary.variance)} />
              <SummaryRow label="Status" value={reconciliationSummary.status} />
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Variance breakdown" description="Use this as a triage list, not as proof of the actual cause." />
            <div className="space-y-2">
              {reconciliationSummary.breakdown.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className={item.value < 0 ? "text-red-700" : "text-ink"}>{formatCurrency(item.value)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Checklist" description="Practical prompts for unresolved differences." />
            <div className="space-y-2">
              {(reconciliationSummary.prompts.length ? reconciliationSummary.prompts : ["Balanced - all sales are accounted for."]).map((item) => (
                <div key={item} className="rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="Today at a glance" description="Owner-friendly status from the current local records." />
            <div className="space-y-3 text-sm leading-6 text-slate-700">
              <SummaryRow label="Today's status" value={summary.todayReconciliationStatus} />
              <SummaryRow label="Today's variance" value={formatCurrency(summary.todayReconciliationVariance)} />
              <SummaryRow label="Unresolved days" value={String(summary.unresolvedReconciliationCount)} />
              <SummaryRow label="7-day unresolved exposure" value={formatCurrency(summary.weeklyUnresolvedVariance)} />
            </div>
          </Card>

          <Card className="surface-panel p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-brand-600 p-3 text-white">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Pilot reset</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Restore the sample reconciliation records if you want to return the browser to a clean pilot state without deleting your other invoice data.
                </p>
              </div>
            </div>
            <Button className="mt-4" type="button" variant="secondary" onClick={handleRestoreSamples}>
              Restore sample data
            </Button>
          </Card>
        </div>
      </div>

      <section className="mt-8">
        <SectionHeader
          title="Recent reconciliation records"
          description="The newest business dates are shown first. Open a record to review it or edit it from the saved data."
          action={recentPreview.hasMore ? (
            <Button type="button" variant="secondary" onClick={() => setShowAllHistory((current) => !current)}>
              {showAllHistory ? "Show newest five" : `View all records (${recentPreview.totalCount})`}
            </Button>
          ) : null}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleHistory.map((record) => {
            const summaryForCard = summarizeReconciliationDraft(record);
            return (
              <Card key={record.id} className={`p-4 ${record.origin === "seed" ? "border-dashed border-brand-100" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-ink">{formatDate(record.date)}</p>
                      <Badge tone={record.origin === "seed" ? "info" : "success"}>{record.origin === "seed" ? "Sample" : "Saved"}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{summaryForCard.explanation}</p>
                  </div>
                  <Badge tone={record.status === "Balanced" ? "success" : record.status === "Small difference" ? "warning" : "danger"}>{record.status}</Badge>
                </div>

                <div className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
                  <SummaryRow label="Expected POS" value={formatCurrency(record.expectedPosSales)} />
                  <SummaryRow label="Accounted total" value={formatCurrency(summaryForCard.accountedTotal)} />
                  <SummaryRow label="Variance" value={formatCurrency(record.variance)} />
                  <SummaryRow label="Last updated" value={record.savedAt ? new Date(record.savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Not saved"} />
                </div>

                <p className="mt-3 text-xs leading-5 text-muted">{record.notes || "No notes saved."}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setSelectedRecordId(record.id)}>
                    Open
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => handleEditRecord(record)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete the ${formatDate(record.date)} reconciliation? This cannot be undone.`)) {
                        handleDeleteRecord(record);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <ReconciliationRecordModal
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        onClose={() => setSelectedRecordId(null)}
        onEdit={handleEditRecord}
        onDelete={handleDeleteRecord}
      />
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="min-w-0 break-words text-sm text-ink sm:max-w-56 sm:text-right">{value}</span>
    </div>
  );
}
