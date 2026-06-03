import { ArrowLeft, ArrowRight, Mail, Store } from "lucide-react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

function handlePilotSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  window.alert("Thanks - your email has been recorded locally for demo purposes.");
}

export function PilotPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_18%_12%,rgba(96,115,135,0.14),transparent_30%),linear-gradient(135deg,#fbfcfd_0%,#f1f4f7_44%,#e7edf2_100%)] px-5 py-8 text-[#20242a] lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="inline-flex items-center gap-2 text-sm font-bold text-[#53677a] transition hover:text-[#171b21]" to="/">
          <ArrowLeft className="h-4 w-4" />
          Back to landing page
        </Link>

        <section className="grid min-h-[calc(100vh-92px)] items-center gap-8 py-12 lg:grid-cols-[0.9fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#d8dee5] bg-[#ffffff]/85 px-3 py-1 text-sm font-bold text-[#53677a] shadow-sm">
              <Store className="h-4 w-4" />
              Early pilot list
            </p>
            <h1 className="heading-balance mt-6 text-4xl font-semibold leading-tight text-[#171b21] md:text-5xl">
              Get notified when the first version is ready.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#5f6872]">
              Restaurant Admin Helper is being shaped with feedback from local restaurants in Toronto/GTA. Join the early
              list for updates when a focused prototype is ready to review.
            </p>
          </div>

          <form onSubmit={handlePilotSubmit} className="rounded-lg border border-[#d8dee5] bg-[#ffffff]/92 p-5 shadow-[0_24px_70px_rgba(31,41,55,0.12)] md:p-6">
            <label className="grid gap-2 text-sm font-semibold text-[#20242a]">
              Email
              <input
                className="min-h-11 rounded-lg border border-[#d8dee5] bg-white px-3 py-2 text-sm text-[#20242a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#53677a] focus:ring-4 focus:ring-[#dbe5ef]"
                name="email"
                placeholder="name@example.com"
                type="email"
              />
            </label>
            <label className="mt-4 grid gap-2 text-sm font-semibold text-[#20242a]">
              Restaurant or business name
              <input
                className="min-h-11 rounded-lg border border-[#d8dee5] bg-white px-3 py-2 text-sm text-[#20242a] outline-none transition placeholder:text-[#94a3b8] focus:border-[#53677a] focus:ring-4 focus:ring-[#dbe5ef]"
                name="businessName"
                placeholder="Optional"
                type="text"
              />
            </label>
            <p className="mt-4 text-sm leading-6 text-[#5f6872]">
              No private numbers needed. This list is only for pilot updates and prototype feedback.
            </p>
            <button
              className="premium-button mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#171b21] px-5 py-3 text-sm font-bold text-[#f8fafc] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2a3038]"
              type="submit"
            >
              Join early pilot
              <Mail className="h-4 w-4" />
            </button>
            <Link
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#d8dee5] bg-white px-5 py-3 text-sm font-bold text-[#20242a] transition hover:bg-[#fbfcfd]"
              to="/#contact"
            >
              Share admin pain instead
              <ArrowRight className="h-4 w-4" />
            </Link>
          </form>
        </section>
      </div>
    </main>
  );
}



