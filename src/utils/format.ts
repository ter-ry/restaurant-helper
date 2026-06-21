export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    candidates.unshift(`${trimmed}T12:00:00.000Z`);
  }

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function dateValueToMillis(value: string | null | undefined): number {
  return parseDateValue(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

export function formatDate(value: string | null | undefined): string {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatDateTime(value: string | null | undefined): string {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
