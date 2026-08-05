import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { usePilotSession } from "./PilotSessionProvider";

export function PilotLoginPage() {
  const navigate = useNavigate();
  const { status, error, signIn } = usePilotSession();
  const [email, setEmail] = useState("owner@flowtally.local");
  const [password, setPassword] = useState("PilotOwner123!");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (status === "signedIn" || status === "needsSelection") {
    return <Navigate to="/app" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      await signIn(email, password);
      navigate("/app", { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-5 rounded-3xl border border-line bg-ink p-6 text-white shadow-soft sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand-100">Pilot access</p>
          <h1 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Flowtally pilot foundation</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            Sign in to the private pilot workspace where one restaurant can test the operational core before any broader rollout.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Auth", "Protected login"],
              ["Tenant", "Explicit org + location"],
              ["Session", "Cookie + CSRF"],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-100">{label}</p>
                <p className="mt-1 text-sm text-slate-200">{detail}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            <p className="font-semibold text-white">Seed accounts</p>
            <p className="mt-1">Owner: owner@flowtally.local / PilotOwner123!</p>
            <p>Manager: manager@flowtally.local / PilotManager123!</p>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-6 shadow-soft sm:p-8">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
              <LockKeyhole className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted">Login</p>
              <h2 className="mt-1 text-2xl font-bold text-ink">Open the pilot app</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                This private workspace is separate from the public demo. It uses the backend session and tenant records seeded for the pilot.
              </p>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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

            {(error || formError) ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                {formError ?? error}
              </div>
            ) : null}

            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting || status === "loading"}
              type="submit"
            >
              {submitting || status === "loading" ? "Signing in..." : "Sign in to pilot"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              What this proves
            </div>
            <p className="mt-2">
              Login, logout, current organization lookup, and tenant-scoped location selection are all wired before the pilot expands further.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
