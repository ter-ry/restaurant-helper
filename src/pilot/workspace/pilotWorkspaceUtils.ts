export const moneyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 2,
});

export const numberFormatter = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 1,
});

export const wholeNumberFormatter = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 0,
});

export const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
});

export const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatMoney(value: number | null | undefined) {
  return moneyFormatter.format(value ?? 0);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return numberFormatter.format(value);
}

export function formatWholeNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  return wholeNumberFormatter.format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return dateTimeFormatter.format(new Date(value));
}

export function statusTone(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();

  if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("in stock")) {
    return "success" as const;
  }
  if (normalized.includes("reorder now") || normalized.includes("urgent") || normalized.includes("out of stock")) {
    return "danger" as const;
  }
  if (normalized.includes("low stock") || normalized.includes("needs review") || normalized.includes("draft")) {
    return "warning" as const;
  }
  if (normalized.includes("needs ordering") || normalized.includes("ordered")) {
    return "orange" as const;
  }
  return "neutral" as const;
}
