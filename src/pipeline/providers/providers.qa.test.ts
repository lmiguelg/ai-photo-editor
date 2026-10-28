import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { costFromUsage } from "../cost";
import { AnthropicVisionProvider, type MessagesClient } from "./anthropic";
import { FalImageEditor } from "./fal";
import { MockVisionProvider } from "./mock";

const pngInput = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();

function scriptedFetch(responses: Response[]) {
  const urls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  }) as typeof fetch;
  return { fakeFetch, urls };
}

const OK_BODY = { images: [{ url: "https://fal.example/out.jpg" }] };

describe("FalImageEditor (QA)", () => {
  it("passes a PNG input as a data:image/png URI", async () => {
    let body: { image_url: string } | null = null;
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        body = JSON.parse(String(init.body));
        return Response.json(OK_BODY);
      }
      return new Response(Buffer.from("x"), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    const input = await pngInput();
    const result = await new FalImageEditor("k", fakeFetch).edit({ image: input, prompt: "p" });

    expect(body!.image_url).toBe(`data:image/png;base64,${input.toString("base64")}`);
    expect(result.mimeType).toBe("image/png");
  });

  it("throws when the output download is not 2xx", async () => {
    const { fakeFetch, urls } = scriptedFetch([Response.json(OK_BODY), new Response("gone", { status: 404 })]);
    await expect(new FalImageEditor("k", fakeFetch).edit({ image: await pngInput(), prompt: "p" })).rejects.toThrow(
      /download failed: HTTP 404/,
    );
    expect(urls).toEqual([config.fal.endpoint, "https://fal.example/out.jpg"]);
  });

  it("throws when the download is not an image", async () => {
    const { fakeFetch } = scriptedFetch([
      Response.json(OK_BODY),
      new Response("<html>", { headers: { "content-type": "text/html" } }),
    ]);
    await expect(new FalImageEditor("k", fakeFetch).edit({ image: await pngInput(), prompt: "p" })).rejects.toThrow(
      /not an image/,
    );
  });

  it("throws a clear error when the response body is not JSON-shaped as expected", async () => {
    const { fakeFetch } = scriptedFetch([Response.json({ images: [{ url: "" }] })]);
    await expect(new FalImageEditor("k", fakeFetch).edit({ image: await pngInput(), prompt: "p" })).rejects.toThrow(
      /invalid response/,
    );
  });
});

describe("AnthropicVisionProvider (QA)", () => {
  it("sends a text-only request with no image blocks and prices it with the cheap model", async () => {
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = {
      messages: {
        async create(params) {
          sent.push(params);
          return {
            content: [
              { type: "text", text: '{"prompt":' },
              { type: "text", text: '"x"}' },
            ],
            usage: {
              input_tokens: 1000,
              output_tokens: 100,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 400,
            },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const response = await new AnthropicVisionProvider("k", client).complete({
      agent: "refiner",
      system: "S",
      images: [],
      text: "t",
    });

    const content = sent[0].messages[0].content as Anthropic.ContentBlockParam[];
    expect(content).toEqual([{ type: "text", text: "t" }]);
    expect(sent[0].model).toBe(config.models.cheap);
    expect(response.text).toBe('{"prompt":"x"}');
    // Haiku assumed at $1 in / $5 out / $0.10 cache read per MTok.
    expect(response.costUsd).toBeCloseTo((1000 * 1 + 100 * 5 + 400 * 0.1) / 1e6, 12);
  });
});

describe("costFromUsage (QA)", () => {
  it("is zero for zero usage and prices cache write at the configured rate", () => {
    const zero = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    expect(costFromUsage(config.models.cheap, zero)).toBe(0);
    const prices = config.anthropicPrices[config.models.cheap];
    expect(costFromUsage(config.models.cheap, { ...zero, cacheCreationInputTokens: 1e6 })).toBeCloseTo(
      prices.cacheWrite,
      12,
    );
  });
});

describe("MockVisionProvider (QA)", () => {
  it("returns valid prompts for synthesizer and refiner and reports the configured model", async () => {
    const vision = new MockVisionProvider();
    for (const agent of ["synthesizer", "refiner"] as const) {
      const response = await vision.complete({ agent, system: "", images: [], text: "" });
      expect(JSON.parse(response.text).prompt.length).toBeGreaterThan(0);
      expect(response.model).toBe(config.models[config.agentTier[agent]]);
      expect(response.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      });
    }
  });
});
