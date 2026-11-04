import { describe, expect, it } from "vitest";
import {
  SEED_SHIFTS, SEED_STAFF, checkAssignment, formatAvailability, getShiftStatus, summarizeSchedule,
  type Shift, type StaffMember,
} from "../../src/lib/schedule";

const person = (over: Partial<StaffMember["availability"]> = {}): StaffMember => ({
  id: "p", name: "Pat", role: "", preference: "",
  availability: { days: [0, 1], start: 9 * 60, end: 17 * 60, ...over },
});
const shift = (over: Partial<Shift> = {}): Shift => ({ id: "s1", day: 0, slot: "Mid", start: 10 * 60, end: 14 * 60, staffId: "p", ...over });

describe("checkAssignment", () => {
  it("accepts a shift inside availability", () => {
    expect(checkAssignment(person(), shift(), [shift()])).toEqual([]);
  });
  it("flags a day the person is not available", () => {
    const r = checkAssignment(person(), shift({ day: 3 }), []);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("availability");
    expect(r[0].message).toContain("Pat");
  });
  it("flags hours outside the window, but allows exact boundaries", () => {
    expect(checkAssignment(person(), shift({ start: 8 * 60, end: 12 * 60 }), [])[0].kind).toBe("availability");
    expect(checkAssignment(person(), shift({ start: 9 * 60, end: 17 * 60 }), [])).toEqual([]);
  });
  it("flags overlapping shifts but not back-to-back shifts", () => {
    const other = shift({ id: "s2", start: 13 * 60, end: 16 * 60 });
    expect(checkAssignment(person(), shift(), [shift(), other]).map((r) => r.kind)).toEqual(["overlap"]);
    const adjacent = shift({ id: "s3", start: 14 * 60, end: 16 * 60 });
    expect(checkAssignment(person(), shift(), [shift(), adjacent])).toEqual([]);
  });
  it("ignores overlapping shifts belonging to other people", () => {
    const other = shift({ id: "s2", staffId: "x" });
    expect(checkAssignment(person(), shift(), [shift(), other])).toEqual([]);
  });
  it("handles overnight shifts and availability", () => {
    const night = person({ days: [4], start: 18 * 60, end: 2 * 60 });
    expect(checkAssignment(night, shift({ day: 4, start: 20 * 60, end: 1 * 60 }), [])).toEqual([]);
    expect(checkAssignment(night, shift({ day: 4, start: 20 * 60, end: 3 * 60 }), [])[0].kind).toBe("availability");
    // Overnight shift spilling into an unavailable day is rejected for a day-only window.
    expect(checkAssignment(person({ days: [0] }), shift({ day: 0, start: 16 * 60, end: 2 * 60 }), [])[0].kind).toBe("availability");
  });
  it("detects overnight overlap into the next day and across the Sunday/Monday wrap", () => {
    const late = shift({ id: "a", day: 6, start: 22 * 60, end: 2 * 60 });
    const early = shift({ id: "b", day: 0, start: 1 * 60, end: 5 * 60 });
    const p = person({ days: [6, 0], start: 0, end: 0 });
    expect(checkAssignment(p, late, [late, early]).map((r) => r.kind)).toContain("overlap");
  });
});

describe("overnight availability across the Sunday/Monday boundary", () => {
  const sundayNight = person({ days: [6], start: 22 * 60, end: 2 * 60 });
  it("contains an early Monday shift inside Sunday overnight availability", () => {
    expect(checkAssignment(sundayNight, shift({ day: 0, start: 1 * 60, end: 2 * 60 }), [])).toEqual([]);
  });
  it("contains a shift that itself crosses Sunday night into Monday", () => {
    expect(checkAssignment(sundayNight, shift({ day: 6, start: 23 * 60, end: 1 * 60 }), [])).toEqual([]);
  });
  it("still rejects Monday hours past the Sunday window or on other days", () => {
    expect(checkAssignment(sundayNight, shift({ day: 0, start: 1 * 60, end: 3 * 60 }), [])[0].kind).toBe("availability");
    expect(checkAssignment(sundayNight, shift({ day: 1, start: 1 * 60, end: 2 * 60 }), [])[0].kind).toBe("availability");
  });
  it("handles Saturday overnight into Sunday and merged Sunday+Monday windows", () => {
    const satNight = person({ days: [5], start: 22 * 60, end: 2 * 60 });
    expect(checkAssignment(satNight, shift({ day: 6, start: 0, end: 1 * 60 }), [])).toEqual([]);
    const both = person({ days: [6, 0], start: 22 * 60, end: 2 * 60 });
    expect(checkAssignment(both, shift({ day: 0, start: 1 * 60, end: 2 * 60 }), [])).toEqual([]);
    expect(checkAssignment(both, shift({ day: 2, start: 1 * 60, end: 2 * 60 }), [])[0].kind).toBe("availability");
  });
});

describe("derived statuses", () => {
  it("derives status from data, not hard-coded values", () => {
    const staff = SEED_STAFF;
    expect(getShiftStatus(SEED_SHIFTS.find((s) => s.id === "thu-close")!, staff, SEED_SHIFTS)).toBe("Conflict");
    expect(getShiftStatus(SEED_SHIFTS.find((s) => s.id === "sun-close")!, staff, SEED_SHIFTS)).toBe("Open shift");
    expect(summarizeSchedule(staff, SEED_SHIFTS)).toEqual({ staffCount: 6, openShifts: 1, conflicts: 1 });
  });
  it("updates when a shift or availability changes", () => {
    const fixed = SEED_SHIFTS.map((s) => (s.id === "thu-close" ? { ...s, staffId: "noah" } : s));
    expect(summarizeSchedule(SEED_STAFF, fixed).conflicts).toBe(0);
    const narrowed = SEED_STAFF.map((p) => (p.id === "noah" ? { ...p, availability: { ...p.availability, end: 16 * 60 } } : p));
    expect(summarizeSchedule(narrowed, fixed).conflicts).toBe(2);
  });
  it("formats availability", () => {
    expect(formatAvailability(SEED_STAFF[0].availability)).toBe("Mon-Fri 6:00-14:00");
    expect(formatAvailability(SEED_STAFF[2].availability)).toBe("Mon/Wed/Fri 9:00-17:00");
  });
});
