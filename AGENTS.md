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
  - `layout.tsx`: header plus `ProviderModeBanner` above `<main>`.
  - `/` (`page.tsx`): create-listing form and the listings list (photo count, "N to review", AI cost). Rendered per request (`dynamic = "force-dynamic"`).
  - `/listings/[listingId]` (`listings/[listingId]/page.tsx`): loads the listing with `getListing` (404 via `notFound()`) and renders the client `ListingWorkspace`. Rendered per request.
  - `src/app/api/listings/` (JSON in and out, errors are `{"error": "<fixed message>"}`; invalid ids give 404):
    - `GET /api/listings`: all listings with their photos.
    - `POST /api/listings`: create a listing from `{ name, clientName? }` (201).
    - `GET /api/listings/[listingId]`: one listing with its photos.
    - `POST /api/listings/[listingId]/photos`: multipart upload of one `file` (jpg/jpeg/png/webp, checked with `sharp`) plus `roomType` (201). Capped at 25 MB per file (`MAX_UPLOAD_BYTES`); needs `Content-Length` (411 without, 413 over the cap).
    - `POST /api/listings/[listingId]/photos/[photoId]/run`: run the pipeline on one photo synchronously and persist the result. Returns 409 while the photo is already `processing`; re-runs are allowed from any other status.
    - `POST /api/listings/[listingId]/photos/[photoId]/decision`: `{ verdict: "approved" | "rejected", note? }` on a `passed`/`needs_review` photo (409 otherwise).
    - `GET /api/listings/[listingId]/photos/[photoId]/image?kind=original|edited&attempt=<n>`: stored image bytes; the file name comes only from the photo record.
    - `POST /api/listings/[listingId]/photos/[photoId]/reset`: recovers a photo stuck in `processing` after a crash or restart (`resetStuckPhoto`): it becomes `failed` with "Run interrupted" and a stale `.run.lock` is removed. 409 `Photo is running` while this process is running it (run registry in `process-photo.ts`); 409 `Photo is not stuck` when it is neither `processing` nor locked.
    - `GET /api/listings/[listingId]/export`: the client zip (`buildExportZip` in `src/lib/export.ts`), `attachment; filename="<slug>-photos.zip"`, `no-store`, `nosniff`. 404 `Not found` for an invalid or unknown id, 409 `Nothing approved to export` without an approved enhanced photo, 413 `Export too large` past `MAX_EXPORT_BYTES`, 500 when a source file is missing.
    - `GET /api/listings/[listingId]/export/summary`: `{ html, text }` email summary (`buildExportSummary`), `no-store`, `nosniff`; same 404/409 rules as the zip.
- `src/pipeline/`: the agents and harness (config, schemas, prompts, providers, run loop).
  `src/pipeline/schemas.ts` holds the Zod schemas and types for Listing, Photo,
  Attempt, QA result and Decision, plus the router and prompt agent outputs.
  - `config.ts`: every tunable: model ids per tier, agent tiers, token and fal prices, image sizes, `max_tokens`, limits, prefilter and QA thresholds, and `pricing.listingPriceUsd` (the $45 price the UI shows margin against).
  - `prompts.ts`: system prompt per agent (router, synthesizer, refiner, qa) and user-text builders.
  - `metrics.ts`: free local `sharp` metrics (`computeLocalMetrics`) and the `prefilter` that rejects junk before any paid call.
  - `images.ts`: `prepareForVision`, auto-rotate + downscale + JPEG for every vision call and the editor input.
  - `cost.ts`: `costFromUsage`, USD cost of an Anthropic call from its token usage.
  - `providers/`: `types.ts` (`VisionProvider`, `ImageEditor`), `anthropic.ts` (SDK, cached system prompt), `fal.ts` (fal.ai over `fetch`), `mock.ts` (free fakes) and `index.ts` (`createProviders(env)`, the only real-vs-mock switch; it takes its `mode` from `providerMode(env)`, which returns only the labels `anthropic|mock` / `fal|mock` and is what the mock-mode banner reads).
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
  - `src/lib/process-photo.ts`: `processPhoto`, which claims a photo, runs `runPhoto` on it and persists edited files, attempts, status and accumulated cost. It keeps an in-process run registry (a set on `globalThis`, shared by all route bundles): `isPhotoRunning(listingId, photoId)` is true from a successful claim until the run ends. The `/reset` route refuses while it is true; after a restart it is empty.
  - `src/lib/review.ts`: client-safe pure helpers for the UI (no `node:*`, sharp, store or providers): status chips and room-type labels, `sortForReview`, `isRunAllEligible` (only `uploaded`/`failed`, never approved), `runQueue` with `RUN_ALL_CONCURRENCY = 2`, run-outcome handling (409 is quiet), `costSummary`/`formatUsd`, client upload checks, `reviewKeyAction` (j/k/a/r) and `exportSelection`/`canExport` (the client export selection rule below).
  - `src/lib/export.ts`: `buildExportZip(listing, maxBytes = MAX_EXPORT_BYTES)` builds the client zip in memory with `fflate`: `photos/<NN>-<room>-<k>.<ext>` (enhanced images re-encoded with `sharp` to strip editor metadata, skipped originals byte for byte) and `previews/<NN>-<room>-<k>-before-after.jpg` (1608×600 side-by-side). Entry names come only from position and room type and are checked against `^(photos|previews)/[a-z0-9-]+\.(jpg|png|webp)$`; source files come only from the photo records via `getPhotoFilePath`. Source bytes are summed with `fs.stat` before reading (300 MB cap, 413).
  - `src/lib/export-summary.ts`: pure (no `node:*`, sharp or store) `escapeHtml` and `buildExportSummary(listing)`, the email text as `{ html, text }`. The HTML is one styled `<div>` with only `<p>`, `<ul>`, `<li>`; every value is escaped.
  - `src/lib/api-schemas.ts`: request-only Zod schemas (route params, upload fields, decision body, image query).
- `src/components/`: UI components. `provider-mode-banner.tsx` and `home-view.tsx` are server components; the rest are client components (`"use client"`) that import only `@/pipeline/schemas`, `@/pipeline/config`, `@/lib/review` and each other, and talk to the API routes with `fetch`: `listing-workspace.tsx` (cost header, upload, run all with Stop, keyboard review, reset), `export-panel.tsx` (export counts, "Download zip", "Email summary" with copy buttons; the summary HTML only goes to the clipboard, never into the page), `photo-card.tsx`, `before-after-slider.tsx`, `upload-panel.tsx`, `create-listing-form.tsx`, `status-chip.tsx`. Untrusted text is rendered only as React text; animations are `motion-safe:` only. `test-router.tsx` is a test-only router context for markup tests.
- `data/`: runtime listings, photos, results, logs. Never commit. On-disk layout:
  ```
  data/listings/<listingId>/listing.json                  listing fields, no photos
  data/listings/<listingId>/photos/<photoId>/photo.json   one photo record
  data/listings/<listingId>/photos/<photoId>/original.<ext>  uploaded bytes
  data/listings/<listingId>/photos/<photoId>/attempt-<index>.<ext>  edited image per attempt (overwritten on re-run)
  ```
  One JSON file per photo, so photos of one listing can be updated concurrently.

## Client export

Selection rule (`exportSelection`): a client export holds approved `passed`/`needs_review` photos with an edited file (the enhanced image) plus `skipped` photos (their originals); every other photo is left out with a reason. Export needs at least one approved enhanced photo. Nothing sent to clients (zip entries, previews, email summary) may hold costs, prices, margins, QA scores, prompts, notes, errors, original file names, ids or paths.

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
  Costs are visible per photo and per listing in the owner UI only; they never
  appear in anything sent to clients (export zips or email summaries).
- Without `ANTHROPIC_API_KEY` / `FAL_KEY` the pipeline uses mock providers so
  tests and the UI work for free. Tests never call real APIs.

## Conventions

- Never let enhancement add, remove or reshape anything that would misrepresent
  the property. Faithfulness beats prettiness.
- Validate all external input and model output with Zod. Reject path traversal
  in anything that touches the filesystem from a request.
- Keep modules small and pure where possible; the pipeline takes its providers
  as arguments so tests can inject fakes.
