import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import { fetchCustomerAuditEvents, type CustomerAuditEvent } from "../lib/audit";

type LoadState = "loading" | "signedOut" | "permissionDenied" | "ready" | "error";

function formatMetadata(event: CustomerAuditEvent) {
  if (!event.metadata) {
    return "No extra metadata.";
  }
  return Object.entries(event.metadata)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

export function OwnerAuditPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [events, setEvents] = useState<CustomerAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const current = await fetchCustomerSession();
        if (cancelled) return;
        setSession(current);
        if (current.membershipRole !== "owner") {
          setState("permissionDenied");
          return;
        }
        const response = await fetchCustomerAuditEvents();
        if (cancelled) return;
        setEvents(response.events);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load audit events.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return events;
    }
    return events.filter((event) => {
      const haystack = [event.eventType, event.entityType, String(event.entityId ?? ""), event.createdAt, formatMetadata(event)].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [events, search]);

  if (state === "loading") {
    return (
      <PageLayout title="Owner audit history" eyebrow="Flowtally commercial access" description="Loading the latest recorded activity.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading audit events…</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Owner audit history" eyebrow="Flowtally commercial access" description="Sign in to view organization activity.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Sign in required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google to review audit activity</h1>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/reports">
              Reports &amp; exports
            </Link>
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
      <PageLayout title="Owner audit history" eyebrow="Flowtally commercial access" description="Only organization owners can view detailed audit records.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">You do not have access to owner audit history</h1>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Owner audit history" eyebrow="Flowtally commercial access" description="Something went wrong while loading audit events.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load the audit feed</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Owner audit history" eyebrow="Flowtally commercial access" description="Search the latest activity recorded for this organization.">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted">
          Organization: {session?.organizations?.find((entry) => entry.selected)?.organization.name ?? "Current organization"}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/reports">
            Reports &amp; exports
          </Link>
          <label className="flex min-w-64 flex-1 max-w-lg items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3">
            <Activity className="h-4 w-4 text-brand-700" />
            <input className="w-full border-0 bg-transparent text-sm outline-none" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search event type, entity or metadata" />
          </label>
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm leading-6 text-muted">No audit events match the current search.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event) => (
            <Card key={event.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{event.eventType}</p>
                  <p className="mt-1 text-sm text-muted">
                    {event.entityType}
                    {event.entityId !== null ? ` #${event.entityId}` : ""}
                    {event.locationId !== null ? ` · location ${event.locationId}` : ""}
                  </p>
                </div>
                <p className="text-xs uppercase tracking-wide text-muted">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{formatMetadata(event)}</p>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
