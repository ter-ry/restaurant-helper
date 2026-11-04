import { CheckCircle2, Download, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { useDemoProfile } from "../lib/demoProfile";
import {
  DAY_LABELS, SEED_SHIFTS, SEED_STAFF, checkAssignment, formatAvailability, formatTime, getShiftConflicts, getShiftStatus, getStaffStatus,
  summarizeSchedule, type DayIndex, type Shift, type StaffMember,
} from "../lib/schedule";

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);

export function SchedulePage() {
  const demo = useDemoProfile();
  const [staff, setStaff] = useState<StaffMember[]>(SEED_STAFF);
  const [shifts, setShifts] = useState<Shift[]>(SEED_SHIFTS);
  const [pending, setPending] = useState<{ shiftId: string; staffId: string | null } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const summary = useMemo(() => summarizeSchedule(staff, shifts), [staff, shifts]);
  const pendingShift = pending ? shifts.find((s) => s.id === pending.shiftId) : undefined;
  const pendingPerson = pending?.staffId ? staff.find((p) => p.id === pending.staffId) : undefined;
  const pendingReasons = pendingShift && pendingPerson ? checkAssignment(pendingPerson, pendingShift, shifts) : [];
  const warnings = shifts.flatMap((shift) => {
    const title = `${DAY_LABELS[shift.day]} ${shift.slot}`;
    if (getShiftStatus(shift, staff, shifts) === "Open shift") {
      return [{ key: shift.id, title: `${title} needs coverage`, detail: "No one is assigned yet." }];
    }
    return getShiftConflicts(shift, staff, shifts).map((r) => ({ key: `${shift.id}-${r.message}`, title: `${title}: ${r.kind === "overlap" ? "overlapping shifts" : "outside availability"}`, detail: r.message }));
  });
  const draftStatus = summary.conflicts > 0 || summary.openShifts > 0 ? "Needs review" : "Ready to share";

  function confirmAssignment() {
    if (!pending) return;
    setShifts((current) => current.map((s) => (s.id === pending.shiftId ? { ...s, staffId: pending.staffId } : s)));
    setPending(null);
  }

  function updateAvailability(id: string, change: (a: StaffMember["availability"]) => StaffMember["availability"]) {
    setStaff((current) => current.map((p) => (p.id === id ? { ...p, availability: change(p.availability) } : p)));
  }

  return (
    <PageLayout
      title="Schedule"
      eyebrow="Back Office Core / staffing"
      description="Are there staffing conflicts or coverage issues this week?"
    >
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{demo.customization.restaurantName}</Badge>
              <Badge tone={summary.conflicts > 0 ? "warning" : "success"}>{summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"}</Badge>
              <Badge tone={summary.openShifts > 0 ? "warning" : "success"}>{summary.openShifts} open shift{summary.openShifts === 1 ? "" : "s"}</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">A lightweight weekly roster for the restaurant team.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              Keep availability, preferences, and one simple weekly schedule visible. Payroll and clock-in are intentionally not part of this demo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" icon={<Wand2 className="h-4 w-4" />}>
              Generate week preview
            </Button>
            <Button type="button" variant="secondary" icon={<Download className="h-4 w-4" />}>
              Export / share preview
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
          Demo preview only: these controls show the intended workflow and do not create payroll, time-clock, or compliance records.
        </p>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Staff" value={String(summary.staffCount)} helper="One restaurant team" />
        <MetricCard label="Open shifts" value={String(summary.openShifts)} helper="Keep the week covered" />
        <MetricCard label="Conflicts" value={String(summary.conflicts)} helper="Availability mismatch" />
        <MetricCard label="Draft status" value={draftStatus} helper="Recalculated as you edit" />
      </div>

      <section className="mt-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-5">
          <SectionHeader title="Staff list" description="Availability, preference, and schedule status in one compact list." />
          <div className="mt-4 space-y-2">
            {staff.map((member) => {
              const status = getStaffStatus(member, staff, shifts);
              const editing = editingId === member.id;
              return (
                <div key={member.id} className="rounded-xl border border-line bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{member.name}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{member.role}</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{formatAvailability(member.availability)}</p>
                    </div>
                    <Badge tone={status === "Available" ? "success" : "warning"}>{status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted">{member.preference}</p>
                  <button
                    type="button"
                    className="mt-2 min-h-11 text-xs font-semibold text-ink underline"
                    aria-expanded={editing}
                    onClick={() => setEditingId(editing ? null : member.id)}
                  >
                    {editing ? "Done" : `Edit ${member.name.split(" ")[0]}'s availability`}
                  </button>
                  {editing ? (
                    <div className="mt-2 space-y-2" role="group" aria-label={`${member.name} availability`}>
                      <div className="flex flex-wrap gap-1.5">
                        {DAY_LABELS.map((label, d) => {
                          const on = member.availability.days.includes(d as DayIndex);
                          return (
                            <button
                              key={label}
                              type="button"
                              aria-pressed={on}
                              className={`min-h-11 min-w-11 rounded-lg border px-2 text-xs font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}
                              onClick={() =>
                                updateAvailability(member.id, (a) => ({
                                  ...a,
                                  days: on ? a.days.filter((x) => x !== d) : ([...a.days, d] as DayIndex[]),
                                }))
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <label className="flex items-center gap-1.5">
                          From
                          <select
                            className="min-h-11 rounded-lg border border-line bg-white px-2 text-sm text-ink"
                            value={member.availability.start}
                            onChange={(e) => updateAvailability(member.id, (a) => ({ ...a, start: Number(e.target.value) }))}
                          >
                            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          To
                          <select
                            className="min-h-11 rounded-lg border border-line bg-white px-2 text-sm text-ink"
                            value={member.availability.end}
                            onChange={(e) => updateAvailability(member.id, (a) => ({ ...a, end: Number(e.target.value) }))}
                          >
                            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Weekly schedule" description="Pick a person for a shift to preview conflicts before it is saved." />
          {pending && pendingShift ? (
            <div role="status" className="mt-4 rounded-xl border border-line bg-slate-50 p-3">
              <p className="text-sm font-bold text-ink">
                {pendingPerson ? `Assign ${pendingPerson.name} to` : "Clear"} {DAY_LABELS[pendingShift.day]} {pendingShift.slot}?
              </p>
              {!pendingPerson ? (
                <p className="mt-1 text-sm leading-6 text-slate-700">This shift becomes an open shift.</p>
              ) : pendingReasons.length === 0 ? (
                <p className="mt-1 text-sm leading-6 text-slate-700">No conflicts: within stated availability and no overlapping shifts.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                  {pendingReasons.map((r) => <li key={r.message}>{r.message}</li>)}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={confirmAssignment}>{pendingReasons.length > 0 ? "Assign anyway" : "Confirm"}</Button>
                <Button type="button" variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {shifts.map((shift) => {
              const status = getShiftStatus(shift, staff, shifts);
              return (
                <div key={shift.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">{DAY_LABELS[shift.day]} {shift.slot}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{formatTime(shift.start)}-{formatTime(shift.end)}</p>
                    <select
                      aria-label={`${DAY_LABELS[shift.day]} ${shift.slot} assignment`}
                      className="mt-1 min-h-11 max-w-full rounded-lg border border-line bg-white px-2 text-sm text-ink"
                      value={pending?.shiftId === shift.id ? pending.staffId ?? "" : shift.staffId ?? ""}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setPending(next === shift.staffId ? null : { shiftId: shift.id, staffId: next });
                      }}
                    >
                      <option value="">Open shift</option>
                      {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <Badge tone={status === "Set" ? "success" : "warning"}>{status}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Conflict warnings" description="Calculated from stated availability and the current roster." />
          <div className="mt-4 space-y-2">
            {warnings.length === 0 ? (
              <p className="text-sm leading-6 text-slate-700">No conflicts or open shifts this week.</p>
            ) : (
              warnings.map((w) => <WarningRow key={w.key} title={w.title} detail={w.detail} tone="warning" />)
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Mobile-friendly summary" description="No payroll, no compliance logic, just a clear weekly plan." />
          <ul className="mt-4 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
            <li className="rounded-lg border border-line bg-slate-50 p-4">Availability and preferences</li>
            <li className="rounded-lg border border-line bg-slate-50 p-4">Generated weekly schedule</li>
            <li className="rounded-lg border border-line bg-slate-50 p-4">Conflict warnings</li>
            <li className="rounded-lg border border-line bg-slate-50 p-4">Manual edits and export/share</li>
          </ul>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Payroll stays out of scope
          </div>
        </Card>
      </section>
    </PageLayout>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{helper}</p>
    </Card>
  );
}

function WarningRow({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "warning" | "danger";
}) {
  return (
    <div className="rounded-xl border border-line bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{detail}</p>
        </div>
        <Badge tone={tone}>Review</Badge>
      </div>
    </div>
  );
}
