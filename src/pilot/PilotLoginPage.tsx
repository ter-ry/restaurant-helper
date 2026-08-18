import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { startGoogleLogin } from "../lib/customerAuth";
import { pilotSeedLoginEnabled } from "./pilotConfig";
import { usePilotSession } from "./PilotSessionProvider";

function useLoginReturnTo() {
  const location = useLocation();

  return useMemo(() => {
    const query = new URLSearchParams(location.search);
    const candidate = (typeof location.state === "object" && location.state && "redirectTo" in location.state ? String((location.state as { redirectTo?: unknown }).redirectTo ?? "") : "") || query.get("redirectTo") || "/app";
    if (!candidate.startsWith("/") || candidate.startsWith("//")) {
      return "/app";
    }
    return candidate;
  }, [location.search, location.state]);
}

function SeedLoginForm({ returnTo }: { returnTo: string }) {
  const { error, signIn, status } = usePilotSession();
  const [email, setEmail] = useState("owner@flowtally.local");
  const [password, setPassword] = useState("PilotOwner123!");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await signIn(email, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-4 rounded-3xl border border-line bg-white p-6 shadow-soft" onSubmit={handleSubmit}>
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
          <LockKeyhole className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Local development only</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">Developer sign-in</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            This form is available only when the seed-login flag is intentionally enabled. Commercial and staging builds should use Google sign-in instead.
          </p>
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Email</span>
        <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-4 py-3">
          <Mail className="h-4 w-4 text-muted" />
          <input
            autoComplete="email"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Password</span>
        <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-slate-50 px-4 py-3">
          <LockKeyhole className="h-4 w-4 text-muted" />
          <input
            autoComplete="current-password"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </label>

      {(error || formError) ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{formError ?? error}</div> : null}

      <div className="flex flex-wrap gap-3">
        <button
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting || status === "loading"}
          type="submit"
        >
          {submitting || status === "loading" ? "Signing in..." : "Sign in locally"}
          <ArrowRight className="h-4 w-4" />
        </button>
        <Link className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to={returnTo}>
          Return to app
        </Link>
      </div>
    </form>
  );
}

export function PilotLoginPage() {
  const { status, error } = usePilotSession();
  const returnTo = useLoginReturnTo();
  const [launchingGoogle, setLaunchingGoogle] = useState(false);

  if (status === "signedIn" || status === "needsSelection") {
    return <Navigate to={returnTo} replace />;
  }

  async function handleGoogleLogin() {
    setLaunchingGoogle(true);
    try {
      startGoogleLogin({ returnTo });
    } catch {
      setLaunchingGoogle(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-6 rounded-3xl border border-line bg-ink p-6 text-white shadow-soft sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-100">Flowtally customer access</p>
          <h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Sign in to Flowtally</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            Use your Google account to return to your restaurant workspace, continue onboarding, or pick up where you left off.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Auth", "Google sign-in"],
              ["Tenant", "Selected org + location"],
              ["Session", "Secure cookie + CSRF"],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-100">{label}</p>
                <p className="mt-1 text-sm text-slate-200">{detail}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            <div className="flex items-center gap-2 font-semibold text-white">
              <ShieldCheck className="h-4 w-4" />
              Safe customer access
            </div>
            <p className="mt-2">
              We do not show shared seed credentials in the commercial experience. If you need local developer sign-in, enable it explicitly in the dev environment.
            </p>
          </div>

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}
        </section>

        <section className="space-y-4 rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Login</p>
              <h2 className="mt-1 text-2xl font-bold text-ink">Continue with Google</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                This takes you to the Flowtally Google sign-in flow and then returns you to your workspace.
              </p>
            </div>
          </div>

          <button
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={launchingGoogle || status === "loading"}
            type="button"
            onClick={() => void handleGoogleLogin()}
          >
            {launchingGoogle || status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to Google...
              </>
            ) : (
              <>
                Continue with Google
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="text-sm leading-6 text-muted">
            We’ll restore your selected restaurant and location where possible, or continue you through onboarding if your organization is still a prospect.
          </p>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Want to open the app you were using?
            </div>
            <p className="mt-2">We preserve your destination after sign-in so returning customers can land back on the right page.</p>
            <Link className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-900" to={returnTo}>
              Return to app
            </Link>
          </div>

          {pilotSeedLoginEnabled() ? <SeedLoginForm returnTo={returnTo} /> : null}
        </section>
      </div>
    </main>
  );
}
