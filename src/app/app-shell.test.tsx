import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeView } from "@/components/home-view";
import { TestRouter } from "@/components/test-router";
import OwnerLayout from "./(owner)/layout";
import RootLayout, { metadata } from "./layout";

// Server-renders the root and owner layouts with the home page's view (no listings) as their child.
function renderShell(): string {
  return renderToStaticMarkup(
    <TestRouter>
      <RootLayout>
        <OwnerLayout>
          <HomeView listings={[]} />
        </OwnerLayout>
      </RootLayout>
    </TestRouter>,
  );
}

describe("app shell", () => {
  it("sets the document title metadata", () => {
    expect(metadata.title).toBe("AI Photo Editor");
  });

  it("renders html lang=en, a header link to / and the page inside a centred main", () => {
    const html = renderShell();
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<header[^>]*>[\s\S]*<a [^>]*href="\/"[^>]*>AI Photo Editor<\/a>[\s\S]*<\/header>/);
    expect(html).toMatch(/<main class="[^"]*mx-auto[^"]*">[\s\S]*<h1[^>]*>AI Photo Editor<\/h1>[\s\S]*<\/main>/);
  });

  it("home page has the heading with Tailwind classes, a description and the create form", () => {
    const html = renderToStaticMarkup(
      <TestRouter>
        <HomeView listings={[]} />
      </TestRouter>,
    );
    expect(html).toMatch(/<h1 class="[^"]*\btext-3xl\b[^"]*\bfont-bold\b[^"]*">AI Photo Editor<\/h1>/);
    expect(html).toMatch(/<p[^>]*>[^<]*listing photos[^<]*<\/p>/i);
    expect(html).toMatch(/<form[\s\S]*<input id="listing-name"[\s\S]*<button type="submit"/);
  });

  it("the home page reads the store per request", async () => {
    const page = await import("./(owner)/page");
    expect(page.dynamic).toBe("force-dynamic");
  });
});
