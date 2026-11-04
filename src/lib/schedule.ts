// Demo-only scheduling logic. Browser data only: no payroll, hours-cost or auto-scheduling.

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAY = 1440;
const WEEK = DAY * 7;

/** Times are minutes from midnight. An end at or before the start means the window runs past midnight. */
export type Availability = { days: DayIndex[]; start: number; end: number };

export type StaffMember = {
  id: string;
  name: string;
  role: string;
  availability: Availability;
  preference: string;
};

export type Shift = {
  id: string;
  day: DayIndex;
  slot: string;
  start: number;
  end: number;
  staffId: string | null;
};

export type ConflictReason = { kind: "availability" | "overlap"; message: string };
export type ShiftStatus = "Set" | "Conflict" | "Open shift";

export function formatTime(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function formatAvailability(a: Availability): string {
  const days = [...a.days].sort((x, y) => x - y);
  if (days.length === 0) return "Not available";
  const runs: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j += 1;
    runs.push(j - i >= 2 ? `${DAY_LABELS[days[i]]}-${DAY_LABELS[days[j]]}` : days.slice(i, j + 1).map((d) => DAY_LABELS[d]).join("/"));
    i = j + 1;
  }
  return `${runs.join("/")} ${formatTime(a.start)}-${formatTime(a.end)}`;
}

type Interval = [number, number];

function shiftInterval(day: number, start: number, end: number): Interval {
  const s = day * DAY + start;
  return [s, end <= start ? day * DAY + end + DAY : day * DAY + end];
}

function availabilityIntervals(a: Availability): Interval[] {
  const raw = a.days.map((d) => shiftInterval(d, a.start, a.end)).sort((x, y) => x[0] - y[0]);
  const merged: Interval[] = [];
  for (const [s, e] of raw) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/** True if [s,e] sits inside one window, also considering the week wrapping Sunday -> Monday. */
function contained([s, e]: Interval, windows: Interval[]): boolean {
  return windows.some(([ws, we]) => [-WEEK, 0, WEEK].some((o) => s >= ws + o && e <= we + o));
}

function overlaps(a: Interval, b: Interval): boolean {
  return [-WEEK, 0, WEEK].some((o) => a[0] < b[1] + o && b[0] + o < a[1]);
}

/** Why `person` cannot take `shift` (empty list = fine). Other shifts exclude `shift` itself. */
export function checkAssignment(person: StaffMember, shift: Shift, allShifts: Shift[]): ConflictReason[] {
  const reasons: ConflictReason[] = [];
  const interval = shiftInterval(shift.day, shift.start, shift.end);
  const when = `${DAY_LABELS[shift.day]} ${shift.slot} (${formatTime(shift.start)}-${formatTime(shift.end)})`;
  if (!contained(interval, availabilityIntervals(person.availability))) {
    reasons.push({
      kind: "availability",
      message: `${person.name} is outside stated availability for ${when}. Available ${formatAvailability(person.availability)}.`,
    });
  }
  for (const other of allShifts) {
    if (other.id === shift.id || other.staffId !== person.id) continue;
    if (overlaps(interval, shiftInterval(other.day, other.start, other.end))) {
      reasons.push({
        kind: "overlap",
        message: `${person.name} is already on ${DAY_LABELS[other.day]} ${other.slot} (${formatTime(other.start)}-${formatTime(other.end)}), which overlaps ${when}.`,
      });
    }
  }
  return reasons;
}

export function getShiftConflicts(shift: Shift, staff: StaffMember[], allShifts: Shift[]): ConflictReason[] {
  const person = staff.find((s) => s.id === shift.staffId);
  return person ? checkAssignment(person, shift, allShifts) : [];
}

export function getShiftStatus(shift: Shift, staff: StaffMember[], allShifts: Shift[]): ShiftStatus {
  if (!shift.staffId || !staff.some((s) => s.id === shift.staffId)) return "Open shift";
  return getShiftConflicts(shift, staff, allShifts).length > 0 ? "Conflict" : "Set";
}

export function getStaffStatus(person: StaffMember, staff: StaffMember[], shifts: Shift[]): "Available" | "Conflict" {
  return shifts.some((s) => s.staffId === person.id && getShiftStatus(s, staff, shifts) === "Conflict") ? "Conflict" : "Available";
}

export function summarizeSchedule(staff: StaffMember[], shifts: Shift[]) {
  const statuses = shifts.map((s) => getShiftStatus(s, staff, shifts));
  return {
    staffCount: staff.length,
    openShifts: statuses.filter((s) => s === "Open shift").length,
    conflicts: statuses.filter((s) => s === "Conflict").length,
  };
}

const h = (hours: number) => hours * 60;

export const SEED_STAFF: StaffMember[] = [
  { id: "maya", name: "Maya Chen", role: "Owner / morning opener", availability: { days: [0, 1, 2, 3, 4], start: h(6), end: h(14) }, preference: "Prefers early shifts" },
  { id: "ari", name: "Ari Singh", role: "Lead barista", availability: { days: [1, 2, 3, 4, 5], start: h(7), end: h(15) }, preference: "No late closes on school nights" },
  { id: "priya", name: "Priya Patel", role: "Prep + drinks", availability: { days: [0, 2, 4], start: h(9), end: h(17) }, preference: "Wants one weekend shift" },
  { id: "noah", name: "Noah Kim", role: "Counter + delivery handoff", availability: { days: [1, 2, 3], start: h(12), end: h(20) }, preference: "Can cover late lunch rush" },
  { id: "sofia", name: "Sofia Gomez", role: "Weekend support", availability: { days: [5, 6], start: h(10), end: h(18) }, preference: "Prefers Saturdays" },
  { id: "ben", name: "Ben Wong", role: "Prep / dishwasher", availability: { days: [0, 1], start: h(8), end: h(16) }, preference: "Can pick up extra prep shift" },
];

const SLOTS = { Open: [h(7), h(12)], Mid: [h(11), h(15)], Close: [h(14), h(17)] } as const;
type SlotName = keyof typeof SLOTS;

function shift(day: DayIndex, slot: SlotName, staffId: string | null): Shift {
  return { id: `${DAY_LABELS[day].toLowerCase()}-${slot.toLowerCase()}`, day, slot, start: SLOTS[slot][0], end: SLOTS[slot][1], staffId };
}

export const SEED_SHIFTS: Shift[] = [
  shift(0, "Open", "maya"), shift(0, "Mid", "ben"), shift(0, "Close", "priya"),
  shift(1, "Open", "maya"), shift(1, "Mid", "ari"), shift(1, "Close", "noah"),
  shift(2, "Open", "maya"), shift(2, "Mid", "ari"), shift(2, "Close", "priya"),
  shift(3, "Open", "maya"), shift(3, "Mid", "ari"), shift(3, "Close", "sofia"),
  shift(4, "Open", "maya"), shift(4, "Mid", "ari"), shift(4, "Close", "priya"),
  shift(5, "Open", "ari"), shift(5, "Mid", "sofia"),
  shift(6, "Mid", "sofia"), shift(6, "Close", null),
];
