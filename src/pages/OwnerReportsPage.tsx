import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, ShieldAlert, FileText, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import { fetchCustomerAuditEvents, type CustomerAuditEvent } from "../lib/audit";
import { downloadCsvFile } from "../lib/reportExports";
import { fetchPilotDashboard, fetchPilotPurchases, type PilotDashboardResponse, type PilotPurchasesResponse } from "../pilot/pilotApi";
import { formatCurrency, formatDate, formatPercent } from "../utils/format";

type LoadState = "loading" | "signedOut" | "permissionDenied" | "ready" | "error";

type OwnerReportsData = {
  session: CustomerSessionResponse;
  dashboard: PilotDashboardResponse;
  purchases: PilotPurchasesResponse;
  auditEvents: CustomerAuditEvent[];
};

type DashboardSupplierSpendRow = {
  supplier: string;
  spend: number;
  invoiceCount: number;
};

type DashboardPriceChangeRow = {
  itemName: string;
  supplier: string;
  invoiceDate: string;
  changePercent: number;
  status: string;
};

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

type StatusRow = {
  section: string;
  status: string;
  detail: string;
  tone: StatusTone;
};

function toneForStatus(status: string): StatusTone {
  if (status === "Ready" || status === "Done" || status === "Balanced" || status === "Captured") {
    return "success";
  }
  if (status === "Needs review" || status === "Needs mapping" || status === "Not ready" || status === "Incomplete") {
    return "warning";
  }
  if (status === "No events") {
    return "info";
  }
  return "neutral";
}

function safeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "organization";
}

function buildSummaryRows(data: OwnerReportsData): StatusRow[] {
  const activeOrganization = data.session.organizations?.find((entry) => entry.selected)?.organization ?? null;
  const purchaseReady = data.purchases.exportReadiness.readyForCsv;
  const needsReview = data.purchases.exportReadiness.needsReview;
  const needsMapping = data.purchases.exportReadiness.needsMapping;
  const exportStatus = purchaseReady > 0 && needsReview === 0 && needsMapping === 0 ? "Ready" : needsReview > 0 ? "Needs review" : needsMapping > 0 ? "Needs mapping" : "Not ready";
  const monthlyStatus = exportStatus === "Ready" && (data.dashboard.summary.inventoryMovementCount ?? 0) > 0 && data.dashboard.workflow.close === "Done" ? "Ready" : "Needs review";

  return [
    {
      section: "Purchase CSV",
      status: exportStatus,
      detail: `${purchaseReady} invoices are ready for bookkeeping export.`,
      tone: toneForStatus(exportStatus),
    },
    {
      section: "Supplier spend",
      status: data.dashboard.supplierSpend.length > 0 ? "Ready" : "Not ready",
      detail: data.dashboard.supplierSpend.length > 0 ? `${data.dashboard.supplierSpend[0].supplier} leads spending this period.` : "No supplier spend is available yet.",
      tone: toneForStatus(data.dashboard.supplierSpend.length > 0 ? "Ready" : "Not ready"),
    },
    {
      section: "Inventory summary",
      status: (data.dashboard.summary.inventoryItemCount ?? 0) > 0 ? "Ready" : "Not ready",
      detail: `${data.dashboard.summary.inventoryItemCount ?? 0} items and ${(data.dashboard.summary.inventoryMovementCount ?? 0)} movement records tracked.`,
      tone: toneForStatus((data.dashboard.summary.inventoryItemCount ?? 0) > 0 ? "Ready" : "Not ready"),
    },
    {
      section: "Daily close",
      status: data.dashboard.workflow.close,
      detail: data.dashboard.workflow.close === "Done" ? "Close workflow is caught up." : "Daily close still needs attention.",
      tone: toneForStatus(data.dashboard.workflow.close),
    },
    {
      section: "Price changes",
      status: (data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? "Captured" : "No events",
      detail: (data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? `${data.dashboard.summary.recentPriceChangeCount} recent price changes flagged.` : "No price changes were detected.",
      tone: toneForStatus((data.dashboard.summary.recentPriceChangeCount ?? 0) > 0 ? "Captured" : "No events"),
    },
    {
      section: "Monthly owner report",
      status: monthlyStatus,
      detail: activeOrganization ? `${activeOrganization.name} is ready for the accountant handoff when the blockers clear.` : "Select an organization to continue.",
      tone: toneForStatus(monthlyStatus),
    },
    {
      section: "Audit trail",
      status: data.auditEvents.length > 0 ? "Ready" : "No events",
      detail: data.auditEvents.length > 0 ? `${data.auditEvents.length} audit events captured for the current organization.` : "No audit events have been recorded yet.",
      tone: toneForStatus(data.auditEvents.length > 0 ? "Ready" : "No events"),
    },
  ];
}

function buildSummaryCsvRows(rows: StatusRow[]) {
  return rows.map((row) => ({
    section: row.section,
    status: row.status,
    detail: row.detail,
  }));
}

function buildPurchaseCsvRows(data: OwnerReportsData) {
  return [...data.purchases.invoices]
    .slice(0, 20)
    .map((invoice) => ({
      invoiceDate: invoice.invoiceDate,
      invoiceNumber: invoice.invoiceNumber,
      supplier: invoice.supplier?.name ?? "",
      status: invoice.status,
      totalAmount: invoice.totalAmount,
      lineCount: invoice.lineItems.length,
    }));
}

function buildAuditCsvRows(events: CustomerAuditEvent[]) {
  return events.slice(0, 50).map((event) => ({
    createdAt: event.createdAt,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId ?? "",
    locationId: event.locationId ?? "",
    metadata: event.metadata ? JSON.stringify(event.metadata) : "",
  }));
}

export function OwnerReportsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<OwnerReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = await fetchCustomerSession();
        if (cancelled) return;
        if (session.membershipRole !== "owner") {
          setState("permissionDenied");
          return;
        }

        const [dashboard, purchases, auditEvents] = await Promise.all([
          fetchPilotDashboard(),
          fetchPilotPurchases(),
          fetchCustomerAuditEvents(),
        ]);

        if (cancelled) return;
        setData({ session, dashboard, purchases, auditEvents: auditEvents.events });
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        if (err instanceof CustomerApiError && err.status === 403) {
          setState("permissionDenied");
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load reports.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrganization = data?.session.organizations?.find((entry) => entry.selected)?.organization ?? null;
  const summaryRows = useMemo(() => (data ? buildSummaryRows(data) : []), [data]);
  const summaryCsvRows = useMemo(() => buildSummaryCsvRows(summaryRows), [summaryRows]);
  const purchaseCsvRows = useMemo(() => (data ? buildPurchaseCsvRows(data) : []), [data]);
  const auditCsvRows = useMemo(() => (data ? buildAuditCsvRows(data.auditEvents) : []), [data]);
  const topSupplier = (data?.dashboard.supplierSpend[0] as DashboardSupplierSpendRow | undefined) ?? null;
  const latestInvoice = data?.purchases.invoices[0] ?? null;
  const latestPriceChange = (data?.dashboard.recentPriceChanges[0] as DashboardPriceChangeRow | undefined) ?? null;

  const downloadPrefix = safeFilenamePart(activeOrganization?.name ?? "organization");
  const summaryReady = summaryRows.some((row) => row.section === "Monthly owner report" && row.status === "Ready");

  if (state === "loading") {
    return (
      <PageLayout title="Reports & exports" eyebrow="Flowtally commercial access" description="Loading the owner reporting workspace.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading reports and export readiness…</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Reports & exports" eyebrow="Flowtally commercial access" description="Sign in to review owner reports and exports.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Sign in required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google to open owner reports</h1>
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
      <PageLayout title="Reports & exports" eyebrow="Flowtally commercial access" description="Only organization owners can view detailed reports.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">You do not have owner access to reporting</h1>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Reports & exports" eyebrow="Flowtally commercial access" description="Something went wrong while loading reports.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load reports and exports</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Reports & exports"
      eyebrow="Authenticated owner workspace"
      description="Owner reporting, export readiness, and the latest audit trail for the active organization."
    >
      <Card className="p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{activeOrganization?.name ?? "Current organization"}</Badge>
              <Badge tone={summaryReady ? "success" : "warning"}>{summaryReady ? "Export ready" : "Needs review"}</Badge>
              <Badge tone="neutral">Location {data?.session.currentLocationId ?? "n/a"}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Reporting that stays tied to the live organization</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              These summaries are built from the authenticated owner APIs, not the demo seed state. Use them to review weekly spend, export readiness, and the latest audit activity before handing records off.
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Top supplier: {topSupplier ? topSupplier.supplier : "None yet"}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {latestInvoice ? <span className="rounded-full border border-line bg-white px-3 py-1">Latest invoice: {latestInvoice.supplier?.name ?? "Supplier"} · {latestInvoice.invoiceNumber || "No number"}</span> : null}
              {latestPriceChange ? <span className="rounded-full border border-line bg-white px-3 py-1">Latest price change: {latestPriceChange.itemName}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              icon={<Download className="h-4 w-4" />}
              onClick={() => downloadCsvFile(`flowtally-owner-report-${downloadPrefix}.csv`, summaryCsvRows)}
            >
              Download summary CSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<FileText className="h-4 w-4" />}
              onClick={() => downloadCsvFile(`flowtally-purchases-${downloadPrefix}.csv`, purchaseCsvRows)}
            >
              Download purchase CSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<ListChecks className="h-4 w-4" />}
              onClick={() => downloadCsvFile(`flowtally-audit-${downloadPrefix}.csv`, auditCsvRows)}
            >
              Download audit CSV
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Weekly invoice spend</p>
          <p className="mt-3 text-2xl font-bold text-ink">{formatCurrency(data?.dashboard.summary.weeklyInvoiceSpend ?? 0)}</p>
          <p className="mt-2 text-sm leading-6 text-muted">{data?.dashboard.summary.weeklyInvoiceCount ?? 0} invoices this week</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Invoices ready for CSV</p>
          <p className="mt-3 text-2xl font-bold text-ink">{data?.purchases.exportReadiness.readyForCsv ?? 0}</p>
          <p className="mt-2 text-sm leading-6 text-muted">{data?.purchases.exportReadiness.needsReview ?? 0} still need review</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Inventory items to reorder</p>
          <p className="mt-3 text-2xl font-bold text-ink">{data?.dashboard.summary.inventoryItemsToReorderCount ?? 0}</p>
          <p className="mt-2 text-sm leading-6 text-muted">{data?.dashboard.summary.inventoryLowStockCount ?? 0} low stock / {data?.dashboard.summary.inventoryOutOfStockCount ?? 0} out of stock</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Audit events</p>
          <p className="mt-3 text-2xl font-bold text-ink">{data?.auditEvents.length ?? 0}</p>
          <p className="mt-2 text-sm leading-6 text-muted">Latest owner activity recorded for this organization</p>
        </Card>
      </div>

      <section className="mt-8">
        <SectionHeader title="Report readiness" description="The handoff checklist stays visible so the export state is never a mystery." />
        <div className="grid gap-3 md:grid-cols-2">
          {summaryRows.map((row) => (
            <Card key={row.section} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{row.section}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{row.detail}</p>
                </div>
                <Badge tone={row.tone}>{row.status}</Badge>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-2">
        <div>
          <SectionHeader title="Supplier spend" description="The biggest vendor buckets that feed owner reporting." />
          <div className="space-y-3">
            {((data?.dashboard.supplierSpend as DashboardSupplierSpendRow[] | undefined) ?? []).slice(0, 5).map((supplier) => (
              <Card key={supplier.supplier} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{supplier.supplier}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">{supplier.invoiceCount} invoices in the current period</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink">{formatCurrency(supplier.spend)}</p>
                    <p className="mt-1 text-xs text-muted">{supplier.invoiceCount > 1 ? "Repeated supplier" : "Top supplier"}</p>
                  </div>
                </div>
              </Card>
            ))}
            {(data?.dashboard.supplierSpend.length ?? 0) === 0 ? <Card className="p-4 text-sm text-muted">No supplier spend yet.</Card> : null}
          </div>
        </div>

        <div>
          <SectionHeader title="Recent invoices" description="The latest purchases that feed the CSV and report handoff." />
          <div className="space-y-3">
            {(data?.purchases.invoices ?? []).slice(0, 5).map((invoice) => (
              <Card key={invoice.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{invoice.supplier?.name ?? "Supplier"}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {invoice.invoiceNumber || "No invoice number"} · {formatDate(invoice.invoiceDate)} · {invoice.lineItems.length} lines
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink">{formatCurrency(invoice.totalAmount)}</p>
                    <Badge tone={invoice.status === "Completed" ? "success" : invoice.status === "Ready" ? "info" : "warning"}>{invoice.status}</Badge>
                  </div>
                </div>
              </Card>
            ))}
            {(data?.purchases.invoices.length ?? 0) === 0 ? <Card className="p-4 text-sm text-muted">No invoices yet.</Card> : null}
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-2">
        <div>
          <SectionHeader title="Price changes" description="The largest purchase-driven changes that affect menu margin." />
          <div className="space-y-3">
            {((data?.dashboard.recentPriceChanges as DashboardPriceChangeRow[] | undefined) ?? []).slice(0, 5).map((change) => (
              <Card key={`${change.itemName}-${change.invoiceDate}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{change.itemName}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">{change.supplier} · {formatDate(change.invoiceDate)}</p>
                  </div>
                  <Badge tone={change.status === "Increased" ? "warning" : change.status === "Decreased" ? "success" : "neutral"}>{formatPercent(change.changePercent)}</Badge>
                </div>
              </Card>
            ))}
            {(data?.dashboard.recentPriceChanges.length ?? 0) === 0 ? <Card className="p-4 text-sm text-muted">No price changes have been detected yet.</Card> : null}
          </div>
        </div>

        <div>
          <SectionHeader title="Audit trail" description="The latest activity that belongs to the current organization." />
          <div className="space-y-3">
            {(data?.auditEvents ?? []).slice(0, 5).map((event) => (
              <Card key={event.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{event.eventType}</p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {event.entityType}{event.entityId !== null ? ` #${event.entityId}` : ""}{event.locationId !== null ? ` · location ${event.locationId}` : ""}
                    </p>
                  </div>
                  <p className="text-xs uppercase tracking-wide text-muted">{new Date(event.createdAt).toLocaleString()}</p>
                </div>
              </Card>
            ))}
            {(data?.auditEvents.length ?? 0) === 0 ? <Card className="p-4 text-sm text-muted">No audit events yet.</Card> : null}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Owner tools</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Use the owner report to review export readiness, then move to team management or the audit log when you need to investigate changes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/team">
                Team management
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/audit">
                Audit history
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" to="/platform/setup">
                Platform setup
              </Link>
            </div>
          </div>
        </Card>
      </section>
    </PageLayout>
  );
}
