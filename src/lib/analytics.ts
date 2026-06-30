type AnalyticsEventName =
  | "cta_tell_wastes_time_click"
  | "cta_join_early_pilot_click"
  | "cta_view_demo_click"
  | "contact_email_click"
  | "pilot_email_click"
  | "demo_email_click"
  | "form_started"
  | "form_submitted"
  | "form_submission_error";

type AnalyticsProperties = Record<string, string | number | boolean | undefined>;

const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || "G-CB7FFQ95VQ";
const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN?.trim();

let analyticsInitialized = false;

function appendScript(src: string, attributes: Record<string, string> = {}) {
  if (document.querySelector(`script[src="${src}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = src;

  Object.entries(attributes).forEach(([key, value]) => {
    script.setAttribute(key, value);
  });

  document.head.appendChild(script);
}

export function initAnalytics() {
  if (analyticsInitialized || typeof window === "undefined") {
    return;
  }

  analyticsInitialized = true;

  if (plausibleDomain) {
    window.plausible =
      window.plausible ||
      function plausibleQueue(...args) {
        window.plausibleQueue = window.plausibleQueue || [];
        window.plausibleQueue.push(args);
      };
    appendScript("https://plausible.io/js/script.manual.js", { "data-domain": plausibleDomain });
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(...args: GtagCommand) {
      window.dataLayer?.push(args);
    };
}

export function trackPageView(path: string) {
  if (import.meta.env.DEV) {
    console.info("[analytics] page_view", { path });
  }

  const url = `${window.location.origin}${path}`;
  const pageTitle = document.title;
  window.plausible?.("pageview", { u: url });
  if (gaMeasurementId) {
    window.gtag?.("event", "page_view", {
      send_to: gaMeasurementId,
      page_location: url,
      page_path: path,
      page_title: pageTitle,
    });
  }
  window.posthog?.capture?.("$pageview", { path, url });
}

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
    dataLayer?: unknown[];
    plausibleQueue?: unknown[];
    plausible?: (eventName: string, options?: { props?: AnalyticsProperties; u?: string }) => void;
    gtag?: (...args: GtagCommand) => void;
    posthog?: { capture?: (eventName: string, properties?: AnalyticsProperties) => void };
  }
}

type GtagCommand =
  | ["js", Date]
  | ["config", string, { page_location?: string; page_path?: string; page_title?: string; send_page_view?: boolean }]
  | ["event", string, AnalyticsProperties];
