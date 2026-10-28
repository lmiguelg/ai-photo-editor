import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout, { metadata } from "./layout";
import Home from "./page";

// Server-renders the root layout with the home page as its child.
function renderShell(): string {
  return renderToStaticMarkup(
    <RootLayout>
      <Home />
    </RootLayout>,
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

  it("home page has the heading with Tailwind classes and a description, no forms", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toMatch(/<h1 class="[^"]*\btext-3xl\b[^"]*\bfont-bold\b[^"]*">AI Photo Editor<\/h1>/);
    expect(html).toMatch(/<p[^>]*>[^<]*listing photos[^<]*<\/p>/i);
    expect(html).not.toMatch(/<form|<input|<button/);
  });
});
