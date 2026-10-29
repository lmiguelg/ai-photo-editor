// QA: stuck-photo recovery through the real handlers: a crash leaves a photo
// processing (and maybe a stale lock), run gives 409, reset makes it failed,
// run works again.
import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, ctx, imageFile, jsonRequest, multipartRequest, setupApiTestEnv } from "@/lib/api-test-helpers";
import { updatePhoto } from "@/lib/store";
import { PhotoSchema } from "@/pipeline/schemas";
import { detailedImage } from "@/pipeline/test-helpers";
import { GET as getListingRoute } from "./[listingId]/route";
import { POST as uploadRoute } from "./[listingId]/photos/route";
import { POST as decisionRoute } from "./[listingId]/photos/[photoId]/decision/route";
import { POST as resetRoute } from "./[listingId]/photos/[photoId]/reset/route";
import { POST as runRoute } from "./[listingId]/photos/[photoId]/run/route";
import { POST as createRoute } from "./route";

const getDataDir = setupApiTestEnv("reset-flow-qa");

let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await detailedImage(1024, 768);
});

type Ids = { listingId: string; photoId: string };

async function uploaded(roomType = "kitchen"): Promise<Ids> {
  const created = await createRoute(jsonRequest(BASE_URL, { name: "Beach house" }));
  const listingId = (await created.json()).id as string;
  const req = await multipartRequest(`${BASE_URL}/${listingId}/photos`, { file: imageFile(jpeg, "room.jpg"), roomType });
  const res = await uploadRoute(req, ctx({ listingId }));
  expect(res.status).toBe(201);
  return { listingId, photoId: (await res.json()).id };
}

const url = (ids: Ids, rest: string) => `${BASE_URL}/${ids.listingId}/photos/${ids.photoId}/${rest}`;
const post = (ids: Ids, rest: string) => new Request(url(ids, rest), { method: "POST" });
const run = (ids: Ids) => runRoute(post(ids, "run"), ctx(ids));
const reset = (ids: Ids) => resetRoute(post(ids, "reset"), ctx(ids));
const lockFile = (ids: Ids) => path.join(getDataDir(), "listings", ids.listingId, "photos", ids.photoId, ".run.lock");

describe("stuck-photo recovery through the handlers", () => {
  it("a 1024x768 kitchen upload runs to passed in mock mode at $0", async () => {
    const ids = await uploaded();
    const res = await run(ids);
    expect(res.status).toBe(200);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.roomType).toBe("kitchen");
    expect(photo.status).toBe("passed");
    expect(photo.costUsd).toBe(0);
    expect(photo.attempts[0]?.qa?.reason).toBe("Mock: edit looks natural and faithful.");
  });

  it("simulated crash: run gives 409, reset gives failed / Run interrupted and removes the lock, run works again", async () => {
    const ids = await uploaded();
    await updatePhoto(ids.listingId, ids.photoId, (photo) => ({ ...photo, status: "processing" }));
    await fs.writeFile(lockFile(ids), "");

    expect((await run(ids)).status).toBe(409);

    const res = await reset(ids);
    expect(res.status).toBe(200);
    const photo = PhotoSchema.parse(await res.json());
    expect(photo.status).toBe("failed");
    expect(photo.error).toBe("Run interrupted");
    await expect(fs.stat(lockFile(ids))).rejects.toThrow();

    const listing = await (await getListingRoute(new Request(`${BASE_URL}/${ids.listingId}`), ctx({ listingId: ids.listingId }))).json();
    expect(listing.photos.map((p: { status: string }) => p.status)).toEqual(["failed"]);

    const rerun = await run(ids);
    expect(rerun.status).toBe(200);
    const after = PhotoSchema.parse(await rerun.json());
    expect(after.status).toBe("passed");
    expect(after.error).toBeNull();
  });

  it("a second reset after recovery is refused as not stuck", async () => {
    const ids = await uploaded();
    await updatePhoto(ids.listingId, ids.photoId, (photo) => ({ ...photo, status: "processing" }));
    expect((await reset(ids)).status).toBe(200);
    const again = await reset(ids);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "Photo is not stuck" });
  });

  it("a decided photo is not reset and keeps its decision", async () => {
    const ids = await uploaded();
    expect((await run(ids)).status).toBe(200);
    const decided = await decisionRoute(jsonRequest(url(ids, "decision"), { verdict: "approved", note: " ok " }), ctx(ids));
    expect(decided.status).toBe(200);
    const res = await reset(ids);
    expect(res.status).toBe(409);
    const listing = await (await getListingRoute(new Request(`${BASE_URL}/${ids.listingId}`), ctx({ listingId: ids.listingId }))).json();
    expect(listing.photos[0].decision).toMatchObject({ verdict: "approved", note: "ok" });
  });

  it("reset error bodies are fixed messages for invalid ids", async () => {
    const res = await resetRoute(post({ listingId: "<script>", photoId: "x" }, "reset"), ctx({ listingId: "<script>", photoId: "x" }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Not found"}');
  });
});
