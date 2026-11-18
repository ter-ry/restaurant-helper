const DOMAIN_LABELS: Record<string, string> = {
  auth: "Sign-in",
  clover: "Clover",
  import: "Import",
  inventory: "Inventory",
  invitation: "Invitation",
  menu_costing: "Menu costing",
  onboarding: "Onboarding",
  purchases: "Purchases",
  reorder: "Reorder",
  setup: "Setup",
  square: "Square",
};

const EVENT_OVERRIDES: Record<string, string> = {
  "auth.login.success": "Signed in",
  "auth.login.failed": "Sign-in failed",
  "auth.logout": "Signed out",
  "auth.google.login": "Signed in with Google",
  "auth.demo.login.success": "Signed in (demo)",
  "purchases.ocr_discrepancy_override": "Purchases: invoice total mismatch overridden",
};

function sentence(value: string) {
  const text = value.replace(/[_.]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

/** Turns a machine event key like "purchases.invoice_received" into "Purchases: invoice received". */
export function formatAuditEventType(eventType: string): string {
  const override = EVENT_OVERRIDES[eventType];
  if (override) return override;
  const [domain, ...rest] = eventType.split(".");
  if (rest.length === 0) return sentence(eventType);
  const domainLabel = DOMAIN_LABELS[domain] ?? sentence(domain);
  return `${domainLabel}: ${sentence(rest.join(" ")).toLowerCase()}`;
}

/** Turns a metadata key like "invoice_id" or "supplierName" into "Invoice id" / "Supplier name". */
export function formatAuditMetadataKey(key: string): string {
  return sentence(key);
}
