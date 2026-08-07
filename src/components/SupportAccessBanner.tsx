import { ShieldAlert } from "lucide-react";

export interface SupportAccessGrantSummary {
  id: number;
  organizationId: number;
  reason: string;
  caseReference: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
}

export function SupportAccessBanner({ grant }: { grant: SupportAccessGrantSummary | null | undefined }) {
  if (!grant) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-soft">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-800">
        <ShieldAlert className="h-4 w-4" />
        Support access active
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-amber-950 sm:grid-cols-2">
        <p>
          Organization #{grant.organizationId}
        </p>
        <p>
          Case {grant.caseReference || "—"}
        </p>
        <p className="sm:col-span-2">
          Reason: {grant.reason}
        </p>
        <p>
          Expires: {grant.expiresAt ?? "unknown"}
        </p>
        <p>
          Status: {grant.status}
        </p>
      </div>
    </div>
  );
}

