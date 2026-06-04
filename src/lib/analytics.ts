type AnalyticsEventName =
  | "cta_tell_wastes_time_click"
  | "cta_see_what_gets_checked_click"
  | "cta_request_review_fit_click"
  | "form_started"
  | "form_submitted"
  | "form_submission_error";

type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

export function trackEvent(name: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  if (import.meta.env.DEV) {
    console.info("[analytics]", name, properties);
  }

  const plausible = window.plausible;
  plausible?.(name, { props: properties });

  const gtag = window.gtag;
  gtag?.("event", name, properties);

  const posthog = window.posthog;
  posthog?.capture?.(name, properties);

  // To connect another provider later, add a no-throw call here.
  // Keep this helper dependency-free so analytics can never block the page.
}

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: AnalyticsProperties }) => void;
    gtag?: (command: "event", eventName: string, properties?: AnalyticsProperties) => void;
    posthog?: { capture?: (eventName: string, properties?: AnalyticsProperties) => void };
  }
}
