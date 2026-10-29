// QA: providerMode is the one source of the real-vs-mock labels and never carries key values.
import { describe, expect, it } from "vitest";
import { createProviders, providerMode } from "./index";

const SENTINEL_ENV = { ANTHROPIC_API_KEY: "sk-test-SENTINEL", FAL_KEY: "fal-SENTINEL" };

describe("providerMode", () => {
  it.each([
    [{}, { vision: "mock", editor: "mock" }],
    [{ ANTHROPIC_API_KEY: "", FAL_KEY: "" }, { vision: "mock", editor: "mock" }],
    [{ ANTHROPIC_API_KEY: SENTINEL_ENV.ANTHROPIC_API_KEY }, { vision: "anthropic", editor: "mock" }],
    [{ FAL_KEY: SENTINEL_ENV.FAL_KEY }, { vision: "mock", editor: "fal" }],
    [SENTINEL_ENV, { vision: "anthropic", editor: "fal" }],
  ])("%j -> %j", (env, expected) => {
    const mode = providerMode(env);
    expect(mode).toEqual(expected);
    expect(JSON.stringify(mode)).not.toContain("SENTINEL");
  });

  it("matches createProviders' mode for every combination", () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: "k" }, { FAL_KEY: "k" }, { ANTHROPIC_API_KEY: "k", FAL_KEY: "k" }]) {
      expect(createProviders(env).mode).toEqual(providerMode(env));
    }
  });
});
