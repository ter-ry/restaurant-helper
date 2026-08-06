import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { acceptCustomerInvitation, fetchCustomerSession, startGoogleLogin, type CustomerSessionResponse } from "../lib/customerAuth";

type InvitationState = "loading" | "signedOut" | "ready" | "error" | "accepted";

export function InvitationAcceptPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<InvitationState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const invitationToken = useMemo(() => token.trim(), [token]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const current = await fetchCustomerSession();
        if (cancelled) return;
        setSession(current);
        setState("ready");
      } catch {
        if (cancelled) return;
        setState("signedOut");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAccept() {
    if (!invitationToken) {
      setState("error");
      setMessage("That invitation link is missing its token.");
      return;
    }
    try {
      await acceptCustomerInvitation(invitationToken);
      setState("accepted");
      setMessage("Your invitation was accepted.");
      navigate("/auth/google/complete?status=success", { replace: true });
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not accept the invitation.");
    }
  }

  if (state === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center">
          <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-soft">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
            <h1 className="mt-4 text-2xl font-bold text-ink">Checking invitation</h1>
            <p className="mt-2 text-sm leading-6 text-muted">We’re verifying your invitation and session state.</p>
          </div>
        </div>
      </main>
    );
  }

  if (state === "signedOut") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <ShieldAlert className="h-4 w-4 text-brand-700" />
            Invitation sign-in
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">Sign in with the invited email</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Flowtally will only accept this invitation from the Google account or login session that matches the invited email address.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={startGoogleLogin}>
              Continue with Google
            </button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
              Return home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-700">
            <ShieldAlert className="h-4 w-4" />
            Invitation problem
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">We couldn’t accept that invitation</h1>
          <p className="mt-3 text-sm leading-6 text-muted">{message ?? "The invitation could not be processed."}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={startGoogleLogin}>
              Try signing in again
            </button>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
              Return home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-3xl border border-line bg-white p-6 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <CheckCircle2 className="h-4 w-4 text-brand-700" />
          Invitation ready
        </div>
        <h1 className="mt-3 text-3xl font-bold text-ink">Accept your Flowtally invitation</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {session ? `Signed in as ${session.user.email}.` : "You’re signed in and ready to accept the invitation."}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700" type="button" onClick={() => void handleAccept()}>
            Accept invitation
          </button>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
            Return home
          </Link>
        </div>
        {message ? <p className="mt-4 rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</p> : null}
      </div>
    </main>
  );
}
