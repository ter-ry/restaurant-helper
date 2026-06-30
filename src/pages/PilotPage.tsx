import { ArrowLeft, ArrowRight, Mail, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { trackEvent } from "../lib/analytics";
import { buildMailtoLink, PUBLIC_CONTACT_EMAIL } from "../lib/contactLinks";

export function PilotPage() {
  const pilotEmailHref = buildMailtoLink(
    PUBLIC_CONTACT_EMAIL,
    "Flowtally demo / pilot",
    [
      "Hi Terry,",
      "",
      "I'm interested in the Flowtally pilot.",
      "",
      "Restaurant or business name:",
      "What feels messy today:",
      "Best email or phone number to reply to:",
      "",
      "Thanks,",
    ].join("\n"),
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(96,115,135,0.14),transparent_30%),linear-gradient(135deg,#F8FAFC_0%,#F1F5F9_44%,#E2E8F0_100%)] px-5 py-8 text-[#0F172A] lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="inline-flex items-center gap-2 text-sm font-bold text-[#0D9488] transition hover:text-[#0F172A]" to="/">
          <ArrowLeft className="h-4 w-4" />
          Back to landing page
        </Link>

        <section className="grid min-h-[calc(100vh-92px)] items-center gap-8 py-12 lg:grid-cols-[0.9fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-[#FFFFFF]/85 px-3 py-1 text-sm font-bold text-[#334155] shadow-sm">
              <Store className="h-4 w-4 text-[#0D9488]" />
              Flowtally early pilot
            </p>
            <h1 className="heading-balance mt-6 text-4xl font-semibold leading-tight text-[#0F172A] md:text-5xl">
              Join the Flowtally early pilot list.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#64748B]">
              Flowtally is being shaped with growing independent restaurants that manage staff, recurring suppliers,
              invoice review, inventory, and reordering every week.
            </p>
            <p className="mt-5 text-sm leading-6 text-[#475569]">
              Questions or want a walkthrough?{" "}
              <a
                className="font-semibold text-[#0F766E] underline decoration-[#99F6E4] decoration-2 underline-offset-4 transition hover:text-[#0F172A]"
                href={pilotEmailHref}
                onClick={() => trackEvent("pilot_email_click", { location: "hero" })}
              >
                Email hello@flowtally.ca
              </a>
              .
            </p>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF]/92 p-5 shadow-[0_24px_70px_rgba(31,41,55,0.12)] md:p-6">
            <p className="text-sm leading-6 text-[#64748B]">
              Send a short note and we’ll reply by email. No forms to figure out, no private numbers needed.
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
                href={pilotEmailHref}
                onClick={() => trackEvent("pilot_email_click", { location: "pilot_page" })}
              >
                Join Early Pilot
                <Mail className="h-4 w-4" />
              </a>
              <Link
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-5 py-3 text-sm font-bold text-[#0F172A] transition hover:bg-[#F8FAFC]"
                onClick={() => trackEvent("cta_view_demo_click", { location: "pilot_page" })}
                to="/demo"
              >
                View the demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#64748B]">
              Prefer email? Write to{" "}
              <a
                className="font-semibold text-[#0F766E] underline decoration-[#99F6E4] decoration-2 underline-offset-4 transition hover:text-[#0F172A]"
                href={pilotEmailHref}
                onClick={() => trackEvent("pilot_email_click", { location: "pilot_page_link" })}
              >
                hello@flowtally.ca
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

