import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import {
  activateSetupOrganization,
  approveCustomerReview,
  fetchSetupOrganizations,
  fetchSetupOrganization,
  requestCustomerReview,
  updateCustomFields,
  updateDashboardLayout,
  updateImports,
  updateInternalNotes,
  updateLaunchBlockers,
  updateLocations,
  updateModuleEntitlements,
  updateSetupState,
  updateSetupTemplate,
  updateSquareStatus,
  type PlatformSetupDetail,
  type PlatformSetupOrganizationSummary,
} from "../lib/platformSetup";

type LoadState = "loading" | "signedOut" | "permissionDenied" | "ready" | "error";

const templateOptions = ["GENERIC_RESTAURANT", "CAFE", "BAKERY", "QSR", "MULTI_LOCATION"];
const lifecycleOptions = ["DEMO", "ONBOARDING", "READY_FOR_REVIEW", "ACTIVE", "SUSPENDED", "CANCELLED"];
const setupOptions = ["NOT_STARTED", "INTAKE", "DATA_REQUESTED", "CONFIGURATION_IN_PROGRESS", "CUSTOMER_REVIEW", "COMPLETE"];
const subscriptionOptions = ["NONE", "SETUP_PAYMENT_PENDING", "SETUP_PAID", "ACTIVE", "PAST_DUE", "CANCELLED"];
const moduleStatuses = ["DISABLED", "SETUP_REQUIRED", "CONFIGURING", "READY_FOR_REVIEW", "ENABLED", "SUSPENDED"];

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function splitLines(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function readValue(id: string, fallback: string) {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? fallback;
}

function SetupStateChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

export function SetupConsolePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [organizations, setOrganizations] = useState<PlatformSetupOrganizationSummary[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(null);
  const [selected, setSelected] = useState<PlatformSetupDetail | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [listState, setListState] = useState("ONBOARDING");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const currentOrg = useMemo(() => selected?.organization ?? null, [selected]);
  const checklist = selected?.checklist ?? null;
  const configJson = (selected?.configuration as any)?.currentVersion?.configurationJson ?? {};
  const modules = selected?.modules ?? [];
  const locations = selected?.locations ?? [];
  const auditEvents = selected?.auditEvents ?? [];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const current = await fetchCustomerSession();
        if (cancelled) return;
        setSession(current);
        if (current.platformRole !== "setup_admin" && current.platformRole !== "support") {
          setState("permissionDenied");
          return;
        }
        const response = await fetchSetupOrganizations(listSearch, listState);
        if (cancelled) return;
        setOrganizations(response.organizations);
        const targetId = selectedOrganizationId ?? response.organizations[0]?.organization.id ?? null;
        setSelectedOrganizationId(targetId);
        if (targetId) {
          setSelected(await fetchSetupOrganization(targetId));
        }
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load setup console.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [listSearch, listState, selectedOrganizationId]);

  async function refreshList() {
    const response = await fetchSetupOrganizations(listSearch, listState);
    setOrganizations(response.organizations);
    const targetId = selectedOrganizationId ?? response.organizations[0]?.organization.id ?? null;
    if (targetId) {
      setSelectedOrganizationId(targetId);
      setSelected(await fetchSetupOrganization(targetId));
    } else {
      setSelected(null);
    }
  }

  async function mutate(label: string, handler: () => Promise<PlatformSetupDetail>) {
    if (!selected) {
      return;
    }
    setSaving(label);
    setError(null);
    try {
      const detail = await handler();
      setSelected(detail);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save setup changes.");
    } finally {
      setSaving(null);
    }
  }

  function saveState() {
    if (!selected) return;
    return mutate("state", () =>
      updateSetupState(selected.organization.id, {
        lifecycleStatus: readValue("lifecycle", selected.organization.lifecycleStatus),
        setupStatus: readValue("setup", selected.organization.setupStatus),
        subscriptionStatus: readValue("subscription", selected.organization.subscriptionStatus),
        setupFeeStatus: readValue("fee", selected.organization.setupFeeStatus),
      }),
    );
  }

  function saveTemplate() {
    if (!selected) return;
    return mutate("template", () => updateSetupTemplate(selected.organization.id, readValue("template", selected.organization.setupTemplateKey || "GENERIC_RESTAURANT")));
  }

  function saveLocations() {
    if (!selected) return;
    return mutate("locations", () => updateLocations(selected.organization.id, parseJson<Array<Record<string, unknown>>>(readValue("locations-json", prettyJson(locations)), [])));
  }

  function saveModules() {
    if (!selected) return;
    return mutate("modules", () =>
      updateModuleEntitlements(
        selected.organization.id,
        (modules.length ? modules : templateOptions.map((key) => ({ key, status: "DISABLED" }))).map((module) => ({
          moduleKey: String(module.key),
          status: readValue(`module-${String(module.key)}`, String(module.status)),
        })),
      ),
    );
  }

  function saveDashboard() {
    if (!selected) return;
    return mutate("dashboard", () => {
      const parsed = parseJson<{ layoutKey?: string; locationId?: number | null; widgets?: string[] }>(
        readValue("dashboard-layout-json", prettyJson((configJson as any).dashboardLayouts?.owner ?? { layoutKey: "owner", widgets: [] })),
        { layoutKey: "owner", widgets: [] },
      );
      return updateDashboardLayout(selected.organization.id, {
        layoutKey: parsed.layoutKey ?? "owner",
        locationId: parsed.locationId ?? null,
        widgets: parsed.widgets ?? [],
      });
    });
  }

  function saveCustomFields() {
    if (!selected) return;
    return mutate("custom-fields", () => updateCustomFields(selected.organization.id, parseJson<Record<string, unknown>>(readValue("custom-fields-json", prettyJson((configJson as any).customFields ?? { supplier: [], inventoryItem: [], purchaseInvoice: [] })), {})));
  }

  function saveBlockers() {
    if (!selected) return;
    return mutate("blockers", () => updateLaunchBlockers(selected.organization.id, splitLines(readValue("blockers-text", ((configJson as any).launchBlockers ?? []).join("\n")))));
  }

  function saveNotes() {
    if (!selected) return;
    return mutate("notes", () => updateInternalNotes(selected.organization.id, splitLines(readValue("notes-text", ((configJson as any).internalNotes ?? []).join("\n")))));
  }

  function saveImports() {
    if (!selected) return;
    return mutate("imports", () => updateImports(selected.organization.id, parseJson<Array<Record<string, unknown>>>(readValue("imports-json", prettyJson((configJson as any).imports ?? [])), [])));
  }

  function saveSquare() {
    if (!selected) return;
    return mutate("square", () => updateSquareStatus(selected.organization.id, parseJson<Record<string, unknown>>(readValue("square-json", prettyJson((configJson as any).square ?? {})), {})));
  }

  function requestReview() {
    if (!selected) return;
    return mutate("review", () => requestCustomerReview(selected.organization.id));
  }

  function approveReview() {
    if (!selected) return;
    return mutate("approve", () => approveCustomerReview(selected.organization.id));
  }

  function activateOrganization() {
    if (!selected) return;
    return mutate("activate", () => activateSetupOrganization(selected.organization.id));
  }

  async function handleLoadOrganization(organizationId: number) {
    setSelectedOrganizationId(organizationId);
    setSelected(await fetchSetupOrganization(organizationId));
  }

  if (state === "loading") {
    return (
      <PageLayout title="Internal setup console" eyebrow="Flowtally platform" description="Loading prospective organizations and setup tasks.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading setup console…</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Internal setup console" eyebrow="Flowtally platform" description="Sign in to access the platform console.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Sign in required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google</h1>
          <p className="mt-3 text-sm leading-6 text-muted">This internal console is restricted to platform staff accounts.</p>
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
      <PageLayout title="Internal setup console" eyebrow="Flowtally platform" description="Only platform staff can access this workspace.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">You are not a platform setup administrator</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Ask a platform admin to grant your account the setup_admin role.</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Internal setup console" eyebrow="Flowtally platform" description="Something went wrong while loading the setup console.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load the setup console</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Internal setup console" eyebrow={`Flowtally platform · ${session?.platformRole ?? "platform"}`} description="Configure organizations before launch and track their readiness.">
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Organizations</h2>
            <button className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void refreshList()}>
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Search</span>
              <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" value={listSearch} onChange={(event) => setListSearch(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">State</span>
              <select className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" value={listState} onChange={(event) => setListState(event.target.value)}>
                <option value="">All</option>
                <option value="ONBOARDING">Onboarding</option>
                <option value="READY_FOR_REVIEW">Ready for review</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </label>
          </div>
          <div className="mt-4 space-y-2">
            {organizations.map((entry) => (
              <button
                key={entry.organization.id}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${entry.organization.id === selectedOrganizationId ? "border-brand-200 bg-brand-50" : "border-line bg-white hover:bg-slate-50"}`}
                type="button"
                onClick={() => void handleLoadOrganization(entry.organization.id)}
              >
                <p className="text-sm font-semibold text-ink">{entry.organization.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {entry.organization.lifecycleStatus} · {entry.organization.setupStatus} · {entry.checklist.readyForActivation ? "ready" : "blocked"}
                </p>
              </button>
            ))}
            {organizations.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-slate-50 p-4 text-sm text-muted">No organizations match the current filter.</p> : null}
          </div>
        </Card>

        {selected ? (
          <div key={selected.organization.id} className="grid gap-6">
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">Selected organization</p>
                  <h2 className="mt-2 text-3xl font-bold text-ink">{selected.organization.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">Review the setup checklist, configure modules and launch state, then activate when the checks pass.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SetupStateChip label="Lifecycle" value={selected.organization.lifecycleStatus} />
                  <SetupStateChip label="Setup" value={selected.organization.setupStatus} />
                  <SetupStateChip label="Subscription" value={selected.organization.subscriptionStatus} />
                  <SetupStateChip label="Ready" value={selected.checklist.readyForActivation ? "Yes" : "No"} />
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SetupStateChip label="Locations" value={String(selected.checklist.locationCount)} />
                <SetupStateChip label="Owners" value={String(selected.checklist.ownerCount)} />
                <SetupStateChip label="Missing modules" value={selected.checklist.missingModules.length ? selected.checklist.missingModules.join(", ") : "None"} />
                <SetupStateChip label="Launch blockers" value={selected.checklist.launchBlockers.length ? selected.checklist.launchBlockers.join(", ") : "None"} />
              </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Lifecycle and payment state</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-semibold text-ink">Lifecycle</span>
                    <select id="lifecycle" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" defaultValue={selected.organization.lifecycleStatus}>
                      {lifecycleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-ink">Setup</span>
                    <select id="setup" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" defaultValue={selected.organization.setupStatus}>
                      {setupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-ink">Subscription</span>
                    <select id="subscription" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" defaultValue={selected.organization.subscriptionStatus}>
                      {subscriptionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-ink">Setup fee</span>
                    <select id="fee" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" defaultValue={selected.organization.setupFeeStatus}>
                      <option value="NONE">NONE</option>
                      <option value="pending">pending</option>
                      <option value="confirmed">confirmed</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void saveState()} disabled={saving === "state"}>
                    {saving === "state" ? "Saving..." : "Save state"}
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void saveTemplate()}>
                    Apply template
                  </button>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Template and review</h3>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-ink">Template</span>
                  <select id="template" className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-3 py-2 text-sm outline-none" defaultValue={selected.organization.setupTemplateKey || "GENERIC_RESTAURANT"}>
                    {templateOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void requestReview()}>
                    <ArrowDown className="h-4 w-4" />
                    Request review
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void approveReview()}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve review
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60" type="button" onClick={() => void activateOrganization()} disabled={!selected.checklist.readyForActivation}>
                    <ArrowUp className="h-4 w-4" />
                    Activate organization
                  </button>
                </div>
                <div className="mt-4 rounded-2xl border border-line bg-slate-50 p-4 text-sm text-muted">
                  {selected.checklist.readyForActivation ? "Activation checks are passing." : "Activation is blocked until the checklist passes."}
                </div>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Locations</h3>
                <textarea id="locations-json" className="mt-4 min-h-48 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 font-mono text-xs outline-none" defaultValue={prettyJson(locations)} />
                <button className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void saveLocations()}>
                  Save locations JSON
                </button>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Module entitlements</h3>
                <div className="mt-4 space-y-3">
                  {(modules.length ? modules : templateOptions.map((key) => ({ key, status: "DISABLED" }))).map((module) => (
                    <div key={String(module.key)} className="grid gap-3 rounded-2xl border border-line bg-slate-50 p-3 sm:grid-cols-[1fr_220px]">
                      <div>
                        <p className="text-sm font-semibold text-ink">{String(module.key)}</p>
                        <p className="text-xs text-muted">{String(module.status)}</p>
                      </div>
                      <select className="w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm outline-none" defaultValue={String(module.status)} id={`module-${String(module.key)}`}>
                        {moduleStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <button className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveModules()}>
                  Save modules
                </button>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Dashboard layout</h3>
                <textarea id="dashboard-layout-json" className="mt-4 min-h-44 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 font-mono text-xs outline-none" defaultValue={prettyJson((configJson as any).dashboardLayouts?.owner ?? { layoutKey: "owner", widgets: [] })} />
                <button className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveDashboard()}>
                  Save layout
                </button>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Custom fields</h3>
                <textarea id="custom-fields-json" className="mt-4 min-h-44 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 font-mono text-xs outline-none" defaultValue={prettyJson((configJson as any).customFields ?? { supplier: [], inventoryItem: [], purchaseInvoice: [] })} />
                <button className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveCustomFields()}>
                  Save custom fields
                </button>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Launch blockers and notes</h3>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-ink">Launch blockers</span>
                  <textarea id="blockers-text" className="mt-1 min-h-32 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" defaultValue={((configJson as any).launchBlockers ?? []).join("\n")} />
                </label>
                <button className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveBlockers()}>
                  Save blockers
                </button>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-ink">Internal notes</span>
                  <textarea id="notes-text" className="mt-1 min-h-32 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" defaultValue={((configJson as any).internalNotes ?? []).join("\n")} />
                </label>
                <button className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void saveNotes()}>
                  Save notes
                </button>
              </Card>

              <Card className="p-6">
                <h3 className="text-lg font-bold text-ink">Imports and Square status</h3>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-ink">Imports JSON</span>
                  <textarea id="imports-json" className="mt-1 min-h-32 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 font-mono text-xs outline-none" defaultValue={prettyJson((configJson as any).imports ?? [])} />
                </label>
                <button className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={() => void saveImports()}>
                  Save imports
                </button>
                <label className="mt-4 block">
                  <span className="text-sm font-semibold text-ink">Square JSON</span>
                  <textarea id="square-json" className="mt-1 min-h-32 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 font-mono text-xs outline-none" defaultValue={prettyJson((configJson as any).square ?? {})} />
                </label>
                  <button className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void saveSquare()}>
                    Save Square status
                  </button>
                  <Link className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/imports">
                    Open migration workspace
                  </Link>
                </Card>
            </div>

            <Card className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ink">Review and activation checks</h3>
                <div className="flex flex-wrap gap-2">
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void requestReview()}>
                    <ArrowDown className="h-4 w-4" />
                    Request review
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void approveReview()}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve review
                  </button>
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60" type="button" onClick={() => void activateOrganization()} disabled={!selected.checklist.readyForActivation}>
                    <ArrowUp className="h-4 w-4" />
                    Activate organization
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Object.entries({
                  owner: selected.checklist.ownerCount > 0,
                  locations: selected.checklist.locationCount > 0,
                  setupFee: selected.checklist.setupFeeStatus === "confirmed",
                  setupComplete: selected.checklist.setupStatus === "COMPLETE",
                  subscriptionActive: selected.checklist.subscriptionStatus === "ACTIVE",
                  customerApproved: selected.checklist.customerApproved,
                  noBlockers: selected.checklist.launchBlockers.length === 0,
                  modulesReady: selected.checklist.missingModules.length === 0,
                  squareReady: selected.checklist.squareComplete,
                }).map(([label, ok]) => (
                  <div key={label} className={`rounded-2xl border p-4 text-sm font-semibold ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
                    {ok ? <CheckCircle2 className="mb-2 h-4 w-4" /> : <AlertTriangle className="mb-2 h-4 w-4" />}
                    {label}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-bold text-ink">Recent audit activity</h3>
              <div className="mt-4 space-y-3">
                {auditEvents.length ? auditEvents.map((event) => (
                  <div key={String(event.id)} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-ink">{String(event.eventType)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {String(event.entityType)} · {String(event.createdAt)}
                    </p>
                  </div>
                )) : <p className="text-sm text-muted">No audit activity recorded yet.</p>}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="p-6">
            <p className="text-sm text-muted">Select an organization from the list to review setup.</p>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
