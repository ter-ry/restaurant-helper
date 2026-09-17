import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Boxes,
  Menu,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Utensils,
  X,
} from "lucide-react";
import { FlowtallyMark } from "../components/FlowtallyMark";
import { trackEvent } from "../lib/analytics";
import { OFFICIAL_DEMO_LOGIN_URL, PRODUCTION_LOGIN_URL, PUBLIC_CONTACT_EMAIL, buildMailtoLink } from "../lib/contactLinks";
import type { ReactNode } from "react";
import { useState } from "react";

const workflow = [
  ["Supplier invoice", "Capture what arrived and what it cost.", ReceiptText],
  ["Inventory control", "Receive, count, adjust, and record waste.", Boxes],
  ["Recipes & costing", "Keep ingredient costs and menu margins visible.", Utensils],
  ["POS sales", "Connect Square sales to theoretical usage.", BarChart3],
  ["Reorder & close", "Act on low stock, variance, and daily exceptions.", ClipboardList],
] as const;

const featureGroups = [
  { title: "Purchasing & supplier control", text: "Review invoices, receiving, supplier history, and price changes in one operating record.", Icon: ShoppingCart },
  { title: "Inventory control", text: "See stock levels, counts, movements, waste, and low-stock signals before they become surprises.", Icon: Boxes },
  { title: "Menu & food costing", text: "Connect recipes to ingredient cost, menu price, and margin visibility.", Icon: Utensils },
  { title: "POS-driven operations", text: "Use Square catalog mappings and sales history to calculate theoretical ingredient usage.", Icon: BarChart3 },
  { title: "Reordering", text: "Turn PAR and minimum levels into a clear list of what needs attention next.", Icon: ClipboardList },
  { title: "Daily close & reporting", text: "Bring sales, purchasing, usage, waste, and variance together for review.", Icon: CheckCircle2 },
] as const;

const mailto = buildMailtoLink(PUBLIC_CONTACT_EMAIL, "Flowtally access request", "Hello Flowtally,\n\nI would like to learn more about Flowtally for my restaurant.\n\nRestaurant name:\nLocation:\n\nThanks,");

function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-600 shadow-sm">{children}</span>;
}

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = [
    ["Product", "#product"],
    ["How it works", "#how-it-works"],
    ["Features", "#product"],
    ["Integrations", "#integrations"],
    ["Security", "#security"],
    ["Contact", "#contact"],
  ] as const;

  return (
    <main className="min-h-screen bg-[#f7faf9] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f7faf9]/90 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
          <a href="#top" className="flex items-center gap-2 text-base font-bold tracking-tight"><FlowtallyMark className="h-9 w-9" />Flowtally</a>
          <nav id="primary-navigation" className={`${mobileMenuOpen ? "flex" : "hidden"} absolute left-5 right-5 top-full z-40 flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-600 shadow-xl lg:static lg:flex lg:flex-row lg:items-center lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`} aria-label="Primary navigation">
            {navItems.map(([label, href]) => (
              <a key={label} className="rounded-xl px-3 py-3 hover:bg-slate-50 hover:text-slate-950 lg:rounded-full lg:py-2 lg:hover:bg-white" href={href} onClick={() => setMobileMenuOpen(false)}>{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 lg:hidden" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} aria-controls="primary-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <a href={PRODUCTION_LOGIN_URL} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700" onClick={() => trackEvent("cta_sign_in_click", { location: "header" })}>Sign in<ArrowRight className="ml-2 h-4 w-4" /></a>
          </div>
        </div>
      </header>

      <section id="top" className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-[#f7faf9] via-white to-[#e4f1ed]">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-28">
          <div>
            <Pill>Restaurant operations, connected</Pill>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.03] tracking-[-0.04em] text-slate-950 md:text-6xl">Run the back office without chasing spreadsheets.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Flowtally connects purchasing, inventory, recipes, supplier costs, and POS sales so restaurant owners can see what is happening without manually piecing everything together.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={PRODUCTION_LOGIN_URL} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-teal-700" onClick={() => trackEvent("cta_request_access_click", { location: "hero" })}>Request access<ArrowRight className="ml-2 h-4 w-4" /></a>
              <a href="#how-it-works" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-950 transition hover:border-teal-500 hover:text-teal-800">See how it works</a>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-500">Keep your POS. Keep your accounting. Flowtally runs the operational layer between them.</p>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:p-7">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Today at a glance</p><p className="mt-1 text-lg font-semibold">Restaurant workflow</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Connected</span></div>
            <div className="mt-5 space-y-3">{workflow.map(([title, text, Icon], index) => <div key={title} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3.5"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 shadow-sm"><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-sm font-bold">{index + 1}. {title}</p><p className="mt-0.5 text-sm text-slate-500">{text}</p></div></div>)}</div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><div className="max-w-3xl"><Pill>How it fits</Pill><h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">The operating layer between sales and the stockroom.</h2><p className="mt-4 text-base leading-7 text-slate-600">Supplier invoices become purchasing records. Counts, waste, and receiving stay connected to inventory. Recipes and POS sales make usage and variance reviewable.</p></div><div className="mt-10 grid gap-4 md:grid-cols-5">{workflow.map(([title, text, Icon]) => <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5"><Icon className="h-6 w-6 text-teal-700" /><p className="mt-5 text-sm font-bold">{title}</p><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></div>)}</div></section>

      <section id="product" className="border-y border-slate-200 bg-white"><div className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><Pill>Product</Pill><h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">A clear daily workflow for independent restaurants.</h2><div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{featureGroups.map(({ title, text, Icon }) => <article key={title} className="rounded-2xl border border-slate-200 bg-[#f8fbfa] p-6"><Icon className="h-6 w-6 text-teal-700" /><h3 className="mt-5 text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div></section>

      <section id="integrations" className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8"><div><Pill>Integrations</Pill><h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">Keep the systems you already trust.</h2><p className="mt-4 text-base leading-7 text-slate-600">Flowtally is not a POS replacement or an accounting system. It organizes the operational records that connect them.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">POS</p><h3 className="mt-3 text-xl font-bold">Square</h3><p className="mt-2 text-sm leading-6 text-slate-600">Catalog mappings, sales history, and theoretical ingredient usage where supported.</p></div><div className="rounded-2xl border border-slate-200 bg-white p-6"><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Accounting</p><h3 className="mt-3 text-xl font-bold">Export-ready records</h3><p className="mt-2 text-sm leading-6 text-slate-600">Keep reviewed purchasing and operational records organized for accounting workflows.</p></div></div></section>

      <section id="security" className="border-y border-slate-200 bg-slate-950 text-white"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:px-8"><div><Pill>Trust & security</Pill><h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">Operational data stays controlled.</h2><p className="mt-4 text-base leading-7 text-slate-300">Flowtally uses authenticated access and organization-level controls so each restaurant sees the workspace it is authorized to use.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/5 p-5"><ShieldCheck className="h-6 w-6 text-teal-300" /><p className="mt-4 font-bold">Organization isolation</p><p className="mt-2 text-sm leading-6 text-slate-300">Tenant-aware access and PostgreSQL row-level security protect customer workspaces.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-5"><Sparkles className="h-6 w-6 text-teal-300" /><p className="mt-4 font-bold">Controlled setup</p><p className="mt-2 text-sm leading-6 text-slate-300">Access is configured for the restaurant rather than opened as an unreviewed self-serve account.</p></div></div></div></section>

      <section id="demo" className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><div className="rounded-[2rem] bg-teal-800 px-6 py-12 text-white shadow-[0_24px_70px_rgba(15,118,110,0.22)] md:px-12"><Pill>See Flowtally in action</Pill><h2 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">Walk through a populated restaurant workspace.</h2><p className="mt-4 max-w-2xl text-base leading-7 text-teal-50">Harbour Kitchen is a fictional restaurant with realistic purchasing, inventory, menu costing, Square history, and daily close records. It is fully read-only and separate from customer accounts.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><a href={OFFICIAL_DEMO_LOGIN_URL} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-teal-900 transition hover:bg-teal-50" onClick={() => trackEvent("cta_view_live_demo_click", { location: "demo_section" })}>View Live Demo<ArrowRight className="ml-2 h-4 w-4" /></a><a href={PRODUCTION_LOGIN_URL} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-teal-300 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700" onClick={() => trackEvent("cta_request_access_click", { location: "demo_section" })}>Request access</a></div></div></section>

      <section id="contact" className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-14 md:flex-row md:items-center md:justify-between lg:px-8"><div><Pill>Contact</Pill><h2 className="mt-4 text-2xl font-semibold">Ready to see your workflow in Flowtally?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Sign in to request access, or email {PUBLIC_CONTACT_EMAIL} for a walkthrough.</p></div><a href={mailto} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700">Email Flowtally<ArrowRight className="ml-2 h-4 w-4" /></a></div></section>

      <footer className="bg-slate-950 px-5 py-8 text-slate-300 lg:px-8"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between"><div><p className="font-bold text-white">Flowtally</p><p className="mt-1">Restaurant purchasing, inventory, and daily close control.</p></div><p>Built in Toronto, Canada · <a className="text-white hover:text-teal-300" href={mailto}>{PUBLIC_CONTACT_EMAIL}</a></p></div></footer>
    </main>
  );
}
