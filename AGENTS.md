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
  - `src/app/api/listings/` (JSON in and out, errors are `{"error": "<fixed message>"}`; invalid ids give 404):
    - `GET /api/listings`: all listings with their photos.
    - `POST /api/listings`: create a listing from `{ name, clientName? }` (201).
    - `GET /api/listings/[listingId]`: one listing with its photos.
    - `POST /api/listings/[listingId]/photos`: multipart upload of one `file` (jpg/jpeg/png/webp, checked with `sharp`) plus `roomType` (201). Capped at 25 MB per file (`MAX_UPLOAD_BYTES`); needs `Content-Length` (411 without, 413 over the cap).
    - `POST /api/listings/[listingId]/photos/[photoId]/run`: run the pipeline on one photo synchronously and persist the result. Returns 409 while the photo is already `processing`; re-runs are allowed from any other status.
    - `POST /api/listings/[listingId]/photos/[photoId]/decision`: `{ verdict: "approved" | "rejected", note? }` on a `passed`/`needs_review` photo (409 otherwise).
    - `GET /api/listings/[listingId]/photos/[photoId]/image?kind=original|edited&attempt=<n>`: stored image bytes; the file name comes only from the photo record.
- `src/pipeline/`: the agents and harness (config, schemas, prompts, providers, run loop).
  `src/pipeline/schemas.ts` holds the Zod schemas and types for Listing, Photo,
  Attempt, QA result and Decision, plus the router and prompt agent outputs.
  - `config.ts`: every tunable: model ids per tier, agent tiers, token and fal prices, image sizes, `max_tokens`, limits, prefilter and QA thresholds.
  - `prompts.ts`: system prompt per agent (router, synthesizer, refiner, qa) and user-text builders.
  - `metrics.ts`: free local `sharp` metrics (`computeLocalMetrics`) and the `prefilter` that rejects junk before any paid call.
  - `images.ts`: `prepareForVision`, auto-rotate + downscale + JPEG for every vision call and the editor input.
  - `cost.ts`: `costFromUsage`, USD cost of an Anthropic call from its token usage.
  - `providers/`: `types.ts` (`VisionProvider`, `ImageEditor`), `anthropic.ts` (SDK, cached system prompt), `fal.ts` (fal.ai over `fetch`), `mock.ts` (free fakes) and `index.ts` (`createProviders(env)`, the only real-vs-mock switch).
  - `agents/`: one function per agent (router, synthesizer, refiner, qa) plus `call.ts`, which calls the provider and validates the JSON reply with Zod.
  - `run-photo.ts`: `runPhoto`, the per-photo loop (prefilter, route, synthesize, edit/QA with capped text-only retries and a cost cap). It is storage-free and persists nothing: it takes the original bytes and returns attempts with edited bytes, the cost log and status for the caller to persist.
  - `test-helpers.ts`: in-memory test images and scripted vision/editor fakes for tests.
- `src/lib/`: filesystem store and shared helpers.
  - `src/lib/paths.ts`: `getDataDir()` (the only place `DATA_DIR` is read),
    `safeJoin()` and the per-listing/per-photo folder helpers. All file access
    from the store goes through `safeJoin`.
  - `src/lib/store.ts`: async listing/photo CRUD, validated with the schemas on
    read and write, atomic JSON writes, `StoreError` with code `not_found` / `invalid` / `conflict`,
    and `claimPhotoForRun`, which sets `processing` under a per-photo lock file.
  - `src/lib/http.ts`: shared route helpers: the one error-to-response mapper, size caps, JSON body reading and `safeHeaderFileName`.
  - `src/lib/process-photo.ts`: `processPhoto`, which claims a photo, runs `runPhoto` on it and persists edited files, attempts, status and accumulated cost.
  - `src/lib/api-schemas.ts`: request-only Zod schemas (route params, upload fields, decision body, image query).
- `data/`: runtime listings, photos, results, logs. Never commit. On-disk layout:
  ```
  data/listings/<listingId>/listing.json                  listing fields, no photos
  data/listings/<listingId>/photos/<photoId>/photo.json   one photo record
  data/listings/<listingId>/photos/<photoId>/original.<ext>  uploaded bytes
  data/listings/<listingId>/photos/<photoId>/attempt-<index>.<ext>  edited image per attempt (overwritten on re-run)
  ```
  One JSON file per photo, so photos of one listing can be updated concurrently.

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
