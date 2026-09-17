export const FLOWTALLY_SITE = "flowtally.ca";
export const PUBLIC_CONTACT_EMAIL = "hello@flowtally.ca";
export const DIRECT_INBOX_EMAIL = "info@flowtally.ca";
export const PRODUCTION_APP_ORIGIN = (import.meta.env.VITE_FLOWTALLY_APP_ORIGIN || "https://app.flowtally.ca").replace(/\/+$/, "");
export const PRODUCTION_LOGIN_URL = `${PRODUCTION_APP_ORIGIN}/app/login`;
export const OFFICIAL_DEMO_LOGIN_URL = "https://flowtally-demo.onrender.com/app/login";

export function buildMailtoLink(email: string, subject: string, body: string) {
  const params = new URLSearchParams();

  if (subject) {
    params.set("subject", subject);
  }

  if (body) {
    params.set("body", body);
  }

  const query = params.toString();
  return `mailto:${email}${query ? `?${query}` : ""}`;
}

