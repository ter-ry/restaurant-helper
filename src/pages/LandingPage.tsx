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
  Store,
  Truck,
} from "lucide-react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { trackEvent } from "../lib/analytics";
import { submitForm } from "../lib/formSubmission";

const navLinks = [
  ["Problem", "#problem"],
  ["What You Get", "#outcomes"],
  ["Process", "#pilot"],
  ["Contact", "#contact"],
];

const problemCards = [
  "Daily close records are rebuilt from memory after service",
  "Delivery payouts, refunds, and fees are hard to reconcile",
  "Supplier price changes are noticed too late",
  "Bookkeeper handoff takes extra back-and-forth",
  "Records are split across POS, paper, Excel, receipts, and apps",
];

const focusAreas = [
  {
    title: "Supplier Invoice Review",
    text: "Organize invoices, item prices, and expense categories so price changes and margin pressure are easier to spot.",
    Icon: ReceiptText,
  },
  {
    title: "Daily Close Checks",
    text: "Compare POS totals, cash/card/delivery payments, refunds, discounts, voids, and closing notes in one workflow.",
    Icon: ClipboardList,
  },
  {
    title: "Delivery Payout Checks",
    text: "Review delivery app payouts, commissions, promotions, refunds, and expected sales before variances get buried.",
    Icon: Truck,
  },
];

const previewMetrics = [
  ["Sales recorded", "$4,640", "Matched"],
  ["Delivery fees", "$186", "Review"],
  ["New invoices", "2", "Check"],
];

const previewTasks = [
  ["Daily close", "Cash counted, card total matched, 1 refund note", "Done"],
  ["Supplier invoice", "Coffee beans changed from $82 to $91", "Price note"],
  ["Payout check", "DoorDash payout is $42 below expected sales", "Review"],
];

const tools = ["POS", "Excel / Google Sheets", "Paper notebook", "Accounting software", "Bookkeeper / accountant", "Delivery apps", "Other"];

const problemAreas = [
  "Supplier invoices & expenses",
  "Daily close & reconciliation",
  "Delivery payout & fee checks",
  "Bookkeeping handoff",
  "Not sure / other",
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

const outcomeCards = [
  {
    title: "Cleaner weekly records",
    text: "Keep invoices, close notes, payouts, and expense notes organized before they become month-end cleanup.",
    Icon: BookOpenCheck,
  },
  {
    title: "Clearer cost pressure",
    text: "See where supplier prices, delivery fees, refunds, or recurring admin gaps may be affecting margin.",
    Icon: BarChart3,
  },
  {
    title: "Less bookkeeping friction",
    text: "Prepare simpler summaries for the owner, manager, bookkeeper, or accountant without chasing scattered notes.",
    Icon: ClipboardList,
  },
];

const serviceSteps = [
  {
    title: "Book a short review",
    text: "Share the admin workflow that is creating cleanup, uncertainty, or missed checks.",
    Icon: Calculator,
  },
  {
    title: "Map the records",
    text: "Identify which POS reports, invoices, payout records, notes, or spreadsheets are involved.",
    Icon: BarChart3,
  },
  {
    title: "Review the fit",
    text: "Get a practical recommendation on whether the workflow is worth organizing first.",
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
      {eyebrow ? <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#53677a]">{eyebrow}</p> : null}
      <h2 className={`heading-balance mt-3 max-w-3xl text-3xl font-semibold tracking-normal text-[#171b21] md:text-4xl ${headingClassName}`}>
        {title}
      </h2>
      {children ? <p className="mt-4 text-base leading-7 text-[#5f6872]">{children}</p> : null}
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
  "min-h-11 rounded-lg border border-[#d8dee5] bg-[#ffffff] px-3 py-2 text-sm text-[#20242a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#53677a] focus:ring-4 focus:ring-[#dbe5ef]";

type SubmissionState = {
  type: "idle" | "success" | "error";
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
    setIsSubmitting(true);
    setSubmission({ type: "idle", message: "" });

    try {
      const result = await submitForm(event.currentTarget, "feedback");
      setSubmission({ type: "success", message: result.message });
      trackEvent("form_submitted", { form: "feedback", mode: result.mode });
      event.currentTarget.reset();
      formStartedRef.current = false;
    } catch {
      setSubmission({
        type: "error",
        message: "Sorry, the form could not be sent. Please try again or contact us directly.",
      });
      trackEvent("form_submission_error", { form: "feedback" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f7f9] text-[#20242a]">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_16%_12%,rgba(96,115,135,0.14),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(31,37,45,0.08),transparent_36%),linear-gradient(135deg,#fbfcfd_0%,#f1f4f7_42%,#e7edf2_100%)]" />
      <FloatingParticles />
      <header className="sticky top-0 z-20 border-b border-[#d8dee5]/85 bg-[#f7f9fa]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <a href="#" className="flex items-center gap-2 text-base font-semibold text-[#171b21]">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#171b21] text-[#f8fafc] shadow-sm">
              <Store className="h-5 w-5" />
            </span>
            Restaurant Admin Helper
          </a>
          <nav className="hidden items-center rounded-full border border-[#d8dee5] bg-white/78 px-2 py-1 text-sm font-semibold text-[#5e6874] shadow-sm md:flex">
            {navLinks.map(([label, href]) => (
              <a key={label} href={href} className="rounded-full px-3 py-2 transition hover:bg-white hover:text-[#171b21]">
                {label}
              </a>
            ))}
          </nav>
          <a
            href="#contact"
            onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "header" })}
            className="premium-button inline-flex min-h-10 items-center justify-center rounded-lg bg-[#171b21] px-4 py-2 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
          >
            Book a review
          </a>
        </div>
      </header>

      <section className="relative z-10 overflow-hidden border-b border-[#d8dee5] bg-gradient-to-br from-[#fbfcfd]/90 via-[#f1f4f7]/80 to-[#e7edf2]/82">
        <div className="hero-grid relative z-10 mx-auto grid min-h-[calc(100vh-73px)] max-w-7xl items-center gap-10 px-5 py-12 md:py-16 lg:grid-cols-[1fr_0.9fr] lg:px-8">
          <div className="reveal">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#d8dee5] bg-white/84 px-3 py-1 text-sm font-bold text-[#53677a] shadow-sm backdrop-blur">
              <Handshake className="h-4 w-4" />
              Toronto/GTA restaurant cost-control support
            </p>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.04] tracking-normal text-[#171b21] md:text-5xl lg:text-[3.25rem] xl:text-[3.55rem]">
              <span className="block lg:whitespace-nowrap">Find the admin gaps</span>
              <span className="block lg:whitespace-nowrap">that affect restaurant margin.</span>
            </h1>
            <div className="mt-6 grid max-w-3xl gap-3">
              <p className="heading-balance text-lg font-semibold leading-7 text-[#2b3037] md:text-xl">
                Practical support for invoices, daily close records, delivery payouts, expenses, and reports.
              </p>
            </div>
            <div className="mt-5 flex max-w-2xl flex-wrap gap-2">
              {["Check supplier prices", "Reconcile delivery payouts", "Prepare cleaner handoffs"].map((value) => (
                <span key={value} className="surface-card rounded-full border px-3 py-2 text-sm font-bold text-[#2b3037]">
                  {value}
                </span>
              ))}
            </div>
            <p className="mt-5 max-w-xl rounded-lg border border-[#d8dee5] bg-white/88 px-4 py-3 text-sm font-semibold leading-6 text-[#2b3037] shadow-sm backdrop-blur">
              Locally built in Toronto/GTA. Designed for independent restaurants that need clearer records without replacing their POS or accounting tools.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "hero" })}
                className="premium-button inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
              >
                <MessageSquareText className="h-4 w-4" />
                Book a 10-minute review
              </a>
              <Link
                to="/pilot"
                onClick={() => trackEvent("cta_join_early_pilot_click", { location: "hero" })}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#d8dee5] bg-white px-5 py-3 text-sm font-bold text-[#20242a] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#f8fafc]"
              >
                Request details
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="reveal relative">
            <div className="surface-panel relative mx-auto max-w-[600px] rounded-lg border p-4 backdrop-blur md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d8dee5] pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#53677a]">Sample review dashboard &mdash; demo data</p>
                  <p className="mt-1 text-lg font-bold text-[#171b21]">Restaurant Admin Helper</p>
                </div>
                <div className="inline-flex rounded-lg border border-[#d8dee5] bg-[#f8fafc] p-1 text-xs font-bold text-[#5f6872]">
                  <span className="rounded-md bg-white px-3 py-1 text-[#171b21] shadow-sm">Today</span>
                  <span className="px-3 py-1">Week</span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {previewMetrics.map(([label, value, status]) => (
                  <div key={label} className="surface-card rounded-lg border p-4 shadow-none">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b7480]">{label}</p>
                      <span className="rounded-full bg-[#e8eef4] px-2 py-0.5 text-[10px] font-bold text-[#53677a]">{status}</span>
                    </div>
                    <p className="mt-3 text-xl font-semibold text-[#171b21]">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-[#dde4eb] bg-white/86 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-[#171b21]">Review queue</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2f5] px-3 py-1 text-xs font-bold text-[#53677a]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    3 tasks
                  </span>
                </div>
                <div className="mt-4 grid gap-3">
                  {previewTasks.slice(0, 2).map(([label, text, status]) => (
                    <div key={label} className="grid gap-3 rounded-lg border border-[#edf1f5] bg-[#fbfcfd] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="text-sm font-bold text-[#20242a]">{label}</p>
                        <p className="mt-1 text-sm leading-6 text-[#5f6872]">{text}</p>
                      </div>
                      <span className="w-fit rounded-full border border-[#d8dee5] bg-white px-3 py-1 text-xs font-bold text-[#53677a]">{status}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="surface-card rounded-lg border p-4 backdrop-blur">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#53677a]">Bookkeeper handoff</p>
                <p className="mt-2 text-sm font-semibold text-[#171b21]">4 records ready to summarize</p>
                <p className="mt-1 text-xs leading-5 text-[#5f6872]">Draft report can be prepared.</p>
              </div>

              <div className="surface-accent rounded-lg border p-4 text-[#f8fafc]">
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
            eyebrow="Where margin gets unclear"
            title="The problem is not one tool. It is the handoff between all of them."
            headingClassName="max-w-4xl"
          >
            Most restaurants already have a POS, delivery apps, a spreadsheet, paper notes, and a bookkeeper. The risk is
            the gaps between those systems.
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {problemCards.map((problem) => (
            <div key={problem} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
              <BookOpenCheck className="h-5 w-5 text-[#53677a]" />
              <p className="mt-4 text-sm font-semibold leading-6 text-[#20242a]">{problem}</p>
            </div>
          ))}
          </div>
          <a
            href="#contact"
            onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "problem" })}
            className="premium-button mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
          >
            Book a review
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <section id="workflows" className="relative overflow-hidden border-y border-[#d8dee5] bg-white/78 py-16">
        <div className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8">
          <SectionHeading eyebrow="What gets checked" title="Focused cost-control workflows.">
            Restaurant Admin Helper focuses on the recurring records that often hide cost movement, payout gaps, or
            avoidable admin cleanup.
          </SectionHeading>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {focusAreas.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
                <div className="flex items-center justify-between gap-3">
                  <Icon className="h-6 w-6 text-[#53677a]" />
                  <span className="rounded-full border border-[#d8dee5] bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#53677a]">Module</span>
                </div>
                <h3 className="mt-5 text-base font-semibold text-[#20242a]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5f6872]">{text}</p>
              </div>
            ))}
          </div>
          <div className="surface-panel reveal mt-4 rounded-lg border p-5">
            <p className="text-sm font-semibold text-[#20242a]">Bookkeeper-ready reports</p>
            <p className="mt-2 text-sm leading-6 text-[#5f6872]">
              Turn cleaned records into simple weekly or monthly reports for owners, managers, or bookkeepers.
            </p>
          </div>
        </div>
      </section>

      <section id="outcomes" className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto max-w-7xl">
          <SectionHeading eyebrow="What you get" title="A clearer operating picture before the month gets messy.">
            The goal is not another dashboard for its own sake. The goal is cleaner checks, simpler handoff, and fewer
            surprises when reviewing costs.
          </SectionHeading>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {outcomeCards.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
                <Icon className="h-6 w-6 text-[#53677a]" />
                <h3 className="mt-5 text-base font-semibold text-[#20242a]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#5f6872]">{text}</p>
              </div>
            ))}
          </div>
          <div className="surface-panel reveal mt-4 grid gap-4 rounded-lg border p-5 md:grid-cols-[0.75fr_1fr] md:items-center">
            <div>
              <p className="text-sm font-bold text-[#20242a]">Built around the tools you already use</p>
              <p className="mt-2 text-sm leading-6 text-[#5f6872]">
                POS reports, supplier invoices, Excel or Google Sheets, paper notes, delivery apps, and bookkeeper
                messages can stay in place.
              </p>
            </div>
            <a
              href="#contact"
              onClick={() => trackEvent("cta_tell_wastes_time_click", { location: "outcomes" })}
              className="premium-button inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
            >
              Ask for a workflow review
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-y border-[#d8dee5] bg-white/78 px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.75fr_1fr]">
          <SectionHeading eyebrow="Positioning" title="Not another POS system.">
            This service is not trying to replace Square, Clover, TouchBistro, Lightspeed, Toast, or accounting software.
            It is for the cost-control and admin checks around the tools restaurants already use.
          </SectionHeading>
          <div className="surface-accent reveal grid overflow-hidden rounded-lg border md:grid-cols-2">
            <div className="border-b border-white/10 bg-white/5 p-6 md:border-b-0 md:border-r">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cbd5e1]">Your current tools</p>
              <p className="mt-4 text-lg font-semibold leading-7 text-[#f8fafc]">
                POS reports, Excel sheets, paper notes, supplier invoices, delivery apps, bookkeeper messages
              </p>
            </div>
            <div className="bg-gradient-to-br from-[#f8fafc] to-[#e9eef3] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#53677a]">Restaurant Admin Helper</p>
              <p className="mt-4 text-lg font-semibold leading-7 text-[#20242a]">
                Organized records, payout checks, expense tracking, margin notes, bookkeeper-ready reports
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="pilot" className="surface-section relative overflow-hidden border-y border-[#d8dee5] py-16">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 lg:grid-cols-[0.9fr_1fr] lg:px-8">
          <SectionHeading eyebrow="How it works" title="Start with one workflow, not a full software rollout.">
            The first conversation is about where records currently break down. No private financial data is needed, and
            sample or blurred records are enough if a deeper review makes sense.
          </SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            {serviceSteps.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-lg border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.08)]">
                <Icon className="h-5 w-5 text-[#53677a]" />
                <p className="mt-4 text-sm font-semibold leading-6 text-[#20242a]">{title}</p>
                <p className="mt-2 text-sm leading-6 text-[#5f6872]">{text}</p>
              </div>
            ))}
          </div>
          <Link
            to="/pilot"
            onClick={() => trackEvent("cta_join_early_pilot_click", { location: "pilot" })}
            className="premium-button inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
          >
            Request details
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section id="contact" className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1fr]">
          <SectionHeading eyebrow="Book a review" title="Request a 10-minute restaurant admin review.">
            Share the workflow that is creating extra cleanup or unclear costs. No private financial data is required.
          </SectionHeading>

          <form onFocusCapture={handleFormStarted} onSubmit={handleFeedbackSubmit} className="surface-panel reveal rounded-lg border p-5 md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <input className={inputClass} name="name" type="text" placeholder="Your name" />
            </Field>
            <Field label="Restaurant or business name">
              <input className={inputClass} name="businessName" type="text" placeholder="Business name" required />
            </Field>
            <Field label="Role">
              <select className={inputClass} name="role" defaultValue="" required>
                <option value="" disabled>
                  Select role
                </option>
                {["Owner", "Manager", "Staff", "Bookkeeper", "Other"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </Field>
            <Field label="Business type">
              <select className={inputClass} name="businessType" defaultValue="" required>
                <option value="" disabled>
                  Select type
                </option>
                {["Restaurant", "Cafe", "Bakery", "Takeout", "Bubble Tea", "Bar", "Food Truck", "Other"].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </Field>
            <Field label="Which area is closest to your problem?">
              <select className={inputClass} name="problemArea" defaultValue="" required>
                <option value="" disabled>
                  Select area
                </option>
                {problemAreas.map((area) => (
                  <option key={area}>{area}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4">
            <Field label="What would you like reviewed first?">
              <textarea className={`${inputClass} min-h-28 resize-y`} name="biggestPain" placeholder="Supplier invoices, daily close, delivery payouts, bookkeeping handoff..." required />
            </Field>
            <p className="-mt-2 text-xs font-semibold text-[#53677a]">No private numbers needed.</p>
            <fieldset className="rounded-lg border border-[#d8dee5] bg-[#f5f7f9] p-4">
              <legend className="px-1 text-sm font-bold text-ink">What tools do you currently use?</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {tools.map((tool) => (
                  <label key={tool} className="flex items-center gap-3 text-sm font-semibold text-[#5f5a52]">
                    <input className="h-4 w-4 accent-[#171b21]" name="tools" type="checkbox" value={tool} />
                    {tool}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Would you be open to a 10-minute review call?">
              <select className={inputClass} name="chatOpen" defaultValue="">
                <option value="" disabled>
                  Select answer
                </option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </Field>
            <Field label="Email or Instagram handle">
              <input className={inputClass} name="contact" type="text" placeholder="name@example.com or @handle" required />
            </Field>
          </div>

          <div className="mt-5 rounded-lg border border-[#d8dee5] bg-white/72 p-4 text-sm leading-6 text-[#53677a]">
            <p className="font-bold text-[#20242a]">Privacy note</p>
            <p className="mt-1">
              No private financial data is required. General workflow notes are enough. Sample, fake, or blurred data
              can be used later if a deeper review makes sense. This service is locally built in Toronto/GTA.
            </p>
          </div>

          {submission.type !== "idle" ? (
            <p
              className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold ${
                submission.type === "success"
                  ? "border-[#b7d2c3] bg-[#f1faf4] text-[#245536]"
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
            className="premium-button mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038] disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto"
          >
            {isSubmitting ? "Sending..." : "Request review"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        </div>
      </section>

      <footer className="border-t border-[#2a3038] bg-[#171b21] px-5 py-8 text-[#f8fafc] lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-bold">Restaurant Admin Helper</p>
            <p className="mt-1 text-sm text-slate-300">Locally built by Terry in Toronto/GTA.</p>
            <p className="mt-1 text-sm text-slate-300">Helping independent restaurants organize cost-control records.</p>
          </div>
          <a className="inline-flex items-center gap-2 text-sm font-semibold text-[#f8fafc] hover:text-[#cbd5e1]" href="#contact">
            <Mail className="h-4 w-4" />
            Request a review
          </a>
        </div>
      </footer>
    </main>
  );
}


