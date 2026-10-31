import { describe, expect, it } from "vitest";
import { buildContactMailto, contactSchema, type ContactInput } from "./landing-contact";
import { CONTACT_EMAIL } from "./landing-content";

const valid = {
  name: "Ann Host",
  email: "ann@example.org",
  listingUrl: "https://www.airbnb.com/rooms/123",
  message: "Ten photos of a beach flat.",
};

function parseMailto(href: string) {
  expect(href.startsWith("mailto:")).toBe(true);
  const [address, query] = href.slice("mailto:".length).split("?");
  return { address, params: new URLSearchParams(query) };
}

describe("contactSchema", () => {
  it("accepts valid input and trims the name", () => {
    const result = contactSchema.safeParse({ ...valid, name: "  Ann Host  " });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Ann Host");
  });

  it("accepts input without the optional fields", () => {
    expect(contactSchema.safeParse({ name: "Ann", email: "ann@example.org" }).success).toBe(true);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "a".repeat(101) }],
    ["an invalid email", { email: "not-an-email" }],
    ["a javascript: listing URL", { listingUrl: "javascript:alert(1)" }],
    ["an ftp: listing URL", { listingUrl: "ftp://example.com/listing" }],
    ["a listing URL over 500 characters", { listingUrl: `https://example.com/${"a".repeat(500)}` }],
    ["a message over 1000 characters", { message: "a".repeat(1001) }],
  ])("rejects %s", (_label, patch) => {
    expect(contactSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("names the failing fields", () => {
    const result = contactSchema.safeParse({ name: "", email: "" });
    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toContain("name");
    expect(fields).toContain("email");
  });
});

describe("buildContactMailto", () => {
  it("builds a mailto: to CONTACT_EMAIL whose decoded body holds every field", () => {
    const input = contactSchema.parse(valid);
    const { address, params } = parseMailto(buildContactMailto(input, CONTACT_EMAIL));
    expect(address).toBe(CONTACT_EMAIL);
    expect(params.get("subject")).toBeTruthy();
    const body = params.get("body") ?? "";
    for (const value of Object.values(valid)) expect(body).toContain(value);
  });

  it("encodes &, ?, # and newlines so they cannot add mailto parameters", () => {
    const input: ContactInput = {
      name: "Ann & Bob?cc=evil@example.com",
      email: "ann@example.org",
      listingUrl: "https://example.com/rooms?id=1&x=2#photos",
      message: "Line one\nbcc=evil@example.com&subject=Hacked#frag",
    };
    const href = buildContactMailto(input, CONTACT_EMAIL);
    expect(href).not.toContain("\n");
    expect(href).not.toContain("#");
    expect(href.match(/[?]/g)).toHaveLength(1);
    expect(href.match(/&/g)).toHaveLength(1);
    const { address, params } = parseMailto(href);
    expect(address).toBe(CONTACT_EMAIL);
    expect([...params.keys()]).toEqual(["subject", "body"]);
    const body = params.get("body") ?? "";
    expect(body).toContain(input.name);
    expect(body).toContain(input.listingUrl);
    expect(body).toContain(input.message);
  });
});
