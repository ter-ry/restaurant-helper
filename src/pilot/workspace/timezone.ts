function partsFor(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function locationNowDatetimeLocal(timezone: string, now = new Date()) {
  const parts = partsFor(now, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function locationDatetimeLocalToUtcIso(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Enter a valid local date and time.");
  const [, year, month, day, hour, minute] = match;
  const desiredUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  let candidate = desiredUtc;
  // Two passes account for the IANA offset at the chosen instant, including DST.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = partsFor(new Date(candidate), timezone);
    const displayedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate += desiredUtc - displayedUtc;
  }
  return new Date(candidate).toISOString();
}

export function formatLocationDateTime(value: string | null | undefined, timezone: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
