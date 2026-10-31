import type { Metadata } from "next";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { LandingHeaderCta } from "@/components/landing-header-cta";
import { LandingStatFigure } from "@/components/landing-stat-figure";
import {
  BRAND_NAME,
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  CONTACT_MAILTO_WITH_SUBJECT,
  EXAMPLES,
  EXAMPLES_LABEL,
  FAITHFULNESS,
  FAQ,
  FINAL_CTA,
  HEADER_CTA,
  HERO,
  OFFER,
  PAGE_META,
  PROBLEM,
  PROOF,
  STATS,
  STEPS,
} from "@/lib/landing-content";

const OG_EXAMPLE = EXAMPLES[0];

export const metadata: Metadata = {
  title: PAGE_META.title,
  description: PAGE_META.description,
  openGraph: {
    title: PAGE_META.title,
    description: PAGE_META.description,
    type: "website",
    images: [
      {
        url: OG_EXAMPLE.afterSrc,
        width: OG_EXAMPLE.width,
        height: OG_EXAMPLE.height,
        alt: `Enhanced listing photo: ${OG_EXAMPLE.name}`,
      },
    ],
  },
};

// Palette scoped to this page: deep ink sections alternate with warm off-white, and one
// coral-to-amber accent marks CTAs, figures and highlights. Text pairs meet WCAG AA.
const INK = "bg-slate-950 text-white";
const WARM = "bg-[#faf6f0] text-stone-900";
const FOCUS_DARK =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";
const FOCUS_LIGHT =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf6f0]";
const ACCENT_BG = "bg-linear-to-r from-rose-400 to-amber-300";
const ACCENT_TEXT = `${ACCENT_BG} bg-clip-text text-transparent forced-colors:bg-none forced-colors:text-[CanvasText]`;
const CTA = `inline-flex items-center justify-center rounded-full ${ACCENT_BG} px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg shadow-rose-500/30 hover:shadow-xl hover:shadow-rose-500/40 active:scale-[0.98] motion-safe:transition motion-safe:hover:-translate-y-0.5 ${FOCUS_DARK}`;
const SECTION = "landing-reveal mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24";
const EYEBROW_DARK = "text-sm font-semibold uppercase tracking-widest text-amber-300";
const EYEBROW_LIGHT = "text-sm font-semibold uppercase tracking-widest text-rose-700";
const H2 = "text-3xl font-extrabold tracking-tight text-balance sm:text-4xl";
const HERO_CTA_ID = "hero-cta";

// One 24px stroke icon per step: envelope (send), sun (light), check (approve).
const STEP_ICONS = [
  "M4 6h16v12H4zM4 7l8 6 8-6",
  "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.5 2.5L16 9.5",
];

/** Public marketing page: static, no owner chrome, costs or store access. */
export default function LandingPage() {
  const [heroExample, ...moreExamples] = EXAMPLES;
  return (
    <div className={`landing-page ${WARM}`}>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 text-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="text-lg font-bold tracking-tight">{BRAND_NAME}</span>
          <LandingHeaderCta
            heroCtaId={HERO_CTA_ID}
            label={HEADER_CTA}
            className={`rounded-full ${ACCENT_BG} px-4 py-2 text-sm font-bold text-slate-950 active:scale-[0.98] ${FOCUS_DARK}`}
          />
        </div>
      </header>
      <main>
        <section aria-labelledby="hero-heading" className={`relative isolate overflow-hidden ${INK}`}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-rose-500/30 blur-3xl motion-safe:animate-landing-glow" />
            <div className="absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-amber-400/20 blur-3xl motion-safe:animate-landing-glow [animation-delay:-8s]" />
          </div>
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.15fr] lg:gap-12 lg:py-20">
            <div>
              <h1 id="hero-heading" className="text-4xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl lg:text-6xl">
                {HERO.headline}
              </h1>
              <p className="mt-6 max-w-xl text-lg text-slate-300 sm:text-xl">{HERO.subline}</p>
              <a id={HERO_CTA_ID} href="#contact" className={`${CTA} mt-8`}>
                {HERO.cta}
              </a>
              <p className="mt-3 text-sm text-slate-400">{HERO.note}</p>
            </div>
            <div>
              <BeforeAfterSlider
                originalSrc={heroExample.beforeSrc}
                editedSrc={heroExample.afterSrc}
                name={heroExample.name}
                width={heroExample.width}
                height={heroExample.height}
                preload
              />
              <p className="mt-3 text-sm text-slate-400">{EXAMPLES_LABEL}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="problem-heading" className={WARM}>
          <div className={`${SECTION} max-w-3xl text-center`}>
            <h2 id="problem-heading" className={H2}>
              {PROBLEM.heading}
            </h2>
            <p className="mt-5 text-lg text-stone-700 sm:text-xl">{PROBLEM.body}</p>
          </div>
        </section>

        {moreExamples.length > 0 ? (
          <section aria-labelledby="examples-heading" className={INK}>
            <div className={`${SECTION} grid items-center gap-10 lg:grid-cols-[1fr_1.6fr]`}>
              <div>
                <p className={EYEBROW_DARK}>Before and after</p>
                <h2 id="examples-heading" className={`mt-2 ${H2}`}>
                  See the difference
                </h2>
                <p className="mt-4 text-lg text-slate-300">Drag the handle to compare. Same room, same furniture, better light.</p>
                <p className="mt-4 text-sm text-slate-400">{EXAMPLES_LABEL}</p>
              </div>
              <div className="grid gap-8">
                {moreExamples.map((example) => (
                  <BeforeAfterSlider
                    key={example.afterSrc}
                    originalSrc={example.beforeSrc}
                    editedSrc={example.afterSrc}
                    name={example.name}
                    width={example.width}
                    height={example.height}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="steps-heading" className={WARM}>
          <div className={SECTION}>
            <p className={EYEBROW_LIGHT}>How it works</p>
            <h2 id="steps-heading" className={`mt-2 ${H2}`}>
              Three steps to better photos
            </h2>
            <div className="relative mt-12">
              <div
                aria-hidden="true"
                className="absolute bottom-6 left-6 top-6 w-0.5 bg-linear-to-b from-rose-400 to-amber-300 md:bottom-auto md:left-[16.67%] md:right-[16.67%] md:h-0.5 md:w-auto md:bg-linear-to-r"
              />
              <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-5 md:flex-col md:items-center md:text-center">
                    <span
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${ACCENT_BG} text-slate-950 shadow-lg shadow-rose-500/30 ring-8 ring-[#faf6f0]`}
                    >
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={STEP_ICONS[index]} />
                      </svg>
                    </span>
                    <div>
                      <p className="text-sm font-bold text-rose-700">Step {index + 1}</p>
                      <h3 className="mt-1 text-xl font-bold">{step.title}</h3>
                      <p className="mt-2 text-stone-700">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {STATS.length > 0 ? (
          <section aria-labelledby="stats-heading" className={INK}>
            <div className={SECTION}>
              <h2 id="stats-heading" className={`max-w-3xl ${H2}`}>
                {PROOF.heading}
              </h2>
              <p className="mt-4 max-w-3xl text-lg text-slate-300">{PROOF.intro}</p>
              <ul className="mt-10 grid gap-6 md:grid-cols-3">
                {STATS.map((stat) => (
                  <li
                    key={`${stat.url}-${stat.figure}`}
                    className="flex flex-col rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/30"
                  >
                    <p className="text-6xl font-extrabold tracking-tight tabular-nums lg:text-7xl">
                      <LandingStatFigure figure={stat.figure} className={ACCENT_TEXT} />
                    </p>
                    <p className="mt-4 flex-1 text-slate-300">{stat.claim}</p>
                    <a
                      href={stat.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-5 self-start rounded text-sm font-semibold text-amber-200 underline underline-offset-4 hover:text-white ${FOCUS_DARK}`}
                    >
                      Source: {stat.sourceName}, {stat.year}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="faithful-heading" className={WARM}>
          <div className={SECTION}>
            <p className={EYEBROW_LIGHT}>Our faithfulness promise</p>
            <h2 id="faithful-heading" className={`mt-2 ${H2}`}>
              {FAITHFULNESS.heading}
            </h2>
            <p className="mt-5 max-w-3xl text-xl font-semibold">{FAITHFULNESS.promise}</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {FAITHFULNESS.changes.map((change) => (
                <li key={change} className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium shadow-sm">
                  {change}
                </li>
              ))}
            </ul>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <p className="rounded-2xl border border-stone-200 bg-white p-6 text-stone-700 shadow-sm">
                <span className="block text-lg font-bold text-stone-900">We change:</span> {FAITHFULNESS.weChange}
              </p>
              <p className="rounded-2xl bg-slate-950 p-6 text-slate-300 shadow-sm">
                <span className="block text-lg font-bold text-white">We never change:</span> {FAITHFULNESS.weNeverChange}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="offer-heading" className={`relative isolate overflow-hidden ${INK}`}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500/20 blur-3xl" />
          </div>
          <div className={`${SECTION} text-center`}>
            <h2 id="offer-heading" className={`${H2} sm:text-5xl`}>
              {OFFER.heading}
            </h2>
            <p className="mt-4 text-lg text-slate-300">{OFFER.body}</p>
            <a href="#contact" className={`${CTA} mt-8`}>
              {HERO.cta}
            </a>
          </div>
        </section>

        <section aria-labelledby="faq-heading" className={WARM}>
          <div className={`${SECTION} max-w-3xl`}>
            <h2 id="faq-heading" className={H2}>
              Questions
            </h2>
            <div className="mt-8 space-y-3">
              {FAQ.map((item) => (
                <details key={item.question} className="group rounded-2xl border border-stone-200 bg-white shadow-sm open:shadow-md">
                  <summary
                    className={`flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-lg font-semibold after:text-2xl after:leading-none after:text-rose-700 after:content-['+'_/_''] group-open:after:rotate-45 after:motion-safe:transition-transform [&::-webkit-details-marker]:hidden ${FOCUS_LIGHT}`}
                  >
                    {item.question}
                  </summary>
                  <p className="px-5 pb-5 text-stone-700">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" aria-labelledby="contact-heading" className={`scroll-mt-16 ${INK}`}>
          <div className={`${SECTION} grid gap-10 lg:grid-cols-2 lg:items-center`}>
            <div>
              <h2 id="contact-heading" className={`${H2} sm:text-5xl`}>
                {FINAL_CTA.heading}
              </h2>
              <p className="mt-5 max-w-xl text-lg text-slate-300">{FINAL_CTA.body}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/40 sm:p-8">
              <p className="text-lg text-slate-300">
                {FINAL_CTA.emailLead}{" "}
                <a
                  href={CONTACT_MAILTO}
                  className={`break-words rounded font-semibold text-amber-200 underline underline-offset-4 hover:text-white ${FOCUS_DARK}`}
                >
                  {CONTACT_EMAIL}
                </a>
              </p>
              <a href={CONTACT_MAILTO_WITH_SUBJECT} className={`${CTA} mt-6`}>
                {FINAL_CTA.button}
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
