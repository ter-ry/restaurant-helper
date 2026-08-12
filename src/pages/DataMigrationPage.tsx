import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SupportAccessBanner } from "../components/SupportAccessBanner";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import {
  approveImportJob,
  DATA_IMPORT_ENTITY_SCOPES,
  DATA_IMPORT_FIELDS,
  executeImportJob,
  fetchImportJob,
  listImportJobs,
  previewImportJob,
  rollbackImportJob,
  saveImportMapping,
  type DataImportJobDetail,
  type DataImportJobSummary,
  uploadImportJob,
} from "../lib/dataImports";

type LoadState = "loading" | "signedOut" | "permissionDenied" | "ready" | "error";

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function DataMigrationPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [jobs, setJobs] = useState<DataImportJobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<DataImportJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [entityScope, setEntityScope] = useState("supplier");
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});

  const currentOrganizationId = session?.currentOrganizationId ?? session?.organizations?.find((entry) => entry.selected)?.organization.id ?? null;
  const sourceColumns = selectedJob?.sourceColumns ?? [];
  const fieldSpecs = DATA_IMPORT_FIELDS[selectedJob?.entityScope ?? entityScope] ?? DATA_IMPORT_FIELDS.supplier;
  const sampleRows = selectedJob?.sampleRows ?? [];

  const rowPreviewStats = useMemo(() => {
    const blocked = selectedJob?.rows.filter((row) => row.blockedCount > 0).length ?? 0;
    const ready = selectedJob?.rows.filter((row) => row.status === "ready").length ?? 0;
    const completed = selectedJob?.rows.filter((row) => row.status === "completed").length ?? 0;
    return { blocked, ready, completed };
  }, [selectedJob]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const current = await fetchCustomerSession();
        if (cancelled) return;
        setSession(current);
        if (current.platformRole && current.platformRole !== "setup_admin" && current.platformRole !== "support") {
          setState("permissionDenied");
          return;
        }
        if (!currentOrganizationId && !current.platformRole) {
          setState("signedOut");
          return;
        }
        const targetOrganizationId = currentOrganizationId ?? current.organizations?.[0]?.organization.id ?? null;
        if (!targetOrganizationId) {
          setState("permissionDenied");
          return;
        }
        const response = await listImportJobs(targetOrganizationId);
        if (cancelled) return;
        setJobs(response.jobs);
        const targetJobId = selectedJobId ?? response.jobs[0]?.id ?? null;
        setSelectedJobId(targetJobId);
        setSelectedJob(targetJobId ? await fetchImportJob(targetJobId).then((payload) => payload.job) : null);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load imports.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId, selectedJobId]);

  async function refresh() {
    if (!currentOrganizationId) {
      return;
    }
    const response = await listImportJobs(currentOrganizationId);
    setJobs(response.jobs);
    const targetJobId = selectedJobId ?? response.jobs[0]?.id ?? null;
    setSelectedJobId(targetJobId);
    setSelectedJob(targetJobId ? await fetchImportJob(targetJobId).then((payload) => payload.job) : null);
  }

  async function refreshJob(jobId: number) {
    const payload = await fetchImportJob(jobId);
    setSelectedJob(payload.job);
    setSelectedJobId(jobId);
    await refresh();
  }

  async function mutate(label: string, handler: () => Promise<DataImportJobDetail>) {
    if (!selectedJob) {
      return;
    }
    setSaving(label);
    setError(null);
    try {
      const payload = await handler();
      setSelectedJob(payload);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the import job.");
    } finally {
      setSaving(null);
    }
  }

  function initializeMapping(job: DataImportJobDetail) {
    const defaults: Record<string, string> = {};
    for (const spec of DATA_IMPORT_FIELDS[job.entityScope] ?? []) {
      const directMatch = job.sourceColumns.find((column) => column.toLowerCase() === spec.field.toLowerCase() || column.toLowerCase().replace(/[^a-z0-9]+/g, "") === spec.field.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      if (directMatch) {
        defaults[spec.field] = directMatch;
      }
    }
    setFieldMappings({ ...defaults });
    setFixedValues({});
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    if (!currentOrganizationId) {
      setUploadError("No organization is selected for this session.");
      return;
    }
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("import-file") as HTMLInputElement | null;
    const scopeInput = form.elements.namedItem("entity-scope") as HTMLSelectElement | null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setUploadError("Choose a CSV or XLSX file to upload.");
      return;
    }
    const formData = new FormData();
    formData.append("organizationId", String(currentOrganizationId));
    formData.append("entityScope", scopeInput?.value ?? entityScope);
    formData.append("file", file, file.name);
    await mutate("upload", async () => (await uploadImportJob(formData)).job);
    form.reset();
    setEntityScope(scopeInput?.value ?? entityScope);
  }

  async function saveMapping() {
    if (!selectedJob) return;
    setMappingError(null);
    const nextMapping = {
      entityScope: selectedJob.entityScope,
      fieldMappings,
      fixedValues,
    };
    await mutate("mapping", async () => (await saveImportMapping(selectedJob.id, nextMapping)).job);
  }

  async function preview() {
    if (!selectedJob) return;
    await mutate("preview", async () => (await previewImportJob(selectedJob.id)).job);
  }

  async function approve() {
    if (!selectedJob) return;
    await mutate("approve", async () => (await approveImportJob(selectedJob.id)).job);
  }

  async function execute() {
    if (!selectedJob) return;
    await mutate("execute", async () => (await executeImportJob(selectedJob.id)).job);
  }

  async function rollback() {
    if (!selectedJob) return;
    await mutate("rollback", async () => (await rollbackImportJob(selectedJob.id)).job);
  }

  if (state === "loading") {
    return (
      <PageLayout title="Data migration" eyebrow="Flowtally onboarding" description="Loading migration jobs and customer setup files.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading migration workspaceâ€¦</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Data migration" eyebrow="Flowtally onboarding" description="Sign in to upload setup files.">
        <Card className="p-6">
          <p className="text-sm font-bold uppercase tracking-wide text-muted">Sign in required</p>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google</h1>
          <p className="mt-3 text-sm leading-6 text-muted">The migration workspace is available after you sign in.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={startGoogleLogin}>
              Continue with Google
            </button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
              Return home
            </Link>
          </div>
        </Card>
      </PageLayout>
    );
  }

  if (state === "permissionDenied") {
    return (
      <PageLayout title="Data migration" eyebrow="Flowtally onboarding" description="This page is restricted to the organization owner or setup team.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">You do not have access to this migration workspace</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Ask the organization owner or platform setup team to grant access.</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Data migration" eyebrow="Flowtally onboarding" description="Something went wrong while loading the migration workspace.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load migration jobs</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Data migration" eyebrow="Flowtally onboarding" description="Upload supplier, inventory and opening-balance files, map the columns, preview the results, and execute safely.">
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Import jobs</h2>
            <button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {jobs.map((job) => (
              <button
                key={job.id}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${job.id === selectedJobId ? "border-brand-200 bg-brand-50" : "border-line bg-white hover:bg-slate-50"}`}
                type="button"
                onClick={() => void refreshJob(job.id)}
              >
                <p className="text-sm font-semibold text-ink">{job.sourceFileName || `Job ${job.id}`}</p>
                <p className="mt-1 text-xs text-muted">
                  {job.entityScope} · {job.status} · {job.rowCount} rows
                </p>
              </button>
            ))}
            {jobs.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No imports yet. Upload your first file on the right.</p> : null}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Current organization</p>
                <h1 className="mt-2 text-3xl font-bold text-ink">{currentOrganizationId ? `Organization #${currentOrganizationId}` : "No organization selected"}</h1>
                <p className="mt-2 text-sm leading-6 text-muted">Use this workspace for CSV and XLSX setup files. Preview never touches live tables until you execute the import.</p>
              </div>
              {selectedJob ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-white px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Status</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{selectedJob.status}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-white px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Rows</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{selectedJob.rowCount}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <SupportAccessBanner grant={session?.supportAccessGrant} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="text-lg font-bold text-ink">Upload a migration file</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Start with one entity type per file. Suppliers, inventory items, supplier-item mappings, and opening inventory all use the same safe preview flow.</p>
              <form className="mt-4 grid gap-4" onSubmit={handleUpload}>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Entity type</span>
                  <select name="entity-scope" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" value={entityScope} onChange={(event) => setEntityScope(event.target.value)}>
                    {DATA_IMPORT_ENTITY_SCOPES.map((scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">File</span>
                  <input name="import-file" type="file" accept=".csv,.xlsx" className="mt-1 block w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" />
                </label>
                <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="submit">
                  <UploadCloud className="h-4 w-4" />
                  Upload file
                </button>
              </form>
              {uploadError ? <p className="mt-3 text-sm text-rose-700">{uploadError}</p> : null}
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">Import state</h2>
                {selectedJob ? <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{selectedJob.entityScope}</span> : null}
              </div>
              {selectedJob ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Preview rows</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{selectedJob.previewRowCount}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Blocked rows</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{selectedJob.blockedRowCount}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Warnings</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{selectedJob.warningCount}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Applied</p>
                    <p className="mt-1 text-lg font-semibold text-ink">{selectedJob.appliedRowCount}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">Upload a file to begin mapping it to Flowtally fields.</p>
              )}
            </Card>
          </div>

          {selectedJob ? (
            <>
              <Card className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-ink">Mapping</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">Source columns are listed on the left. Required fields are marked so we can catch missing values before anything is applied.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => initializeMapping(selectedJob)}>
                      Suggest mappings
                    </button>
                    <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveMapping()}>
                      Save mapping
                    </button>
                    <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void preview()}>
                      Preview
                    </button>
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted">
                        <th className="border-b border-line px-3 py-2">Field</th>
                        <th className="border-b border-line px-3 py-2">Required</th>
                        <th className="border-b border-line px-3 py-2">Source column</th>
                        <th className="border-b border-line px-3 py-2">Fixed value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldSpecs.map((spec) => (
                        <tr key={spec.field} className="align-top">
                          <td className="border-b border-line px-3 py-3">
                            <div className="font-semibold text-ink">{spec.label}</div>
                            <div className="text-xs text-muted">{spec.field}</div>
                          </td>
                          <td className="border-b border-line px-3 py-3">{spec.required ? "Yes" : "No"}</td>
                          <td className="border-b border-line px-3 py-3">
                            <select className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" value={fieldMappings[spec.field] ?? ""} onChange={(event) => setFieldMappings((current) => ({ ...current, [spec.field]: event.target.value }))}>
                              <option value="">Not mapped</option>
                              {sourceColumns.map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="border-b border-line px-3 py-3">
                            <input className="w-full rounded-xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" value={fixedValues[spec.field] ?? ""} onChange={(event) => setFixedValues((current) => ({ ...current, [spec.field]: event.target.value }))} placeholder="Optional fixed value" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mappingError ? <p className="mt-3 text-sm text-rose-700">{mappingError}</p> : null}
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-ink">Preview and execution</h2>
                    <div className="flex flex-wrap gap-2">
                      <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:opacity-60" type="button" onClick={() => void approve()} disabled={selectedJob.blockedRowCount > 0}>
                        <CheckCircle2 className="h-4 w-4" />
                        Approve
                      </button>
                      <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60" type="button" onClick={() => void execute()} disabled={selectedJob.status !== "APPROVED"}>
                        Execute
                      </button>
                      <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:opacity-60" type="button" onClick={() => void rollback()} disabled={!["COMPLETED", "COMPLETED_WITH_WARNINGS"].includes(selectedJob.status)}>
                        <RotateCcw className="h-4 w-4" />
                        Rollback
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
                      {selectedJob.status === "APPROVED"
                        ? "The import is approved and ready to execute."
                        : selectedJob.status === "COMPLETED" || selectedJob.status === "COMPLETED_WITH_WARNINGS"
                          ? "The import has already run. Roll back only if no later dependencies exist."
                          : selectedJob.blockedRowCount > 0
                            ? "Resolve the blocked rows before approval."
                            : "Preview the file first, then approve and execute it."}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-line bg-white p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">Rows blocked</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{rowPreviewStats.blocked}</p>
                      </div>
                      <div className="rounded-2xl border border-line bg-white p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted">Rows ready</p>
                        <p className="mt-1 text-sm font-semibold text-ink">{rowPreviewStats.ready}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <h2 className="text-lg font-bold text-ink">Source columns and samples</h2>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Columns</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {sourceColumns.map((column) => (
                          <span key={column} className="rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold text-ink">
                            {column}
                          </span>
                        ))}
                        {sourceColumns.length === 0 ? <span className="text-sm text-muted">No source columns found.</span> : null}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">Sample rows</p>
                      <pre className="mt-2 max-h-72 overflow-auto rounded-2xl border border-line bg-slate-50 p-4 text-xs text-slate-700">{prettyJson(sampleRows)}</pre>
                    </div>
                  </div>
                </Card>
              </div>

              <Card className="p-6">
                <h2 className="text-lg font-bold text-ink">Row preview and issues</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted">
                        <th className="border-b border-line px-3 py-2">Row</th>
                        <th className="border-b border-line px-3 py-2">Status</th>
                        <th className="border-b border-line px-3 py-2">Issues</th>
                        <th className="border-b border-line px-3 py-2">Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedJob.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-line px-3 py-3 font-semibold text-ink">{row.rowNumber}</td>
                          <td className="border-b border-line px-3 py-3">{row.status}</td>
                          <td className="border-b border-line px-3 py-3">
                            {row.issues.length ? (
                              <ul className="space-y-1">
                                {row.issues.map((issue) => (
                                  <li key={issue.id} className={issue.severity === "blocked" ? "text-rose-700" : "text-amber-700"}>
                                    {issue.fieldName || "row"}: {issue.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted">No issues</span>
                            )}
                          </td>
                          <td className="border-b border-line px-3 py-3 text-muted">
                            {row.targetEntityType}
                            {row.targetEntityId ? ` #${row.targetEntityId}` : ""}
                          </td>
                        </tr>
                      ))}
                      {selectedJob.rows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-sm text-muted" colSpan={4}>
                            No preview rows yet. Save a mapping and click Preview.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-6">
                <h2 className="text-lg font-bold text-ink">Execution summary</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Batch</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{selectedJob.batchId}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Source hash</p>
                    <p className="mt-1 break-all text-sm font-semibold text-ink">{selectedJob.sourceHash}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Rollback blockers</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{selectedJob.rollbackBlockers.length ? selectedJob.rollbackBlockers.join("; ") : "None"}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Applied status</p>
                    <p className="mt-1 text-sm font-semibold text-ink">{selectedJob.status}</p>
                  </div>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}
