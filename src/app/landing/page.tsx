import type { Metadata } from "next";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { LandingContactForm } from "@/components/landing-contact-form";
import {
  BRAND_NAME,
  CONTACT_EMAIL,
  EXAMPLES,
  EXAMPLES_LABEL,
  FAITHFULNESS,
  FAQ,
  HERO,
  PHOTOS_PER_LISTING,
  STATS,
  STEPS,
} from "@/lib/landing-content";
import { config } from "@/pipeline/config";

const TITLE = `${BRAND_NAME}: better listing photos for Airbnb and Vrbo hosts`;
const DESCRIPTION =
  "We improve the light, colour and straightness of your Airbnb and Vrbo listing photos without adding, removing or reshaping anything.";
const OG_EXAMPLE = EXAMPLES[0];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
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

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const CTA = `inline-block rounded-md bg-blue-700 px-5 py-3 text-base font-semibold text-white hover:bg-blue-800 ${FOCUS}`;
const SECTION = "mx-auto max-w-5xl px-4 py-12 sm:py-16";
const H2 = "text-2xl font-bold tracking-tight sm:text-3xl";

/** Public marketing page: static, no owner chrome, costs or store access. */
export default function LandingPage() {
  const price = `$${Math.round(config.pricing.listingPriceUsd)}`;
  return (
    <div className="bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-lg font-semibold">{BRAND_NAME}</span>
          <a href="#contact" className={`rounded-md px-3 py-1.5 text-sm font-semibold text-blue-800 hover:underline ${FOCUS}`}>
            Contact us
          </a>
        </div>
      </header>
      <main>
        <section aria-labelledby="hero-heading" className="bg-neutral-50">
          <div className={`${SECTION} text-center`}>
            <h1 id="hero-heading" className="mx-auto max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
              {HERO.headline}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-neutral-700">{HERO.subline}</p>
            <a href="#contact" className={`${CTA} mt-8`}>
              {HERO.cta}
            </a>
          </div>
        </section>

        <section aria-labelledby="examples-heading" className={SECTION}>
          <h2 id="examples-heading" className={H2}>
            See the difference
          </h2>
          <p className="mt-2 text-sm text-neutral-700">{EXAMPLES_LABEL}</p>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            {EXAMPLES.map((example) => (
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
        </section>

        <section aria-labelledby="steps-heading" className="bg-neutral-50">
          <div className={SECTION}>
            <h2 id="steps-heading" className={H2}>
              How it works
            </h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-lg border border-neutral-200 bg-white p-5">
                  <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-700 font-bold text-white">
                    {index + 1}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-1 text-neutral-700">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="offer-heading" className={SECTION}>
          <h2 id="offer-heading" className={H2}>
            One simple price
          </h2>
          <div className="mt-6 max-w-md rounded-lg border-2 border-blue-700 p-6">
            <p>
              <span className="text-4xl font-bold">{price}</span> <span className="text-lg text-neutral-700">per listing</span>
            </p>
            <p className="mt-2 text-neutral-700">Up to {PHOTOS_PER_LISTING} photos, each one reviewed and approved by hand.</p>
            <a href="#contact" className={`${CTA} mt-6`}>
              Start with your listing
            </a>
          </div>
        </section>

        <section aria-labelledby="faithful-heading" className="bg-neutral-50">
          <div className={SECTION}>
            <h2 id="faithful-heading" className={H2}>
              Our faithfulness promise
            </h2>
            <p className="mt-4 text-lg font-semibold">{FAITHFULNESS.promise}</p>
            <p className="mt-4 text-neutral-700">What we do change:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {FAITHFULNESS.changes.map((change) => (
                <li key={change} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm">
                  {change}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-neutral-700">{FAITHFULNESS.detail}</p>
          </div>
        </section>

        {STATS.length > 0 ? (
          <section aria-labelledby="stats-heading" className={SECTION}>
            <h2 id="stats-heading" className={H2}>
              Why photos matter
            </h2>
            <ul className="mt-6 grid gap-6 md:grid-cols-3">
              {STATS.map((stat) => (
                <li key={`${stat.url}-${stat.figure}`} className="rounded-lg border border-neutral-200 p-5">
                  <p className="text-3xl font-bold text-blue-800">{stat.figure}</p>
                  <p className="mt-2 text-neutral-700">{stat.claim}</p>
                  <a
                    href={stat.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mt-3 inline-block rounded text-sm font-medium text-blue-800 underline ${FOCUS}`}
                  >
                    Source: {stat.sourceName}, {stat.year}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="faq-heading" className="bg-neutral-50">
          <div className={SECTION}>
            <h2 id="faq-heading" className={H2}>
              Questions
            </h2>
            <div className="mt-6 space-y-3">
              {FAQ.map((item) => (
                <details key={item.question} className="rounded-lg border border-neutral-200 bg-white">
                  <summary className={`cursor-pointer rounded-lg px-4 py-3 font-semibold ${FOCUS}`}>{item.question}</summary>
                  <p className="px-4 pb-4 text-neutral-700">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" aria-labelledby="contact-heading" className={SECTION}>
          <h2 id="contact-heading" className={H2}>
            Make your listing shine
          </h2>
          <p className="mt-2 max-w-2xl text-neutral-700">
            Tell us about your listing. Submitting opens an email to us in your own mail app; nothing is stored on this page.
          </p>
          <div className="mt-6 max-w-xl">
            <LandingContactForm contactEmail={CONTACT_EMAIL} />
          </div>
        </section>
      </main>
    </div>
  );
}
