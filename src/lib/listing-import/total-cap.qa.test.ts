// QA: the total-bytes cap across images (Requirement 7), with the cap lowered so the
// test does not allocate 300 MB.
import { describe, expect, it, vi } from "vitest";
import { ListingImportInputSchema } from "@/lib/api-schemas";
import { setupApiTestEnv } from "@/lib/api-test-helpers";
import { detailedImage } from "@/pipeline/test-helpers";
import { importListing, type Transport } from "./index";

vi.mock("./limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./limits")>()),
  MAX_IMPORT_TOTAL_BYTES: 1000,
}));

setupApiTestEnv("import-total-cap");

const cdn = (n: number) => `https://a0.muscache.com/im/pictures/${n}.jpg`;

describe("importListing total byte cap", () => {
  it("fetches no further image once the total is reached, and does not count the rest as skipped", async () => {
    const jpeg = await detailedImage(); // well over the lowered 1000-byte cap on its own
    const requested: string[] = [];
    const transport: Transport = async (url) => {
      if (url.hostname === "www.airbnb.com") {
        return { contentType: "text/html", body: Buffer.from([1, 2, 3].map((n) => `<img src="${cdn(n)}">`).join("")) };
      }
      requested.push(url.pathname);
      return { contentType: "image/jpeg", body: jpeg };
    };
    const result = await importListing(
      ListingImportInputSchema.parse({ url: "https://www.airbnb.com/rooms/1" }),
      transport,
    );
    expect(requested).toEqual(["/im/pictures/1.jpg"]);
    expect([result.imported, result.skipped]).toEqual([1, 0]);
  });

  it("counts bytes of rejected images toward the cap too", async () => {
    const requested: string[] = [];
    const transport: Transport = async (url) => {
      if (url.hostname === "www.airbnb.com") {
        return { contentType: "text/html", body: Buffer.from([1, 2, 3].map((n) => `<img src="${cdn(n)}">`).join("")) };
      }
      requested.push(url.pathname);
      return { contentType: "image/jpeg", body: Buffer.alloc(1200) };
    };
    await expect(
      importListing(ListingImportInputSchema.parse({ url: "https://www.airbnb.com/rooms/1" }), transport),
    ).rejects.toMatchObject({ status: 422 });
    expect(requested).toEqual(["/im/pictures/1.jpg"]);
  });
});
