import { CalendarDays, CheckCircle2, Users, Wand2 } from "lucide-react";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";

export function SchedulePage() {
  return (
    <PageLayout
      title="Schedule"
      eyebrow="Demo shell / Back Office Core"
      description="Phase 1 placeholder for staff availability, generated weekly schedules, and simple conflict warnings. Payroll and time tracking stay out of scope."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Staff list</p>
              <p className="text-xs text-muted">Placeholder for team members and roles.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Availability</p>
              <p className="text-xs text-muted">Placeholder for availability and preferences.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Weekly schedule</p>
              <p className="text-xs text-muted">Placeholder for generated shifts and edits.</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-brand-50 p-2 text-brand-700">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">Export / share</p>
              <p className="text-xs text-muted">Placeholder for printable or shareable weekly views.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <SectionHeader
          title="Coming next"
          description="This page will stay lightweight so it supports planning without becoming a payroll tool."
        />
        <ul className="grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
          <li className="rounded-lg border border-line bg-slate-50 p-4">Staff availability and preferences</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Generated weekly schedule</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Conflict warnings</li>
          <li className="rounded-lg border border-line bg-slate-50 p-4">Manual edits and export/share</li>
        </ul>
      </Card>
    </PageLayout>
  );
}
