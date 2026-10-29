// Markup checks for removing the listing URL import feature (job 008, AC 4 and 5).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "./home-view";
import { ProviderModeBanner } from "./provider-mode-banner";
import { TestRouter } from "./test-router";

describe("home page without the URL import form", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders the New listing form and the Listings section with no import form", () => {
    const html = renderToStaticMarkup(
      <TestRouter>
        <HomeView listings={[]} />
      </TestRouter>,
    );
    expect(html).toContain(">New listing</h2>");
    expect(html).toContain(">Listings</h2>");
    expect(html).not.toContain("Import from listing link");
    expect(html).not.toContain("Import photos");
    expect(html).not.toMatch(/type="url"/u);
    expect(html.match(/<form[\s>]/gu)).toHaveLength(1);
  });

  it("in full mock mode the banner ends at 'are not set.'", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    const html = renderToStaticMarkup(<ProviderModeBanner />);
    expect(html).toContain(
      ">Mock mode: no API calls are made, results are fake and cost $0. ANTHROPIC_API_KEY and FAL_KEY are not set.</p>",
    );
    expect(html).not.toContain("sample photos");
  });
});
