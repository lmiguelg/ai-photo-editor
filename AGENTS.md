# AI Photo Editor — agent guide

Local-only tool for a one-person business: improve Airbnb/Vrbo listing photos with
an AI pipeline, review them in a local web UI, then export results to send to
clients by email. No auth, no deployment, no database server.

Business context: `airbnb_ai_photo_enhancement_blueprint.md` (product, tiers,
pipeline design) and `pricing-model.md` (price $45/listing, target AI cost well
under $5/listing). Read both before designing features.

## Stack

Next.js (App Router, TypeScript strict), Tailwind CSS v4, Zod, `sharp` for local
image work, `@anthropic-ai/sdk` for vision agents, fal.ai (plain `fetch`) for image
editing, `fflate` for zip export. Tests: Vitest. Package manager: npm. Node 24.

Next.js 16: route handler and page `params` are Promises (`await params`). Check
`node_modules/next/dist/docs` or the installed types when unsure about an API.

## Setup (fresh checkout)

```bash
npm install
cp .env.example .env.local   # optional: with no keys the app runs in mock mode
```

## Dev server

`npm run dev -- --port <port>` (factory jobs pass their own port; default 3000).
Data is stored on disk under `data/` (gitignored, override with `DATA_DIR`).

## Validation

Run all of these; they must pass before you report READY:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Layout

- `src/app/`: routes and API route handlers.
- `src/pipeline/`: the agents and harness (config, schemas, prompts, providers, run loop).
- `src/lib/`: filesystem store and shared helpers.
- `data/`: runtime listings, photos, results, logs. Never commit.

## Cost rules (the goal is maximum margin with a great product)

These are product requirements, not suggestions:

- All model choices, image sizes, retry limits and price assumptions live in
  `src/pipeline/config.ts`. Never hard-code a model id elsewhere.
- Cheapest tier that works per agent: `cheap` (Haiku) for routing and prompt
  refinement, `strong` (Sonnet) for prompt synthesis and the QA gate. Never use
  Opus. The QA gate is the one place not to skimp: a bad image sent to a client
  costs more than any API call.
- Free local checks (`sharp`: resolution, sharpness, brightness) run before any
  paid call and reject junk photos.
- Downscale images before every vision call (`prepareForVision`). System prompts
  are sent with `cache_control`.
- Retries are capped (`maxRetries`) and refinement retries are text-only.
- Every paid call records its cost; a photo stops at `maxCostPerPhotoUsd`.
  Costs are visible per photo and per listing in the UI and exports' summaries.
- Without `ANTHROPIC_API_KEY` / `FAL_KEY` the pipeline uses mock providers so
  tests and the UI work for free. Tests never call real APIs.

## Conventions

- Never let enhancement add, remove or reshape anything that would misrepresent
  the property. Faithfulness beats prettiness.
- Validate all external input and model output with Zod. Reject path traversal
  in anything that touches the filesystem from a request.
- Keep modules small and pure where possible; the pipeline takes its providers
  as arguments so tests can inject fakes.
