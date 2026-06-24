import { CheckCircle2, Download, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import type { DemoProfileSlug } from "../data/demoProfiles";
import { useDemoProfile } from "../lib/demoProfile";
import { getDemoCommandCenterSnapshot } from "../lib/demoReadiness";

type StaffMember = {
  name: string;
  role: string;
  availability: string;
  preference: string;
  status: "Available" | "Conflict" | "Open shift";
};

const staff: StaffMember[] = [
  { name: "Maya Chen", role: "Owner / morning opener", availability: "Mon-Fri 6:00-14:00", preference: "Prefers early shifts", status: "Available" },
  { name: "Ari Singh", role: "Lead barista", availability: "Tue-Sat 7:00-15:00", preference: "No late closes on school nights", status: "Available" },
  { name: "Priya Patel", role: "Prep + drinks", availability: "Mon/Wed/Fri 9:00-17:00", preference: "Wants one weekend shift", status: "Available" },
  { name: "Noah Kim", role: "Counter + delivery handoff", availability: "Tue-Thu 12:00-20:00", preference: "Can cover late lunch rush", status: "Conflict" },
  { name: "Sofia Gomez", role: "Weekend support", availability: "Sat-Sun 10:00-18:00", preference: "Prefers Saturdays", status: "Available" },
  { name: "Ben Wong", role: "Prep / dishwasher", availability: "Mon/Tue 8:00-16:00", preference: "Can pick up extra prep shift", status: "Open shift" },
];

const weeklyShifts = [
  { day: "Mon", open: "Maya", mid: "Priya", close: "Ari", tone: "success" as const },
  { day: "Tue", open: "Maya", mid: "Ari", close: "Noah", tone: "warning" as const },
  { day: "Wed", open: "Maya", mid: "Priya", close: "Ari", tone: "success" as const },
  { day: "Thu", open: "Maya", mid: "Ari", close: "Noah", tone: "warning" as const },
  { day: "Fri", open: "Maya", mid: "Priya", close: "Sofia", tone: "success" as const },
  { day: "Sat", open: "Ari", mid: "Sofia", close: "Ben", tone: "success" as const },
  { day: "Sun", open: "Ari", mid: "Sofia", close: "Open", tone: "warning" as const },
];

export function SchedulePage() {
  const demo = useDemoProfile();
  const commandCenter = getDemoCommandCenterSnapshot(demo.slug as DemoProfileSlug);

  return (
    <PageLayout
      title="Schedule"
      eyebrow="Back Office Core / staffing"
      description="Staff availability, weekly schedules, and conflict warnings."
    >
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{demo.customization.restaurantName}</Badge>
              <Badge tone={commandCenter.schedule.conflicts > 0 ? "warning" : "success"}>{commandCenter.schedule.conflicts} conflict{commandCenter.schedule.conflicts === 1 ? "" : "s"}</Badge>
              <Badge tone={commandCenter.schedule.openShifts > 0 ? "warning" : "success"}>{commandCenter.schedule.openShifts} open shift{commandCenter.schedule.openShifts === 1 ? "" : "s"}</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">A lightweight weekly roster for the bubble tea café.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
              Keep availability, preferences, and one simple weekly schedule visible without pulling payroll or clock-in into the demo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" icon={<Wand2 className="h-4 w-4" />}>
              Generate week
            </Button>
            <Button type="button" variant="secondary" icon={<Download className="h-4 w-4" />}>
              Export / share
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Staff" value={String(commandCenter.schedule.staffCount)} helper="Small team, one café" />
        <MetricCard label="Open shifts" value={String(commandCenter.schedule.openShifts)} helper="Keep the week covered" />
        <MetricCard label="Conflicts" value={String(commandCenter.schedule.conflicts)} helper="Availability mismatch" />
        <MetricCard label="Draft status" value={commandCenter.schedule.draftStatus} helper="Editable locally" />
      </div>

      <section className="mt-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="p-5">
          <SectionHeader title="Staff list" description="Availability, preference, and schedule status in one compact list." />
          <div className="mt-4 space-y-2">
            {staff.map((member) => (
              <div key={member.name} className="rounded-xl border border-line bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">{member.name}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted">{member.role}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{member.availability}</p>
                  </div>
                  <Badge tone={member.status === "Available" ? "success" : "warning"}>{member.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted">{member.preference}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="Generated weekly schedule" description="The roster stays simple and easy to edit." />
          <div className="mt-4 space-y-2">
            {weeklyShifts.map((shift) => (
              <div key={shift.day} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{shift.day}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    Open {shift.open} · Mid {shift.mid} · Close {shift.close}
                  </p>
                </div>
                <Badge tone={shift.tone}>{shift.tone === "warning" ? "Check" : "Set"}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <SectionHeader title="Conflict warnings" description="One open shift and one availability mismatch stay visible." />
          <div className="mt-4 space-y-2">
            <WarningRow
              title="Sunday close needs coverage"
              detail="Ben is available for prep, but the last closing block still needs a dedicated closer."
              tone="warning"
            />
            <WarningRow
              title="Noah cannot cover the late close on Thursday"
              detail="Shift him earlier or swap with the weekend support lead before the schedule is shared."
              tone="warning"
            />
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
