export type ReportRangePreset = "this-week" | "last-7-days" | "custom";

export type ReportDateRange = {
  startDate: string;
  endDate: string;
  preset: ReportRangePreset;
};

function parseDateKey(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function shiftDateKey(value: string, days: number) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

/** Monday through Sunday, using the organization's already-resolved business date. */
export function calendarWeekRange(today: string): ReportDateRange {
  const date = parseDateKey(today);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const startDate = shiftDateKey(today, -daysSinceMonday);
  return { startDate, endDate: shiftDateKey(startDate, 6), preset: "this-week" };
}

export function lastSevenDaysRange(today: string): ReportDateRange {
  return { startDate: shiftDateKey(today, -6), endDate: today, preset: "last-7-days" };
}

export function customRange(startDate: string, endDate: string): ReportDateRange {
  parseDateKey(startDate);
  parseDateKey(endDate);
  if (startDate > endDate) throw new Error("Report start date must be on or before the end date.");
  return { startDate, endDate, preset: "custom" };
}

export function rangeLabel(range: ReportDateRange) {
  const formatter = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" });
  return `${formatter.format(parseDateKey(range.startDate))} – ${formatter.format(parseDateKey(range.endDate))}`;
}
