import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDataDir, listingDir, photoDir, safeJoin } from "./paths";
import { getPhotoFilePath, StoreError } from "./store";

const base = path.resolve(os.tmpdir(), "ai-photo-editor-paths-test");
const listingId = "3f2a9c1e-1b2c-4d5e-8f90-abcdef012345";
const photoId = "a1b2c3d4-0000-4000-8000-000000000001";

const originalDataDir = process.env.DATA_DIR;
afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getDataDir", () => {
  it("defaults to <cwd>/data", () => {
    delete process.env.DATA_DIR;
    expect(getDataDir()).toBe(path.join(process.cwd(), "data"));
  });

  it("uses DATA_DIR as an absolute path, read on every call", () => {
    process.env.DATA_DIR = base;
    expect(getDataDir()).toBe(base);
    process.env.DATA_DIR = "relative-data";
    expect(getDataDir()).toBe(path.resolve("relative-data"));
  });
});

describe("safeJoin", () => {
  it("returns paths inside base", () => {
    const joined = safeJoin(base, "a", "b.jpg");
    expect(joined).toBe(path.join(base, "a", "b.jpg"));
    expect(path.relative(base, joined).startsWith("..")).toBe(false);
    expect(safeJoin(base)).toBe(base);
    expect(safeJoin(base, "a", "..")).toBe(base);
  });

  it.each(["..", "../x", "a/../../x", "..\\x", "a\\..\\..\\x"])("throws for %j", (segment) => {
    expect(() => safeJoin(base, segment)).toThrow(StoreError);
  });

  it("throws for an absolute path outside base", () => {
    expect(() => safeJoin(base, path.resolve(os.tmpdir(), "elsewhere"))).toThrow(StoreError);
  });
});

describe("id helpers", () => {
  it("build paths for valid ids", () => {
    process.env.DATA_DIR = base;
    expect(listingDir(listingId)).toBe(path.join(base, "listings", listingId));
    expect(photoDir(listingId, photoId)).toBe(
      path.join(base, "listings", listingId, "photos", photoId),
    );
  });

  it.each(["../x", "ABC", "a/b", ""])("throw for id %j", (id) => {
    expect(() => listingDir(id)).toThrow(StoreError);
    expect(() => photoDir(listingId, id)).toThrow(StoreError);
  });
});

describe("getPhotoFilePath", () => {
  it("returns the file inside the photo folder", () => {
    expect(getPhotoFilePath(listingId, photoId, "original.jpg")).toBe(
      path.join(getDataDir(), "listings", listingId, "photos", photoId, "original.jpg"),
    );
  });

  it.each(["../listing.json", "a/b.jpg", "a\\b.jpg", "..", ""])("throws for file name %j", (name) => {
    expect(() => getPhotoFilePath(listingId, photoId, name)).toThrow(StoreError);
  });

  it("throws for invalid ids", () => {
    expect(() => getPhotoFilePath("../x", photoId, "original.jpg")).toThrow(StoreError);
    expect(() => getPhotoFilePath(listingId, "../x", "original.jpg")).toThrow(StoreError);
  });
});
