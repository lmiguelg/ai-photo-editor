import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Req 12: with no verifiable statistic the stats array is empty and the section is not rendered.
vi.mock("@/lib/landing-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/landing-content")>();
  return { ...actual, STATS: [] };
});

describe("landing page without stats", () => {
  it("omits the stats section and shows no percentage", async () => {
    const { default: LandingPage } = await import("./page");
    const html = renderToStaticMarkup(<LandingPage />);
    expect(html).not.toContain("Why photos matter");
    expect(html).not.toContain('id="stats-heading"');
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(/\d\s?%/);
    expect(html).toContain('id="contact"');
  });
});
