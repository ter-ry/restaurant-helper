import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchCurrentOrganization, fetchPilotSession, loginToPilot, logoutOfPilot, PilotApiError, type PilotLocation, type PilotOrganization, type PilotUser } from "./pilotApi";
import { pilotAppEnabled } from "./pilotConfig";

type SessionStatus = "disabled" | "loading" | "signedOut" | "signedIn";

interface PilotSessionValue {
  status: SessionStatus;
  error: string | null;
  user: PilotUser | null;
  organization: PilotOrganization | null;
  locations: PilotLocation[];
  currentLocation: PilotLocation | null;
  membershipRole: string | null;
  csrfToken: string | null;
  refreshSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const PilotSessionContext = createContext<PilotSessionValue | null>(null);

async function loadCurrentSession() {
  const session = await fetchPilotSession();
  const organizationBundle = await fetchCurrentOrganization();

  return {
    user: session.user,
    organization: organizationBundle.organization,
    locations: organizationBundle.restaurantLocations,
    currentLocation: organizationBundle.currentLocation,
    membershipRole: organizationBundle.membershipRole ?? session.membershipRole ?? null,
    csrfToken: session.csrfToken,
  };
}

export function PilotSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(pilotAppEnabled ? "loading" : "disabled");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<PilotUser | null>(null);
  const [organization, setOrganization] = useState<PilotOrganization | null>(null);
  const [locations, setLocations] = useState<PilotLocation[]>([]);
  const [currentLocation, setCurrentLocation] = useState<PilotLocation | null>(null);
  const [membershipRole, setMembershipRole] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const refreshSession = async () => {
    if (!pilotAppEnabled) {
      setStatus("disabled");
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const current = await loadCurrentSession();
      setUser(current.user);
      setOrganization(current.organization);
      setLocations(current.locations);
      setCurrentLocation(current.currentLocation);
      setMembershipRole(current.membershipRole);
      setCsrfToken(current.csrfToken);
      setStatus("signedIn");
    } catch (err) {
      const apiError = err instanceof PilotApiError ? err : null;
      if (apiError?.status === 401 || apiError?.status === 403) {
        setStatus("signedOut");
      } else {
        setStatus("signedOut");
        setError(err instanceof Error ? err.message : "Could not load the pilot session.");
      }
      setUser(null);
      setOrganization(null);
      setLocations([]);
      setCurrentLocation(null);
      setMembershipRole(null);
      setCsrfToken(null);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const signIn = async (email: string, password: string) => {
    setStatus("loading");
    setError(null);

    try {
      const login = await loginToPilot(email, password);
      const organizationBundle = await fetchCurrentOrganization();
      setUser(login.user);
      setOrganization(organizationBundle.organization);
      setLocations(organizationBundle.restaurantLocations);
      setCurrentLocation(organizationBundle.currentLocation);
      setMembershipRole(organizationBundle.membershipRole ?? login.membershipRole ?? null);
      setCsrfToken(login.csrfToken);
      setStatus("signedIn");
    } catch (err) {
      setStatus("signedOut");
      setUser(null);
      setOrganization(null);
      setLocations([]);
      setCurrentLocation(null);
      setMembershipRole(null);
      setCsrfToken(null);
      setError(err instanceof Error ? err.message : "Could not sign in.");
      throw err;
    }
  };

  const signOut = async () => {
    if (!pilotAppEnabled) {
      setStatus("disabled");
      return;
    }

    try {
      await logoutOfPilot();
    } catch {
      // Session state will still be cleared locally.
    }

    setStatus("signedOut");
    setUser(null);
    setOrganization(null);
    setLocations([]);
    setCurrentLocation(null);
    setMembershipRole(null);
    setCsrfToken(null);
    setError(null);
  };

  const value = useMemo<PilotSessionValue>(
    () => ({
      status,
      error,
      user,
      organization,
      locations,
      currentLocation,
      membershipRole,
      csrfToken,
      refreshSession,
      signIn,
      signOut,
    }),
    [csrfToken, currentLocation, error, locations, membershipRole, organization, status, user],
  );

  return <PilotSessionContext.Provider value={value}>{children}</PilotSessionContext.Provider>;
}

export function usePilotSession() {
  const context = useContext(PilotSessionContext);
  if (!context) {
    throw new Error("usePilotSession must be used within a PilotSessionProvider");
  }
  return context;
}
