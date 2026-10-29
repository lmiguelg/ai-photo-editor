import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Listing, Photo } from "@/pipeline/schemas";
import { ExportPanel } from "./export-panel";
import { HomeView } from "./home-view";
import { PhotoCard, type PhotoCardProps } from "./photo-card";
import { ProviderModeBanner } from "./provider-mode-banner";
import { TestRouter } from "./test-router";
import { UploadPanel } from "./upload-panel";

const NOW = "2026-01-01T00:00:00.000Z";

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-1",
    listingId: "listing-1",
    roomType: "kitchen",
    originalName: "kitchen.jpg",
    originalFile: "original.jpg",
    status: "uploaded",
    attempts: [],
    bestAttemptIndex: null,
    costUsd: 0,
    decision: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const passedPhoto = (overrides: Partial<Photo> = {}) =>
  makePhoto({
    status: "passed",
    bestAttemptIndex: 0,
    costUsd: 0.083,
    attempts: [
      {
        index: 0,
        prompt: "Brighten",
        editedFile: "attempt-0.jpg",
        qa: {
          pass: true,
          scores: { faithfulness: 9, realism: 5, lighting: 8, coherence: 9 },
          reason: "Mock: edit looks natural and faithful.",
        },
        costUsd: 0.083,
        createdAt: NOW,
      },
    ],
    ...overrides,
  });

function card(photo: Photo, props: Partial<PhotoCardProps> = {}): string {
  return renderToStaticMarkup(
    <PhotoCard
      photo={photo}
      running={false}
      note=""
      message={null}
      selected={false}
      onNoteChange={() => {}}
      onSelect={() => {}}
      onRun={() => {}}
      onDecide={() => {}}
      onReset={() => {}}
      {...props}
    />,
  );
}

describe("ProviderModeBanner", () => {
  afterEach(() => vi.unstubAllEnvs());

  const render = () => renderToStaticMarkup(<ProviderModeBanner />);

  it("announces mock mode and names both keys when neither is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain("Mock mode");
    expect(html).toContain("no API calls are made");
    expect(html).toContain("cost $0");
    expect(html).toContain("ANTHROPIC_API_KEY");
    expect(html).toContain("FAL_KEY");
    expect(html).toContain("not set.</p>");
  });

  it("says vision is real and editing is mocked with only the Anthropic key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-SENTINEL");
    vi.stubEnv("FAL_KEY", "");
    const html = render();
    expect(html).toContain(
      "Partial mock mode: vision uses Anthropic (real, costs money); image editing is mocked (FAL_KEY not set).",
    );
    expect(html).not.toContain("SENTINEL");
  });

  it("says editing is real and vision is mocked with only the fal key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("FAL_KEY", "fal-SENTINEL");
    const html = render();
    expect(html).toContain("image editing uses fal.ai (real, costs money); vision is mocked (ANTHROPIC_API_KEY not set)");
    expect(html).not.toContain("SENTINEL");
  });

  it("renders nothing when both keys are set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-SENTINEL");
    vi.stubEnv("FAL_KEY", "fal-SENTINEL");
    expect(render()).toBe("");
  });
});

describe("PhotoCard", () => {
  it("renders untrusted names, errors, reasons and notes as escaped text", () => {
    const html = card(
      passedPhoto({
        originalName: "<img src=x onerror=alert(1)>",
        error: "<b>boom</b>",
        decision: { verdict: "rejected", note: "<i>note</i>", decidedAt: NOW },
      }),
      { message: "<u>msg</u>" },
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;boom&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;note&lt;/i&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).not.toContain("<u>");
  });

  it("shows a labelled before/after slider with both images when an edited attempt exists", () => {
    const html = card(passedPhoto());
    expect(html).toMatch(/<input[^>]*type="range"[^>]*aria-label="Before\/after comparison for kitchen.jpg"/);
    expect(html).toContain('alt="Original photo kitchen.jpg"');
    expect(html).toContain('alt="Edited photo kitchen.jpg"');
    expect(html).toContain("kind=original&amp;v=");
    expect(html).toContain("kind=edited&amp;v=");
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain("clip-path:inset(0 0 0 50%)");
  });

  it("shows only the original without an edited attempt", () => {
    const html = card(makePhoto());
    expect(html).toContain('alt="Original photo kitchen.jpg"');
    expect(html).not.toContain("Edited photo");
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("Approve");
  });

  it("shows QA scores with a text marker below the minimum, the reason, room type and cost", () => {
    const html = card(passedPhoto());
    expect(html).toContain("faithfulness: 9");
    expect(html).toContain("realism: 5<span> (below 7)</span>");
    expect(html).not.toContain("lighting: 8<span>");
    expect(html).toContain("Mock: edit looks natural and faithful.");
    expect(html).toContain("Kitchen");
    expect(html).toContain("$0.083");
  });

  it("is a focusable card named by file and status, with labelled note and decision buttons", () => {
    const html = card(passedPhoto());
    expect(html).toMatch(/<article[^>]*tabindex="0"[^>]*aria-label="kitchen.jpg, Passed"/);
    expect(html).toMatch(/<label for="note-photo-1"[^>]*>Review note<\/label>/);
    expect(html).toMatch(/<textarea[^>]*id="note-photo-1"[^>]*maxLength="2000"/i);
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Reject</button>");
    expect(html).toContain(">Re-run</button>");
  });

  it("shows the decision label on the chip and the decision note", () => {
    const approved = card(passedPhoto({ decision: { verdict: "approved", note: "", decidedAt: NOW } }));
    expect(approved).toContain(">Approved</span>");
    const rejected = card(passedPhoto({ decision: { verdict: "rejected", note: "too dark", decidedAt: NOW } }));
    expect(rejected).toContain(">Rejected by you</span>");
    expect(rejected).toContain("too dark");
  });

  it("disables Run with a reason and offers Reset only for a processing photo not run by this tab", () => {
    const stuck = card(makePhoto({ status: "processing" }));
    expect(stuck).toMatch(/<button[^>]*disabled=""[^>]*>Re-run<\/button>/);
    expect(stuck).toContain("Photo is processing");
    expect(stuck).toContain("Reset stuck photo");
    expect(stuck).toContain("motion-safe:animate-pulse");

    const mine = card(makePhoto({ status: "processing" }), { running: true });
    expect(mine).toContain("Running in this tab");
    expect(mine).not.toContain("Reset stuck photo");

    const idle = card(makePhoto());
    expect(idle).not.toContain("Reset stuck photo");
    expect(idle).toMatch(/<button[^>]*>Run<\/button>/);
    expect(idle).not.toMatch(/disabled=""[^>]*>Run</);
  });
});

describe("PhotoCard select checkbox", () => {
  const checkbox = (html: string) => html.match(/<input id="select-photo-1"[^>]*>/)?.[0] ?? "";

  it("is labelled by the file name and enabled for an uploaded photo", () => {
    const html = card(makePhoto());
    expect(html).toMatch(/<label for="select-photo-1"[^>]*>Select kitchen.jpg<\/label>/);
    expect(checkbox(html)).toContain('type="checkbox"');
    expect(checkbox(html)).not.toContain('disabled=""');
    expect(checkbox(html)).not.toContain('checked=""');
    expect(checkbox(card(makePhoto(), { selected: true }))).toContain('checked=""');
  });

  it("is disabled and unchecked for a passed photo, a running photo and an approved failure", () => {
    for (const html of [
      card(passedPhoto(), { selected: true }),
      card(makePhoto(), { selected: true, running: true }),
      card(makePhoto({ status: "failed", decision: { verdict: "approved", note: "", decidedAt: NOW } }), {
        selected: true,
      }),
    ]) {
      expect(checkbox(html)).toContain('disabled=""');
      expect(checkbox(html)).not.toContain('checked=""');
    }
    expect(checkbox(card(makePhoto({ status: "failed" }), { selected: true }))).toContain('checked=""');
  });
});

describe("UploadPanel", () => {
  it("has a labelled room type select defaulting to Other and a labelled file input", () => {
    const html = renderToStaticMarkup(<UploadPanel listingId="listing-1" onUploaded={() => {}} />);
    expect(html).toMatch(/<label for="upload-room-type"[^>]*>Room type for new uploads<\/label>/);
    expect(html).toMatch(/<select id="upload-room-type"/);
    expect(html).toContain('<option value="living_room">Living room</option>');
    expect(html).toContain('<option value="other" selected="">Other</option>');
    expect(html).toMatch(/<label for="upload-files"[^>]*>Choose files<input/);
    expect(html).toMatch(
      /<input id="upload-files" type="file" multiple="" accept=".jpg,.jpeg,.png,.webp,image\/jpeg,image\/png,image\/webp"/,
    );
  });
});

describe("HomeView", () => {
  const render = (listings: Listing[]) =>
    renderToStaticMarkup(
      <TestRouter>
        <HomeView listings={listings} />
      </TestRouter>,
    );

  it("renders the create form with labelled inputs and the empty state", () => {
    const html = render([]);
    expect(html).toMatch(/<label for="listing-name"[^>]*>Listing name<\/label>/);
    expect(html).toMatch(/<input id="listing-name" required="" maxLength="200"[^>]*name="name"/);
    expect(html).toMatch(/<label for="client-name"[^>]*>Client name \(optional\)<\/label>/);
    expect(html).toMatch(/<button type="submit"[^>]*>Create listing<\/button>/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("No listings yet");
  });

  it("lists listings with links, escaped names, photo counts, to-review chips and AI cost", () => {
    const listing: Listing = {
      id: "listing-1",
      name: "<b>Beach</b>",
      clientName: "Ann",
      createdAt: NOW,
      updatedAt: NOW,
      photos: [passedPhoto({ costUsd: 0.12 }), makePhoto({ id: "photo-2", costUsd: 0.08 })],
    };
    const empty: Listing = { ...listing, id: "listing-2", name: "Empty", clientName: null, photos: [] };
    const html = render([listing, empty]);
    expect(html).toContain('href="/listings/listing-1"');
    expect(html).toContain("&lt;b&gt;Beach&lt;/b&gt;");
    expect(html).toContain("Client: Ann");
    expect(html).toContain("2 photos");
    expect(html).toContain("1 to review");
    expect(html).toContain("AI cost $0.20");
    expect(html).toContain("0 photos");
    expect(html).toContain("AI cost $0.00");
    expect(html).not.toContain("No listings yet");
  });
});

describe("ExportPanel", () => {
  const listing = (photos: Photo[]): Listing => ({
    id: "listing-1",
    name: "Beach house",
    clientName: null,
    createdAt: NOW,
    updatedAt: NOW,
    photos,
  });
  const approved = (id: string) =>
    passedPhoto({ id, decision: { verdict: "approved", note: "", decidedAt: NOW } });
  const render = (photos: Photo[]) => renderToStaticMarkup(<ExportPanel listing={listing(photos)} />);

  it("shows the counts and what is left out", () => {
    const html = render([
      approved("a"),
      approved("b"),
      approved("c"),
      makePhoto({ id: "s", status: "skipped" }),
      passedPhoto({ id: "w" }),
      passedPhoto({ id: "x", decision: { verdict: "rejected", note: "", decidedAt: NOW } }),
      makePhoto({ id: "f", status: "failed" }),
      makePhoto({ id: "u" }),
    ]);
    expect(html).toContain('aria-labelledby="export-heading"');
    expect(html).toContain("Export for client");
    expect(html).toContain("Ready to export: 4 photos (3 enhanced, 1 original)");
    expect(html).toContain("Left out: 1 awaiting review, 1 rejected by you, 1 failed, 1 not run yet");
    expect(html).toContain("Download zip");
    expect(html).toContain("Email summary");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("$");
  });

  it("disables both buttons and explains why when nothing approved is enhanced", () => {
    const html = render([makePhoto({ id: "s", status: "skipped" }), passedPhoto({ id: "w" })]);
    expect(html).toContain("Ready to export: 1 photo (0 enhanced, 1 original)");
    expect(html).toContain("Left out: 1 awaiting review");
    expect(html).toContain(
      '<p id="export-hint" class="text-sm text-neutral-700">Approve at least one enhanced photo to export. Photos the pipeline skipped as already good are included automatically.</p>',
    );
    const buttons = [...html.matchAll(/<button[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain('disabled=""');
      expect(button).toContain('aria-describedby="export-hint"');
    }
    expect(html).not.toContain("Left out: 0");
  });
});
