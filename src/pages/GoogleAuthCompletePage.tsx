import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2, LogOut, MapPin, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import {
  createCustomerProspectOrganization,
  fetchCustomerSession,
  logoutCustomer,
  requestCustomerSetup,
  startGoogleLogin,
  type CustomerSessionResponse,
} from "../lib/customerAuth";

type AuthState = "loading" | "error" | "signedOut" | "signedIn" | "needsOnboarding";

function useQueryParams() {
  const location = useLocation();
  return useMemo(() => new URLSearchParams(location.search), [location.search]);
}

function GoogleAuthErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-soft">
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-800">
        <ShieldAlert className="h-4 w-4" />
        Registration issue
      </div>
      <h1 className="mt-3 text-2xl font-bold text-amber-950">We couldn’t complete Google sign-in</h1>
      <p className="mt-3 text-sm leading-6 text-amber-900">{message}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white" type="button" onClick={startGoogleLogin}>
          Try Google again
        </button>
        <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-950" to="/">
          Return home
        </Link>
      </div>
    </div>
  );
}

function ProspectOnboardingForm({
  session,
  onCreated,
}: {
  session: CustomerSessionResponse;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [city, setCity] = useState("Toronto");
  const [region, setRegion] = useState("ON");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Canada");
  const [timezone, setTimezone] = useState("America/Toronto");
  const [templateKey, setTemplateKey] = useState("GENERIC_RESTAURANT");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCustomerProspectOrganization({
        name,
        locationName,
        city,
        region,
        postalCode,
        country,
        timezone,
        templateKey,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your organization.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4 rounded-3xl border border-line bg-white p-6 shadow-soft md:grid-cols-2" onSubmit={handleSubmit}>
      <div className="md:col-span-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Create your account</p>
        <h2 className="mt-1 text-2xl font-bold text-ink">Set up your first restaurant</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          We’ll create one prospective organization for {session.user.email}. You can add more setup details later.
        </p>
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Business name</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Template</span>
        <select className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
          <option value="GENERIC_RESTAURANT">Independent restaurant</option>
          <option value="CAFE">Café</option>
          <option value="BAKERY">Bakery</option>
          <option value="QSR">Quick-service restaurant</option>
          <option value="MULTI_LOCATION">Multi-location restaurant</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Location name</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={locationName} onChange={(event) => setLocationName(event.target.value)} required />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">City</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={city} onChange={(event) => setCity(event.target.value)} required />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Region</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={region} onChange={(event) => setRegion(event.target.value)} />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Postal code</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Country</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={country} onChange={(event) => setCountry(event.target.value)} />
      </label>

      <label className="block">
        <span className="text-sm font-semibold text-ink">Timezone</span>
        <input className="mt-1 w-full rounded-2xl border border-line bg-slate-50 px-4 py-3 text-sm outline-none" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
      </label>

      {error ? <div className="md:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}

      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="submit" disabled={submitting}>
          {submitting ? "Creating workspace..." : "Create your workspace"}
          <ArrowRight className="h-4 w-4" />
        </button>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={startGoogleLogin}>
          Start over with Google
        </button>
      </div>
    </form>
  );
}

function LoggedInProspectView({
  session,
  onLogout,
  onRequestSetup,
}: {
  session: CustomerSessionResponse;
  onLogout: () => Promise<void>;
  onRequestSetup: () => Promise<void>;
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [requestingSetup, setRequestingSetup] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const currentOrganization = session.organizations?.find((entry) => entry.selected)?.organization ?? null;
  const currentRole = session.membershipRole ?? "owner";
  const setupStatus = currentOrganization?.setupStatus ?? "NOT_STARTED";
  const lifecycleStatus = currentOrganization?.lifecycleStatus ?? "ONBOARDING";
  const subscriptionStatus = currentOrganization?.subscriptionStatus ?? "NONE";
  const progress = [
    ["Account created", true],
    ["Business information", true],
    ["Data requested", setupStatus !== "NOT_STARTED"],
    ["Configuration", setupStatus === "CONFIGURATION_IN_PROGRESS" || setupStatus === "CUSTOMER_REVIEW" || setupStatus === "COMPLETE"],
    ["Customer review", setupStatus === "CUSTOMER_REVIEW" || setupStatus === "COMPLETE"],
    ["Ready to launch", setupStatus === "COMPLETE" && lifecycleStatus === "READY_FOR_REVIEW"],
  ] as const;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleRequestSetup() {
    if (!currentOrganization) {
      return;
    }
    setRequestingSetup(true);
    setSetupMessage(null);
    try {
      await requestCustomerSetup(currentOrganization.id);
      setSetupMessage("Setup request sent. We’ll review the workspace and move it forward.");
      await onRequestSetup();
    } catch (err) {
      setSetupMessage(err instanceof Error ? err.message : "Could not request setup.");
    } finally {
      setRequestingSetup(false);
    }
  }

  return (
    <div className="grid gap-6 rounded-3xl border border-line bg-white p-6 shadow-soft md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Logged-in prospect</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Welcome back, {session.user.email}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Your Flowtally workspace is ready for onboarding. You can review your setup status, add more details, and finish launch preparation from here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700" to="/demo">
            Keep exploring the demo
          </Link>
          {lifecycleStatus === "ACTIVE" ? (
            <>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/team">
                Manage team
              </Link>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/owner/audit">
                Audit history
              </Link>
            </>
          ) : null}
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" type="button" onClick={() => void handleRequestSetup()} disabled={requestingSetup || !currentOrganization}>
            {requestingSetup ? "Requesting..." : "Request setup"}
          </button>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={handleLogout} disabled={loggingOut}>
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-slate-50 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand-700">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Current status</p>
            <p className="text-sm text-muted">Role: {currentRole}</p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="font-semibold text-ink">Organization</p>
            <p className="mt-1 text-muted">{currentOrganization?.name ?? "No organization selected yet"}</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="font-semibold text-ink">Current location</p>
            <p className="mt-1 text-muted">{session.currentLocationId ? `Location #${session.currentLocationId}` : "No location selected yet"}</p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="font-semibold text-ink">Setup state</p>
            <p className="mt-1 text-muted">{lifecycleStatus} · {setupStatus} · {subscriptionStatus}</p>
          </div>
          {setupMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              {setupMessage}
            </div>
          ) : null}
        </div>
      </div>

      <div className="md:col-span-2 rounded-2xl border border-line bg-white p-5">
        <p className="text-sm font-semibold text-ink">Onboarding progress</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {progress.map(([label, complete]) => (
            <div key={label} className={`rounded-2xl border p-4 text-sm ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-line bg-slate-50 text-slate-600"}`}>
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GoogleAuthCompletePage() {
  const navigate = useNavigate();
  const query = useQueryParams();
  const [state, setState] = useState<AuthState>("loading");
  const [session, setSession] = useState<CustomerSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const queryStatus = query.get("status");
    const queryMessage = query.get("message");

    if (queryStatus === "error") {
      setState("error");
      setError(queryMessage || "Google sign-in failed.");
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const current = await fetchCustomerSession();
        if (cancelled) return;
        setSession(current);
        setState(current.currentOrganizationId ? "signedIn" : "needsOnboarding");
      } catch (err) {
        if (cancelled) return;
        setState("signedOut");
        setError(err instanceof Error ? err.message : "Your session expired.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function handleCreated() {
    const current = await fetchCustomerSession();
    setSession(current);
    setState(current.currentOrganizationId ? "signedIn" : "needsOnboarding");
    navigate("/auth/google/complete?status=success", { replace: true });
  }

  async function handleLogout() {
    await logoutCustomer();
    setSession(null);
    setState("signedOut");
    setError(null);
    navigate("/auth/google/complete?status=logged_out", { replace: true });
  }

  if (state === "loading") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center justify-center">
          <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-soft">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-700" />
            <h1 className="mt-4 text-2xl font-bold text-ink">Completing Google sign-in</h1>
            <p className="mt-2 text-sm leading-6 text-muted">We’re confirming your session and preparing your onboarding workspace.</p>
          </div>
        </div>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <GoogleAuthErrorCard message={error ?? "Google sign-in failed."} />
        </div>
      </main>
    );
  }

  if (state === "signedOut") {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-4xl items-center">
          <div className="rounded-3xl border border-line bg-white p-8 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Session expired</p>
            <h1 className="mt-3 text-3xl font-bold text-ink">Your sign-in session expired</h1>
            <p className="mt-3 text-sm leading-6 text-muted">Please try Google sign-in again so we can restore your onboarding session.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" type="button" onClick={startGoogleLogin}>
                Continue with Google
              </button>
              <Link className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" to="/">
                Return home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-3 rounded-3xl border border-line bg-white px-5 py-4 shadow-soft">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted">Flowtally onboarding</p>
            <h1 className="mt-1 text-xl font-bold text-ink">Customer setup</h1>
          </div>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:bg-slate-50" type="button" onClick={() => void handleLogout()}>
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-sm text-muted">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-2">
            <Sparkles className="h-4 w-4 text-brand-700" />
            Google login complete
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-2">
            <MapPin className="h-4 w-4 text-brand-700" />
            Location-aware onboarding
          </div>
        </div>

        {state === "needsOnboarding" ? (
          <ProspectOnboardingForm session={session} onCreated={handleCreated} />
        ) : (
          <div className="mt-6">
          <LoggedInProspectView session={session} onLogout={handleLogout} onRequestSetup={handleCreated} />
        </div>
      )}

        <div className="mt-6 rounded-3xl border border-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            <CheckCircle2 className="h-4 w-4 text-brand-700" />
            Registration states
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            This screen covers loading, session-expired, registration error, and logged-in prospect states. It still needs the deeper onboarding, support, and internal setup surfaces in later phases.
          </p>
        </div>
      </div>
    </main>
  );
}
