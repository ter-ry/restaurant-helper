export const FLOWTALLY_SITE = "flowtally.ca";
export const PUBLIC_CONTACT_EMAIL = "hello@flowtally.ca";
export const DIRECT_INBOX_EMAIL = "info@flowtally.ca";

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

