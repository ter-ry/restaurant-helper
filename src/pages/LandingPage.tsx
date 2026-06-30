import {
  ArrowRight,
  ArrowUpDown,
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  Download,
  Handshake,
  Mail,
  MessageSquareText,
  Package,
  ReceiptText,
  RotateCcw,
  ScanText,
} from "lucide-react";
import type { CSSProperties, ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { FlowtallyMark } from "../components/FlowtallyMark";
import { trackEvent } from "../lib/analytics";
import { buildMailtoLink, PUBLIC_CONTACT_EMAIL } from "../lib/contactLinks";

const navLinks = [
  ["Overview", "#hero"],
  ["How it fits", "#tools"],
  ["Features", "#features"],
  ["Compare", "#compare"],
  ["Early Pilot", "#pilot"],
  ["Contact", "#contact"],
];

const heroBadges = ["Growing independent restaurants", "Team workflows", "Multiple suppliers"];

const toolRows = [
  {
    title: "Invoice capture",
    text: "Capture recurring supplier invoices without retyping.",
    Icon: ReceiptText,
  },
  {
    title: "Inventory and stock",
    text: "Keep receiving, stock counts, and waste visible.",
    Icon: Package,
  },
  {
    title: "Reorder signals",
    text: "See what managers need to reorder this week.",
    Icon: RotateCcw,
  },
];

const featureCards = [
  {
    title: "Invoice Capture",
    text: "Turn supplier invoices and receipts into usable purchase records.",
    Icon: ScanText,
  },
  {
    title: "Inventory",
    text: "Track receiving, counts, adjustments, waste, and low stock together.",
    Icon: Package,
  },
  {
    title: "Supplier Prices",
    text: "Spot supplier price changes before the next order goes out.",
    Icon: BadgeDollarSign,
  },
  {
    title: "Stock Movement",
    text: "Link counts and adjustments back to what was purchased.",
    Icon: ArrowUpDown,
  },
  {
    title: "Reordering",
    text: "Turn low stock and PAR levels into a clear reorder list.",
    Icon: RotateCcw,
  },
  {
    title: "Export Ready",
    text: "Keep reviewed records organized for accountant-ready CSV export.",
    Icon: Download,
  },
];

const compareColumns = [
  {
    title: "Spreadsheets",
    accent: false,
    bullets: ["Fast to start, harder for teams to keep tidy", "Manual updates and version drift", "No clear workflow for recurring purchases or stock"],
  },
  {
    title: "Enterprise software",
    accent: false,
    bullets: ["Usually broader than an independent restaurant needs", "Higher monthly cost", "More setup and more training", "Can feel heavy for manager day-to-day use"],
  },
  {
    title: "Flowtally",
    accent: true,
    bullets: [
      "Built for growing independent restaurants",
      "Fast setup and easy to learn",
      "Purchasing and inventory focused",
      "Affordable monthly pricing",
      "Toronto support",
    ],
  },
];

const pilotSteps = [
  {
    title: "Share your workflow",
    text: "Tell us how your team handles invoices, ordering, and stock today.",
    Icon: MessageSquareText,
  },
  {
    title: "We shape the pilot",
    text: "We shape the demo around your suppliers, invoices, and manager workflow.",
    Icon: Handshake,
  },
  {
    title: "Walk the flow",
    text: "See how one purchase becomes inventory, reorder, and export-ready records.",
    Icon: Mail,
  },
];

const seededValue = (index: number, salt: number) => {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const particles = Array.from({ length: 40 }, (_, index) => {
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

function WorkflowRow({ title, text, Icon }: { title: string; text: string; Icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white/86 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F8FAFC] text-[#0F766E]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
          <p className="mt-1 text-sm leading-6 text-[#64748B]">{text}</p>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, text, Icon }: { title: string; text: string; Icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="surface-card reveal rounded-2xl border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.10)]">
      <div className="flex items-center justify-between gap-3">
        <Icon className="h-6 w-6 text-[#0D9488]" />
        <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#64748B]">
          Feature
        </span>
      </div>
      <h3 className="mt-5 text-base font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-[#64748B]">{text}</p>
    </div>
  );
}

function ComparisonColumn({
  title,
  bullets,
  accent,
}: {
  title: string;
  bullets: string[];
  accent: boolean;
}) {
  return (
    <div
      className={`reveal rounded-2xl border p-5 ${
        accent
          ? "surface-accent border-[#0F172A] text-[#F8FAFC] shadow-[0_20px_56px_rgba(15,23,42,0.18)]"
          : "surface-card text-[#0F172A]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className={`text-base font-semibold ${accent ? "text-[#F8FAFC]" : "text-[#0F172A]"}`}>{title}</h3>
        {accent ? (
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#E2E8F0]">
            Recommended
          </span>
        ) : null}
      </div>
      <ul className={`mt-4 space-y-3 text-sm leading-6 ${accent ? "text-slate-200" : "text-[#64748B]"}`}>
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${accent ? "text-[#99F6E4]" : "text-[#0D9488]"}`} />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingPage() {
  const landingEmailHref = buildMailtoLink(
    PUBLIC_CONTACT_EMAIL,
    "Flowtally demo / pilot",
    [
      "Hi Terry,",
      "",
      "I'm interested in Flowtally and would like a walkthrough.",
      "",
      "Restaurant or business name:",
      "What feels messy today:",
      "Best email or phone number to reply to:",
      "",
      "Thanks,",
    ].join("\n"),
  );

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
        </div>
      </header>

      <section id="hero" className="relative z-10 overflow-hidden border-b border-[#E2E8F0] bg-gradient-to-br from-[#F8FAFC]/90 via-[#F1F5F9]/82 to-[#E2E8F0]/84">
        <div className="hero-grid relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-5 py-[72px] md:py-[84px] lg:min-h-[680px] lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:gap-12 lg:px-8">
          <div className="reveal min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#99F6E4] bg-[#ECFDF5]/92 px-3 py-1 text-sm font-bold text-[#0F766E] shadow-sm backdrop-blur">
              <Handshake className="h-4 w-4 text-[#0F766E]" />
              For growing independent restaurants
            </p>
            <h1 className="mt-6 max-w-[720px] text-4xl font-semibold leading-[1.04] tracking-normal text-[#0F172A] [overflow-wrap:anywhere] md:text-5xl lg:text-[clamp(3rem,4.3vw,4.25rem)]">
              Purchasing and inventory control without spreadsheet chaos.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#475569] md:text-xl">
              Flowtally helps busy restaurant teams manage recurring invoices, supplier prices, stock, and reordering without changing POS or accounting.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {heroBadges.map((value) => (
                <span key={value} className="surface-card rounded-full border px-3 py-2 text-sm font-bold text-[#334155]">
                  {value}
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/pilot"
                onClick={() => trackEvent("cta_join_early_pilot_click", { location: "hero" })}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
              >
                Join Early Pilot
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/demo"
                onClick={() => trackEvent("cta_view_demo_click", { location: "hero" })}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-5 py-3 text-sm font-bold text-[#0F172A] shadow-sm transition hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:bg-[#F8FAFC]"
              >
                View demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#475569]">
              Questions or want a walkthrough?{" "}
              <a
                className="font-semibold text-[#0F766E] underline decoration-[#99F6E4] decoration-2 underline-offset-4 transition hover:text-[#0F172A]"
                href={landingEmailHref}
                onClick={() => trackEvent("contact_email_click", { location: "hero" })}
              >
                Email us
              </a>{" "}
              at <a className="font-semibold text-[#0F172A]" href={landingEmailHref} onClick={() => trackEvent("contact_email_click", { location: "hero_link" })}>
                {PUBLIC_CONTACT_EMAIL}
              </a>.
            </p>
          </div>

          <div className="reveal relative min-w-0">
            <div className="surface-panel relative mx-auto w-full max-w-[520px] rounded-[28px] border p-5 backdrop-blur md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">What managers stop chasing</p>
                  <p className="mt-1 text-lg font-bold text-[#0F172A]">Purchasing, stock, and reorder admin</p>
                </div>
                <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#64748B]">
                  Today
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {toolRows.map(({ title, text, Icon }) => (
                  <WorkflowRow key={title} title={title} text={text} Icon={Icon} />
                ))}
              </div>

              <div className="mt-4 rounded-[24px] border border-[#0F172A]/10 bg-white p-4 shadow-[0_16px_42px_rgba(31,41,55,0.08)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0F172A] text-white">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">One week of purchasing stays connected.</p>
                    <p className="mt-1 text-sm leading-6 text-[#64748B]">Less retyping. Fewer missed orders.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="tools" className="surface-section relative overflow-hidden border-b border-[#E2E8F0] px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto max-w-7xl">
          <SectionHeading eyebrow="How it fits" title="Works with the tools you already use.">
            Flowtally replaces spreadsheet chaos, notebooks, and scattered supplier admin while your POS and accounting software stay in place.
          </SectionHeading>

          <div className="mt-8 mx-auto max-w-3xl">
            <div className="rounded-[28px] border border-[#E2E8F0] bg-white/80 p-5 shadow-[0_18px_50px_rgba(31,41,55,0.09)] md:p-6">
              <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
                <div className="surface-card w-full rounded-[24px] border p-4 md:max-w-[280px]">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">POS</p>
                  <p className="mt-2 text-base font-semibold text-[#0F172A]">Sales stay in your POS.</p>
                </div>

                <div className="flex items-center justify-center text-2xl font-bold text-[#94A3B8]">&darr;</div>

                <div className="surface-accent w-full rounded-[28px] border p-5 md:max-w-[420px]">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#cbd5e1]">Flowtally</p>
                  <p className="mt-2 text-2xl font-semibold text-[#F8FAFC]">Invoices, stock, prices, reorders.</p>
                  <p className="mt-3 text-sm leading-6 text-slate-200">
                    Manager work becomes a shared, reviewable workflow.
                  </p>
                </div>

                <div className="flex items-center justify-center text-2xl font-bold text-[#94A3B8]">&darr;</div>

                <div className="surface-card w-full rounded-[24px] border p-4 md:max-w-[280px]">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">Accounting</p>
                  <p className="mt-2 text-base font-semibold text-[#0F172A]">Clean records go to accounting.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto max-w-7xl">
          <SectionHeading eyebrow="Features" title="Built for recurring restaurant purchasing work.">
            For teams juggling suppliers, invoices, stock movement, and reorders every week.
          </SectionHeading>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {featureCards.map(({ title, text, Icon }) => (
              <FeatureCard key={title} title={title} text={text} Icon={Icon} />
            ))}
          </div>
        </div>
      </section>

      <section id="compare" className="surface-section relative overflow-hidden border-y border-[#E2E8F0] px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto max-w-7xl">
          <SectionHeading eyebrow="Compare" title="Why not keep using spreadsheets?">
            Growing restaurants need more structure than Excel, without the weight of enterprise systems.
          </SectionHeading>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {compareColumns.map(({ title, bullets, accent }) => (
              <ComparisonColumn key={title} title={title} bullets={bullets} accent={accent} />
            ))}
          </div>
        </div>
      </section>

      <section id="pilot" className="surface-section relative overflow-hidden border-y border-[#E2E8F0] py-16">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 px-5 lg:grid-cols-[0.92fr_1fr] lg:px-8">
          <SectionHeading eyebrow="Early Pilot" title="A focused pilot built around a real restaurant workflow.">
            We're speaking with growing independent restaurants across Toronto and the GTA that want a cleaner way to handle purchasing and inventory.
          </SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            {pilotSteps.map(({ title, text, Icon }) => (
              <div key={title} className="surface-card reveal rounded-2xl border p-5 transition duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_45px_rgba(31,41,55,0.08)]">
                <Icon className="h-5 w-5 text-[#0D9488]" />
                <p className="mt-4 text-sm font-semibold leading-6 text-[#0F172A]">{title}</p>
                <p className="mt-2 text-sm leading-6 text-[#64748B]">{text}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/pilot"
              onClick={() => trackEvent("cta_join_early_pilot_click", { location: "pilot" })}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
            >
              Join Early Pilot
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/demo"
              onClick={() => trackEvent("cta_view_demo_click", { location: "pilot" })}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-5 py-3 text-sm font-bold text-[#0F172A] shadow-sm transition hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:bg-[#F8FAFC]"
            >
              View demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="text-sm leading-6 text-[#64748B]">
            Questions or want a walkthrough?{" "}
            <a
              className="font-semibold text-[#0F766E] underline decoration-[#99F6E4] decoration-2 underline-offset-4 transition hover:text-[#0F172A]"
              href={landingEmailHref}
              onClick={() => trackEvent("contact_email_click", { location: "pilot_section" })}
            >
              Email hello@flowtally.ca
            </a>
            .
          </p>
        </div>
      </section>

      <section id="contact" className="relative overflow-hidden px-5 py-16 lg:px-8">
        <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1fr]">
          <div>
            <SectionHeading eyebrow="Contact" title="Questions or want a walkthrough?">
              Email us directly and we’ll reply with a simple next step.
            </SectionHeading>
            <div className="surface-panel reveal mt-6 rounded-2xl border p-5">
              <p className="text-sm font-semibold leading-6 text-[#334155]">Built in Toronto and currently speaking with growing independent restaurants across the GTA.</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">
                Flowtally helps restaurants manage purchasing, inventory, supplier prices, and daily close control between POS and accounting.
              </p>
            </div>
          </div>
          <div className="surface-panel reveal rounded-2xl border p-5 md:p-6">
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">Email</p>
                  <p className="mt-2 text-lg font-semibold text-[#0F172A]">hello@flowtally.ca</p>
                  <p className="mt-2 text-sm leading-6 text-[#64748B]">
                    Tell us your restaurant name and what feels messy today. We’ll reply with the best next step for a walkthrough or pilot.
                  </p>
                </div>
                <a
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-bold text-[#F8FAFC] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#0F766E]"
                  href={landingEmailHref}
                  onClick={() => trackEvent("contact_email_click", { location: "contact_section" })}
                >
                  Email us
                  <Mail className="h-4 w-4" />
                </a>
              </div>

              <div id="privacy-notice" className="rounded-2xl border border-[#E2E8F0] bg-white/72 p-4 text-sm leading-6 text-[#64748B]">
                <p className="font-bold text-[#0F172A]">Privacy note</p>
                <p className="mt-1">We only use your email to reply about Flowtally pilot questions or walkthroughs.</p>
                <p className="mt-1">Restaurant name, role, and one workflow pain point is enough.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[#334155] bg-[#0F172A] px-5 py-8 text-[#F8FAFC] lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-bold">Flowtally</p>
            <p className="mt-1 text-sm text-slate-300">Built in Toronto, Canada</p>
            <p className="mt-1 text-sm text-slate-300">flowtally.ca</p>
            <p className="mt-1 text-sm text-slate-300">
              <a className="font-semibold text-[#F8FAFC] hover:text-[#cbd5e1]" href={landingEmailHref} onClick={() => trackEvent("contact_email_click", { location: "footer" })}>
                hello@flowtally.ca
              </a>
            </p>
            <p className="mt-1 text-sm text-slate-300">Restaurant purchasing, inventory, and daily close control.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-semibold text-[#F8FAFC]">
            <a className="hover:text-[#cbd5e1]" href="#privacy-notice">
              Privacy notice
            </a>
            <a className="inline-flex items-center gap-2 hover:text-[#cbd5e1]" href={landingEmailHref} onClick={() => trackEvent("contact_email_click", { location: "footer_link" })}>
              <Mail className="h-4 w-4" />
              Email us
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
