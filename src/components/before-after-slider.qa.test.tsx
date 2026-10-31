import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeforeAfterSlider } from "./before-after-slider";

const props = { originalSrc: "/o.jpg", editedSrc: "/e.jpg", name: "kitchen.jpg" };

// Markup of the slider on main (before this job), rendered with the props above
// (React 19 adds the image preload links when server-rendering plain <img>).
const MAIN_MARKUP =
  '<link rel="preload" as="image" href="/o.jpg"/><link rel="preload" as="image" href="/e.jpg"/>' +
  '<div class="space-y-2"><div class="relative overflow-hidden rounded-md bg-neutral-200">' +
  '<img src="/o.jpg" alt="Original photo kitchen.jpg" class="block h-auto w-full"/>' +
  '<img src="/e.jpg" alt="Edited photo kitchen.jpg" class="absolute inset-0 h-full w-full object-cover" style="clip-path:inset(0 0 0 50%)"/>' +
  '<div aria-hidden="true" class="absolute inset-y-0 w-0.5 bg-white shadow" style="left:50%"></div>' +
  '<span class="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">Before</span>' +
  '<span class="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">After</span></div>' +
  '<input type="range" min="0" max="100" step="1" aria-label="Before/after comparison for kitchen.jpg" ' +
  'class="w-full cursor-ew-resize rounded accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2" value="50"/></div>';

describe("BeforeAfterSlider (req 17)", () => {
  it("renders exactly as before without width and height", () => {
    expect(renderToStaticMarkup(<BeforeAfterSlider {...props} />)).toBe(MAIN_MARKUP);
  });

  it("falls back to plain <img> when only one of width/height is given", () => {
    const html = renderToStaticMarkup(<BeforeAfterSlider {...props} width={800} />);
    expect(html).toBe(MAIN_MARKUP);
  });

  it("renders both layers with next/image when width and height are given", () => {
    const html = renderToStaticMarkup(<BeforeAfterSlider {...props} width={1600} height={800} />);
    const imgs = html.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(2);
    const [base, top] = imgs;
    expect(base).toContain('alt="Original photo kitchen.jpg"');
    expect(base).toContain('width="1600"');
    expect(base).toContain('height="800"');
    expect(base).toMatch(/sizes="[^"]+"/);
    expect(base).toContain("/_next/image?url=%2Fo.jpg");
    expect(top).toContain('alt="Edited photo kitchen.jpg"');
    expect(top).toContain("/_next/image?url=%2Fe.jpg");
    expect(top).toContain("object-cover");
    expect(top).toMatch(/position:absolute/);
    expect(top).toContain("clip-path:inset(0 0 0 50%)");
    expect(top).toMatch(/sizes="[^"]+"/);
  });

  it("keeps the labels, divider and keyboard-operable range input in next/image mode", () => {
    const html = renderToStaticMarkup(<BeforeAfterSlider {...props} width={1600} height={800} />);
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain('style="left:50%"');
    expect(html).toMatch(/<input type="range" min="0" max="100" step="1" aria-label="Before\/after comparison for kitchen.jpg"[^>]*focus-visible:ring-2[^>]*value="50"/);
  });

  it("photo-card still calls the slider without width/height", async () => {
    const source = await readFile(path.join(__dirname, "photo-card.tsx"), "utf8");
    const call = source.match(/<BeforeAfterSlider[\s\S]*?\/>/)?.[0] ?? "";
    expect(call).not.toBe("");
    expect(call).not.toMatch(/\b(width|height)=/);
  });
});
