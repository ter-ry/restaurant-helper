import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Handshake,
  Mail,
  MessageSquareText,
  ReceiptText,
  Truck,
} from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { trackEvent } from "../lib/analytics";
import { FlowtallyMark } from "../components/FlowtallyMark";
import { isFormEndpointConfigured, submitForm } from "../lib/formSubmission";

const navLinks = [
  ["Problem", "#problem"],
  ["What It Organizes", "#workflows"],
  ["Pilot", "#pilot"],
  ["Contact", "#contact"],
];

const problemCards = [
  "End-of-day records take too long to clean up",
  "Delivery payouts, fees, and refunds are hard to follow",
  "Supplier invoices, spending notes, and receipts pile up",
  "Bookkeeping handoff gets messy",
  "Records are split across POS, paper, Excel, receipts, and apps",
];

const focusAreas = [
  {
    title: "Invoices, Expenses & Spending",
    text: "Organize supplier invoices, expense notes, receipts, and spending categories without relying on scattered notes or messy spreadsheets.",
    Icon: ReceiptText,
  },
  {
    title: "Daily Close & Reconciliation",
    text: "Keep daily records organized across POS totals, cash/card/delivery payments, refunds, discounts, voids, and closing notes.",
    Icon: ClipboardList,
  },
  {
    title: "Delivery Payout & Fee Checks",
    text: "Review delivery app payouts, commissions, promotions, refunds, and expected sales so each channel is easier to understand.",
    Icon: Truck,
  },
];

const previewMetrics = [
  ["Sales recorded", "$4,640", "Ready"],
  ["Delivery fees", "$186", "Check"],
  ["New invoices", "2", "Review"],
];

const previewTasks = [
  ["Daily close", "Cash counted, card total matched, 1 refund note", "Done"],
  ["Supplier invoice", "Coffee beans changed from $82 to $91", "Price note"],
  ["Payout check", "DoorDash payout is $42 below expected sales", "Review"],
];

const seededValue = (index: number, salt: number) => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const particles = Array.from({ length: 56 }, (_, index) => {
  const x = Math.round(seededValue(index, 1) * 100);
  const y = Math.round(seededValue(index, 2) * 100);
  const size = Number((0.9 + seededValue(index, 3) * 0.9).toFixed(2));
  const delay = Number((seededValue(index, 4) * -72).toFixed(2));
  const duration = Number((46 + seededValue(index, 5) * 34).toFixed(2));
  const driftX = Math.round((seededValue(index, 6) - 0.5) * 130);
  const driftY = Math.round((seededValue(index, 7) - 0.5) * 120);
  const opacity = Number((0.045 + seededValue(index, 8) * 0.06).toFixed(2));

  return { x, y, size, delay, duration, driftX, driftY, opacity };
});

const pilotSteps = [
  {
    title: "Share what wastes time",
    text: "Tell us which admin or money-visibility task feels repetitive, messy, or easy to miss.",
    Icon: Calculator,
  },
  {
    title: "The workflow is mapped",
    text: "The records involved are mapped across POS reports, invoices, delivery apps, notes, and spreadsheets.",
    Icon: BarChart3,
  },
  {
    title: "The first version is shaped",
    text: "If the workflow looks useful, it can guide the early Flowtally pilot.",
    Icon: Mail,
  },
];

function SectionHeading({
  eyebrow,
  title,
  children,
  headingClassName = "",
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  headingClassName?: string;
}) {
  return (
    <div className="reveal max-w-4xl">
      {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">{eyebrow}</p> : null}
      <h2 className={`heading-balance mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-[#0F172A] md:text-4xl ${headingClassName}`}>
        {title}
      </h2>
      {children ? <p className="mt-4 text-base leading-7 text-[#64748B]">{children}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-ink">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "min-h-11 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-2 text-sm text-[#0F172A] outline-none transition placeholder:text-[#94a3b8] focus:border-[#0D9488] focus:ring-4 focus:ring-[#DDF7F3]";

type SubmissionState = {
  type: "idle" | "success" | "notice" | "error";
  message: string;
};

function FloatingParticles() {
  return (
    <div className="floating-particles pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {particles.map(({ x, y, size, delay, duration, driftX, driftY, opacity }, index) => (
        <span
          className="floating-particle"
          key={`${x}-${y}-${index}`}
          style={
            {
              "--x": `${x}%`,
              "--y": `${y}%`,
              "--size": `${size}px`,
              "--delay": `${delay}s`,
              "--duration": `${duration}s`,
              "--drift-x": `${driftX}px`,
              "--drift-y": `${driftY}px`,
              "--particle-opacity": opacity,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function LandingPage() {
  const [submission, setSubmission] = useState<SubmissionState>({ type: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formStartedRef = useRef(false);

  const handleFormStarted = () => {
    if (formStartedRef.current) {
      return;
    }

    formStartedRef.current = true;
    trackEvent("form_started", { form: "feedback" });
  };

  const handleFeedbackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setIsSubmitting(true);
    setSubmission({ type: "idle", message: "" });

    try {
      const result = await submitForm(form, "feedback");
      setSubmission({ type: result.mode === "demo" ? "notice" : "success", message: result.message });
      trackEvent("form_submitted", { form: "feedback", mode: result.mode });
      if (result.mode === "endpoint") {
        form.reset();
        formStartedRef.current = false;
      }
    } catch (error) {
      console.error("[Flowtally form] Feedback form submission failed", error);
      setSubmission({
        type: "error",
        message: "Sorry, the form could not be sent. Please send the same note by Instagram DM, then try again later.",
      });
      trackEvent("form_submission_error", { form: "feedback" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#F8FAFC] text-[#0F172A]">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_16%_12%,rgba(96,115,135,0.14),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(31,37,45,0.08),transparent_36%),linear-gradient(135deg,#F8FAFC_0%,#F1F5F9_42%,#E2E8F0_100%)]" />
      <FloatingParticles />
      <header className="sticky top-0 z-20 border-b border-[#E2E8F0]/85 bg-[#F8FAFC]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <a href="#" className="flex items-center gap-2 text-base font-semibold text-[#0F172A]">
            <FlowtallyMark className="h-9 w-9 shrink-0" />
            Flowtally
          </a>
          <nav className="hidden items-center rounded-full border border-[#E2E8F0] bg-white/78 px-2 py-1 text-sm font-semibold text-[#64748B] shadow-sm md:flex">
            {navLinks.map(([label, href]) => (
              <a key={label} href={href} className="rounded-full px-3 py-2 transition hover:bg-white hover:text-[#0F172A]">
                {label}
              </a>
            ))}
          </nav>
          <a
            href="#contact"
            onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "header" })}
            className="premium-button inline-flex min-h-10 items-center justify-center rounded-lg bg-[#0F172A] px-4 py-2 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
          >
            <span className="sm:hidden">Share</span>
            <span className="hidden sm:inline">Tell us what wastes time</span>
          </a>
        </div>
      </header>

      <section className="relative z-10 overflow-hidden border-b border-[#E2E8F0] bg-gradient-to-br from-[#F8FAFC]/90 via-[#F1F5F9]/80 to-[#E2E8F0]/82">
        <div className="hero-grid relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-5 py-[72px] md:py-[80px] lg:min-h-[720px] lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.9fr)] lg:gap-12 lg:px-8 xl:min-h-[760px]">
          <div className="reveal min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white/84 px-3 py-1 text-sm font-bold text-[#334155] shadow-sm backdrop-blur">
              <Handshake className="h-4 w-4 text-[#0D9488]" />
              Local pilot conversations open
            </p>
            <h1 className="mt-6 max-w-[720px] text-4xl font-semibold leading-[1.02] tracking-normal text-[#0F172A] [overflow-wrap:anywhere] md:text-5xl lg:text-[clamp(3rem,4.2vw,4rem)]">
              <span className="block">Save time on admin.</span>
              <span className="block">See where money is going.</span>
            </h1>
            <div className="mt-6 grid max-w-3xl gap-3">
              <p className="heading-balance text-lg font-semibold leading-7 text-[#334155] md:text-xl">
                Flowtally helps restaurants organize invoices, delivery payouts, daily records, and spending information
                without changing their POS.
              </p>
            </div>
            <div className="mt-5 flex max-w-2xl flex-wrap gap-2">
              {["Less manual admin", "Clearer spending records", "Cleaner handoff"].map((value) => (
                <span key={value} className="surface-card rounded-full border px-3 py-2 text-sm font-bold text-[#334155]">
                  {value}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "hero" })}
                className="premium-button inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
              >
                <MessageSquareText className="h-4 w-4" />
                Tell us what wastes time
              </a>
              <Link
                to="/pilot"
                onClick={() => trackEvent("cta_join_early_pilot_click", { location: "hero" })}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-5 py-3 text-sm font-bold text-[#0F172A] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
              >
                Join Early Pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="reveal relative min-w-0">
            <div className="surface-panel relative mx-auto w-full max-w-[620px] rounded-lg border p-4 backdrop-blur md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#64748B]">Concept preview &mdash; demo data</p>
                  <p className="mt-1 text-lg font-bold text-[#0F172A]">Flowtally</p>
                </div>
                <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-1 text-xs font-bold text-[#64748B]">
                  <span className="rounded-md bg-white px-3 py-1 text-[#0F172A] shadow-sm">Today</span>
                  <span className="px-3 py-1">Week</span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {previewMetrics.map(([label, value, status]) => (
                  <div key={label} className="surface-card rounded-lg border p-4 shadow-none">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">{label}</p>
                      <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-bold text-[#64748B]">{status}</span>
                    </div>
                    <p className="mt-3 text-xl font-semibold text-[#0F172A]">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-[#E2E8F0] bg-white/86 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-[#0F172A]">Review queue</p>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1 text-xs font-bold text-[#334155]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#0D9488]" />
                    3 tasks
                  </span>
                </div>
                <div className="mt-4 grid gap-3">
                  {previewTasks.slice(0, 2).map(([label, text, status]) => (
                    <div key={label} className="grid gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="text-sm font-bold text-[#0F172A]">{label}</p>
                        <p className="mt-1 text-sm leading-6 text-[#64748B]">{text}</p>
                      </div>
                      <span className="w-fit rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-bold text-[#64748B]">{status}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="surface-card rounded-lg border p-4 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#64748B]">Bookkeeper handoff</p>
                <p className="mt-2 text-sm font-semibold text-[#0F172A]">4 records ready to summarize</p>
                <p className="mt-1 text-xs leading-5 text-[#64748B]">Draft report can be prepared.</p>
              </div>

              <div className="surface-accent rounded-lg border p-4 text-[#F8FAFC]">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#cbd5e1]">Payout alert</p>
                <p className="mt-2 text-sm font-semibold">DoorDash is $42 below expected sales.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="problem" className="surface-section relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto max-w-7xl">
          <SectionHeading
            title="Restaurant admin gets messy when every record lives somewhere different."
            headingClassName="max-w-4xl"
          >
            POS reports, supplier invoices, delivery apps, paper notes, spreadsheets, and accountant requests all tell
            part of the money story. Flowtally helps bring the work into one clearer flow.
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {problemCards.map((problem) => (
            <div key={problem} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
              <BookOpenCheck className="h-5 w-5 text-[#0D9488]" />
              <p className="mt-4 text-sm font-semibold leading-6 text-[#0F172A]">{problem}</p>
            </div>
          ))}
          </div>
          <a
            href="#contact"
            onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "problem" })}
            className="premium-button mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
          >
            Tell us what wastes the most time
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <section id="workflows" className="relative overflow-hidden border-y border-[#E2E8F0] bg-white/78 py-16">
        <div className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8">
          <SectionHeading eyebrow="What it helps organize" title="One system for the records around the money.">
            Flowtally is being shaped around the weekly admin work restaurant owners already deal with - the work that
            takes time, creates mistakes, or makes it harder to see where money is going.
          </SectionHeading>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {focusAreas.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-6 w-6 text-[#0D9488]" />
                  <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#64748B]">Module</span>
                </div>
                <h3 className="mt-5 text-base font-semibold text-[#0F172A]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#64748B]">{text}</p>
              </div>
            ))}
          </div>
          <div className="surface-panel reveal mt-4 rounded-lg border p-5">
            <p className="text-sm font-semibold text-[#0F172A]">Bookkeeper-ready reports</p>
            <p className="mt-2 text-sm leading-6 text-[#64748B]">
              Turn cleaned records into simple weekly or monthly reports for owners, managers, or bookkeepers.
            </p>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.75fr_1fr]">
          <SectionHeading eyebrow="Positioning" title="Not another POS system.">
            Flowtally is not trying to replace Square, Clover, TouchBistro, Lightspeed, Toast, accounting software, or
            inventory tools. It is not generic AI software or just an invoice tracker. It is being built for the messy
            admin work around the tools restaurants already use.
          </SectionHeading>
          <div className="surface-accent reveal grid overflow-hidden rounded-lg border md:grid-cols-2">
            <div className="border-b border-white/10 bg-white/5 p-6 md:border-b-0 md:border-r">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cbd5e1]">Your current tools</p>
              <p className="mt-4 text-lg font-semibold leading-7 text-[#F8FAFC]">
                POS reports, Excel sheets, paper notes, supplier invoices, delivery apps, bookkeeper messages
              </p>
            </div>
            <div className="bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">Flowtally</p>
              <p className="mt-4 text-lg font-semibold leading-7 text-[#0F172A]">
                Organized records, payout checks, spending visibility, cleaner handoff, bookkeeper-ready reports
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="pilot" className="surface-section relative overflow-hidden border-y border-[#E2E8F0] py-16">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 lg:grid-cols-[0.9fr_1fr] lg:px-8">
          <SectionHeading eyebrow="How it starts" title="Help shape the first version.">
            Flowtally is speaking with independent restaurants, cafes, bakeries, takeout shops, bubble tea shops, food
            trucks, and small food businesses in Toronto/GTA. The goal is to find the admin task that wastes the most
            time, then shape a focused first version around that workflow. No private numbers are needed.
          </SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            {pilotSteps.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.08)]">
                <Icon className="h-5 w-5 text-[#0D9488]" />
                <p className="mt-4 text-sm font-semibold leading-6 text-[#0F172A]">{title}</p>
                <p className="mt-2 text-sm leading-6 text-[#64748B]">{text}</p>
              </div>
            ))}
          </div>
          <Link
            to="/pilot"
            onClick={() => trackEvent("cta_join_early_pilot_click", { location: "pilot" })}
            className="premium-button inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
          >
            Join Early Pilot
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section id="contact" className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1fr]">
          <div>
            <SectionHeading eyebrow="Contact" title="Share what wastes the most time">
              Please do not submit private financial data. Only the workflow and pain points are needed. Even 2-3
              sentences is enough.
            </SectionHeading>
            <div className="surface-panel reveal mt-6 rounded-lg border p-5">
              <p className="text-sm font-semibold leading-6 text-[#334155]">
                Built in Toronto and currently speaking with independent restaurants across the GTA.
              </p>
            </div>
          </div>

          <form onFocusCapture={handleFormStarted} onSubmit={handleFeedbackSubmit} className="surface-panel reveal rounded-lg border p-5 md:p-6">
          {!isFormEndpointConfigured && import.meta.env.DEV ? (
            <div className="mb-4 rounded-lg border border-[#d6c189] bg-[#fff8df] px-4 py-3 text-sm leading-6 text-[#5f4a14]" role="note">
              <p className="font-bold text-[#3f3210]">Owner setup note</p>
              <p className="mt-1">
                No form endpoint is configured for this local build. Add a Formspree URL to VITE_FORM_ENDPOINT before outreach.
              </p>
            </div>
          ) : null}
          <input className="hidden" name="_gotcha" tabIndex={-1} autoComplete="off" />
          <div className="grid gap-4">
            <Field label="What admin task takes the most time?">
              <textarea className={`${inputClass} min-h-28 resize-y`} name="biggestPain" placeholder="Closing, invoices, delivery apps, bookkeeping handoff..." required />
            </Field>
            <p className="-mt-2 text-xs font-semibold text-[#64748B]">No private numbers needed.</p>
            <Field label="Email or Instagram handle">
              <input className={inputClass} name="contact" type="text" placeholder="name@example.com or @handle" required />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Restaurant or business name (optional)">
                <input className={inputClass} name="businessName" type="text" placeholder="Business name" />
              </Field>
              <Field label="Open to a short chat? (optional)">
                <select className={inputClass} name="chatOpen" defaultValue="">
                  <option value="">Select answer</option>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </Field>
            </div>
          </div>

          <div id="privacy-notice" className="mt-5 rounded-lg border border-[#E2E8F0] bg-white/72 p-4 text-sm leading-6 text-[#64748B]">
            <p className="font-bold text-[#0F172A]">Privacy note</p>
            <p className="mt-1">
              Flowtally collects the admin pain point and contact info submitted in this form. It is used only to
              respond about Flowtally pilot feedback. No private financial numbers are required, and contact info is
              not sold.
            </p>
          </div>

          {submission.type !== "idle" ? (
            <p
              className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold ${
                submission.type === "success"
                  ? "border-[#99F6E4] bg-[#E6FFFA] text-[#0F766E]"
                  : submission.type === "notice"
                    ? "border-[#d6c189] bg-[#fff8df] text-[#5f4a14]"
                    : "border-[#e2b8b8] bg-[#fff5f5] text-[#7a2f2f]"
              }`}
              role="status"
            >
              {submission.message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="premium-button mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E] disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto"
          >
            {isSubmitting ? "Sending..." : "Send feedback"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[#334155] bg-[#0F172A] px-5 py-8 text-[#F8FAFC] lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-bold">Flowtally</p>
            <p className="mt-1 text-sm text-slate-300">Built in Toronto, Canada</p>
            <p className="mt-1 text-sm text-slate-300">flowtally.ca</p>
            <p className="mt-1 text-sm text-slate-300">
              Instagram:{" "}
              <a className="font-semibold text-[#F8FAFC] hover:text-[#cbd5e1]" href="https://instagram.com/flowtally.ca" rel="noreferrer" target="_blank">
                @flowtally.ca
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-semibold text-[#F8FAFC]">
            <a className="hover:text-[#cbd5e1]" href="#privacy-notice">Privacy notice</a>
            <a className="inline-flex items-center gap-2 hover:text-[#cbd5e1]" href="#contact">
              <Mail className="h-4 w-4" />
              Contact
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

