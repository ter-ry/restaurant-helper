import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Copy, Loader2, Mail, ShieldAlert, Trash2, Users } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { CustomerApiError, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";
import { cancelCustomerInvitation, createCustomerInvitation, fetchCustomerInvitations, type CustomerInvitation } from "../lib/invitations";

type LoadState = "loading" | "signedOut" | "ready" | "permissionDenied" | "error";

function InvitationBadge({ status }: { status: string }) {
  const tone = status === "accepted" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : status === "pending" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-slate-50 text-slate-700 border-line";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${tone}`}>{status}</span>;
}

function formatInvitationStatus(invitation: CustomerInvitation) {
  if (invitation.status === "pending") {
    return invitation.expiresAt ? `Pending until ${new Date(invitation.expiresAt).toLocaleDateString()}` : "Pending";
  }
  if (invitation.status === "accepted") {
    return invitation.acceptedAt ? `Accepted ${new Date(invitation.acceptedAt).toLocaleDateString()}` : "Accepted";
  }
  if (invitation.status === "revoked") {
    return "Revoked";
  }
  if (invitation.status === "expired") {
    return "Expired";
  }
  return invitation.status;
}

export function TeamManagementPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [invitations, setInvitations] = useState<CustomerInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [submitting, setSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [recentInvitationUrl, setRecentInvitationUrl] = useState<string | null>(null);

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
        const response = await fetchCustomerInvitations();
        if (cancelled) return;
        setInvitations(response.invitations);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CustomerApiError && err.status === 401) {
          setState("signedOut");
          return;
        }
        setState("error");
        setError(err instanceof Error ? err.message : "Could not load team management.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const organizationName = useMemo(() => {
    const selected = session?.organizations?.find((entry) => entry.selected)?.organization.name;
    return selected ?? (session?.currentOrganizationId ? "Current organization" : "Team management");
  }, [session]);

  async function refreshInvitations() {
    const response = await fetchCustomerInvitations();
    setInvitations(response.invitations);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCopyMessage(null);
    try {
      const response = await createCustomerInvitation(email, role);
      setEmail("");
      setRecentInvitationUrl(response.invitationUrl);
      await refreshInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(invitationId: number) {
    try {
      await cancelCustomerInvitation(invitationId);
      await refreshInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the invitation.");
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      setCopyMessage("Invitation link copied.");
    } catch {
      setCopyMessage("Copy the link from the address bar if clipboard access is blocked.");
    }
  }

  if (state === "loading") {
    return (
      <PageLayout title="Team management" eyebrow="Flowtally commercial access" description="Loading your organization and invitation state.">
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
          <p className="mt-4 text-sm text-muted">Loading team management…</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "signedOut") {
    return (
      <PageLayout title="Team management" eyebrow="Flowtally commercial access" description="Sign in to manage manager invitations.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Sign in required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">Continue with Google to manage your team</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Invitation management is available to the owner of the current organization.</p>
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
      <PageLayout title="Team management" eyebrow="Flowtally commercial access" description="This screen is limited to organization owners.">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Permission denied
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">You do not have owner access</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Please ask the organization owner to manage invitations or roles.</p>
        </Card>
      </PageLayout>
    );
  }

  if (state === "error") {
    return (
      <PageLayout title="Team management" eyebrow="Flowtally commercial access" description="Something went wrong while loading invitations.">
        <Card className="border-rose-200 bg-rose-50 p-6 text-rose-950">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Load error
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink">We couldn’t load team management</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{error ?? "Try again in a moment."}</p>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Team management" eyebrow="Flowtally commercial access" description="Create, copy, and revoke invitation links for managers.">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <Users className="h-4 w-4 text-brand-700" />
            Owner tools
          </div>
          <h2 className="mt-3 text-2xl font-bold text-ink">{organizationName}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Invite managers to help with purchasing and inventory. Invitations are single-use and tied to the invited email address.
          </p>

          <form className="mt-5 grid gap-4" onSubmit={handleCreate}>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Invitee email</span>
              <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-ink">Role</span>
              <select className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="manager">Manager</option>
              </select>
            </label>
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="submit" disabled={submitting}>
              <Mail className="h-4 w-4" />
              {submitting ? "Creating invitation..." : "Create invitation"}
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/audit">
              Audit history
            </Link>
          </div>

          {recentInvitationUrl ? (
            <div className="mt-5 rounded-2xl border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold text-ink">Latest invitation URL</p>
              <p className="mt-2 break-all rounded-xl border border-dashed border-line bg-white px-3 py-2 text-xs text-muted">{new URL(recentInvitationUrl, window.location.origin).toString()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void handleCopy(recentInvitationUrl)}>
                  <Copy className="h-4 w-4" />
                  Copy link
                </button>
              </div>
            </div>
          ) : null}

          {copyMessage ? <p className="mt-4 rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">{copyMessage}</p> : null}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
                <CheckCircle2 className="h-4 w-4 text-brand-700" />
                Pending and historical invitations
              </div>
              <h2 className="mt-3 text-2xl font-bold text-ink">Invitation links</h2>
            </div>
          </div>

          {invitations.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-line bg-slate-50 p-6 text-sm leading-6 text-muted">
              No invitations yet. Create the first manager invite from the form on the left.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{invitation.invitedEmail}</p>
                      <p className="text-xs text-muted">{formatInvitationStatus(invitation)}</p>
                    </div>
                    <InvitationBadge status={invitation.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {invitation.status === "pending" ? (
                      <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => void handleCancel(invitation.id)}>
                        <Trash2 className="h-4 w-4" />
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageLayout>
  );
}
