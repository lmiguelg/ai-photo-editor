// All copy and data for the public landing page (/landing). Pure: imports only config. The page
// may only promise what the pipeline does (FAITHFULNESS_RULE in src/pipeline/prompts.ts)
// and must never show owner data (costs, margins, scores). Every stat needs a source URL
// and year; the research behind them is in factory/jobs/010-landing-page/research.md.
import { config } from "@/pipeline/config";

// Placeholders: the owner sets the real business name and address before publishing.
export const BRAND_NAME = "AI Photo Editor";
// The contact address. This is the only line to change: every email link on /landing is built from it.
export const CONTACT_EMAIL = "hello@example.com";

export const CONTACT_SUBJECT = "Photo enhancement for my listing";
/** Plain `mailto:` link to CONTACT_EMAIL, shown as the visible address. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
/** `mailto:` link with the URI-encoded subject, used by the final CTA button. */
export const CONTACT_MAILTO_WITH_SUBJECT = `${CONTACT_MAILTO}?subject=${encodeURIComponent(CONTACT_SUBJECT)}`;

// pricing-model.md section 1: "$45 per listing (flat, up to 25 photos)".
export const PHOTOS_PER_LISTING = 25;

/** The listing price as whole dollars, from config (the single source of the price). */
export const PRICE = `$${Math.round(config.pricing.listingPriceUsd)}`;

export const PAGE_META = {
  title: `Enhance your Airbnb and Vrbo photos | ${BRAND_NAME}`,
  description: `Fix the light, colour and crooked lines in your listing photos for ${PRICE} per listing. We never change what guests will find.`,
};

export const HERO = {
  headline: "Make your listing photos look their best. Keep your place exactly as it is.",
  subline:
    "Send the photos you already have. We fix the light, colour and crooked lines, and never add, remove or reshape anything a guest will find on arrival.",
  cta: `Enhance my listing for ${PRICE}`,
  note: `Up to ${PHOTOS_PER_LISTING} photos per listing.`,
};

export const HEADER_CTA = "Enhance my listing";

export const PROBLEM = {
  heading: "Great places get scrolled past",
  body: "Dim rooms, yellow light and tilted walls make a lovely place look ordinary next to the listing above it. Your photos are the first thing a guest judges.",
};

export interface LandingStep {
  title: string;
  body: string;
}

export const STEPS: LandingStep[] = [
  {
    title: "Send what you have",
    body: "Email us the photos already on your listing, as JPG, PNG or WebP.",
  },
  {
    title: "We fix light and colour",
    body: "Light, exposure, white balance and natural colour are corrected and tilted lines straightened. Every edit passes an automated quality check.",
  },
  {
    title: "Review, approve, upload",
    body: "We check each photo by hand, then send a zip with the enhanced photos and before/after previews, ready for Airbnb or Vrbo.",
  },
];

export interface LandingExample {
  /** Plain noun phrase, no article: slider alt "Original photo <name>", range label "Before/after comparison for <name>". */
  name: string;
  beforeSrc: string;
  afterSrc: string;
  width: number;
  height: number;
}

export const EXAMPLES: LandingExample[] = [
  {
    name: "living room with a white corner sofa",
    beforeSrc: "/examples/living-room-before.jpg",
    afterSrc: "/examples/living-room-after.jpg",
    width: 1600,
    height: 800,
  },
  {
    name: "apartment dining area with an armchair by the window",
    beforeSrc: "/examples/apartment-before.jpg",
    afterSrc: "/examples/apartment-after.jpg",
    width: 1600,
    height: 1059,
  },
];

export const EXAMPLES_LABEL =
  "Sample images for illustration: the darker “before” versions were made from the “after” photos, not produced by our pipeline.";

export const FAITHFULNESS = {
  heading: "Better light. Same place.",
  promise: "We never add, remove or reshape anything that would misrepresent your property.",
  changes: ["Light", "Exposure", "White balance", "Natural colour", "Straightening of verticals and horizon"],
  weChange: "light, exposure, white balance, natural colour, straightening.",
  weNeverChange: "furniture, fixtures, walls, windows, views.",
};

export const PROOF = {
  heading: "What Airbnb’s own data says about better photos",
  intro:
    "These figures describe Airbnb’s professional photography programme, not our service. They show why photo quality matters.",
};

export interface LandingStat {
  /** The number exactly as the source writes it. */
  figure: string;
  claim: string;
  /** The exact source text containing `figure`. */
  quote: string;
  sourceName: string;
  url: string;
  /** Publication year of the source. */
  year: number;
}

export const STATS: LandingStat[] = [
  {
    figure: "19%",
    claim: "more bookings, on average, for listings with Airbnb pro photography.",
    quote: "19% more bookings",
    sourceName: "Airbnb",
    url: "https://www.airbnb.com/e/pro-photography",
    year: 2026,
  },
  {
    figure: "21%",
    claim: "increase in host earnings: hosts with Airbnb pro photography may earn more than other hosts in their area.",
    quote: "21% increase in host earnings",
    sourceName: "Airbnb",
    url: "https://www.airbnb.com/e/pro-photography",
    year: 2026,
  },
  {
    figure: "8.98%",
    claim:
      "higher occupancy for Airbnb properties with verified photos taken by Airbnb’s photographers than for properties with photos taken by the host, in a peer-reviewed study.",
    quote:
      "Using deep learning and difference-in-difference analyses on an Airbnb panel data set spanning 7,423 properties over 16 months, we find that properties with verified images had 8.98% higher occupancy than properties without verified images (images taken by the host).",
    sourceName: "Zhang et al., Management Science",
    url: "https://doi.org/10.1287/mnsc.2021.4175",
    year: 2022,
  },
];

export interface LandingFaq {
  question: string;
  answer: string;
}

export const FAQ: LandingFaq[] = [
  {
    question: "What exactly do you change in my photos?",
    answer:
      "Only light, exposure, white balance, natural colour and tilted lines. Photos that already look great come back as they are.",
  },
  {
    question: "Could the edits misrepresent my property?",
    answer:
      "No. Furniture, fixtures, walls, windows and views are never added, removed, moved or reshaped, and colours keep their real hue.",
  },
  {
    question: "Who checks the results?",
    answer: "We do, by hand. Every photo is reviewed and approved before it is sent to you, after an automated quality check.",
  },
  {
    question: "Which files can I send?",
    answer: "JPG, PNG or WebP, up to 25 MB each. The photos already on your listing are perfect.",
  },
  {
    question: "What do I get back?",
    answer: "A zip with your enhanced photos, ready for Airbnb or Vrbo, plus a before/after preview of each one.",
  },
];

export const OFFER = {
  heading: `One flat price: ${PRICE} per listing`,
  body: `Up to ${PHOTOS_PER_LISTING} photos.`,
};

export const FINAL_CTA = {
  heading: "Ready for photos that do your place justice?",
  body: "Email us the photos already on your listing, as JPG, PNG or WebP.",
  emailLead: "Email your photos to",
  button: "Send me my photos",
};
