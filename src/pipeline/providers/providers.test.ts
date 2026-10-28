import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "../config";
import { costFromUsage } from "../cost";
import { prepareForVision } from "../images";
import { detailedImage } from "../test-helpers";
import { AnthropicVisionProvider, type MessagesClient } from "./anthropic";
import { FalImageEditor } from "./fal";
import { createProviders } from "./index";
import { MockImageEditor, MockVisionProvider } from "./mock";

describe("costFromUsage", () => {
  it("prices input, output, cache write and cache read per million tokens", () => {
    const model = config.models.strong;
    const prices = config.anthropicPrices[model];
    const usage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationInputTokens: 500,
      cacheReadInputTokens: 2000,
    };
    const expected =
      (1000 * prices.input + 200 * prices.output + 500 * prices.cacheWrite + 2000 * prices.cacheRead) / 1e6;
    expect(costFromUsage(model, usage)).toBeCloseTo(expected, 12);
    // With the assumed Sonnet prices ($3 / $15 / $3.75 / $0.30 per MTok).
    expect(costFromUsage(model, usage)).toBeCloseTo(0.003 + 0.003 + 0.001875 + 0.0006, 12);
  });

  it("throws for a model without configured prices", () => {
    expect(() =>
      costFromUsage("unknown-model", {
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toThrow(/No Anthropic prices/);
  });
});

function fakeClient(text: string) {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        sent.push(params);
        return {
          content: [{ type: "text", text }],
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: 400,
          },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, sent };
}

describe("AnthropicVisionProvider", () => {
  it("sends the system prompt with ephemeral cache_control and the configured model per agent", async () => {
    const { client, sent } = fakeClient('{"route":"enhance","reason":"x"}');
    const provider = new AnthropicVisionProvider("test-key", client);
    const image = await prepareForVision(await detailedImage(2000, 1200));

    const response = await provider.complete({ agent: "router", system: "SYSTEM", images: [image], text: "hi" });

    const params = sent[0];
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toBe("SYSTEM");
    expect(params.model).toBe(config.models[config.agentTier.router]);
    expect(params.max_tokens).toBe(config.maxTokens.router);
    const content = params.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    expect(content[1]).toEqual({ type: "text", text: "hi" });

    expect(response.text).toBe('{"route":"enhance","reason":"x"}');
    expect(response.model).toBe(config.models.cheap);
    expect(response.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 400,
    });
    expect(response.costUsd).toBeCloseTo(costFromUsage(config.models.cheap, response.usage), 12);
  });

  it("uses the strong model for the synthesizer and QA", async () => {
    const { client, sent } = fakeClient("{}");
    const provider = new AnthropicVisionProvider("test-key", client);
    await provider.complete({ agent: "synthesizer", system: "S", images: [], text: "t" });
    await provider.complete({ agent: "qa", system: "S", images: [], text: "t" });
    await provider.complete({ agent: "refiner", system: "S", images: [], text: "t" });
    expect(sent.map((params) => params.model)).toEqual([
      config.models.strong,
      config.models.strong,
      config.models.cheap,
    ]);
  });
});

describe("FalImageEditor", () => {
  it("sends the Key auth header and returns the downloaded bytes at the configured cost", async () => {
    const editedBytes = Buffer.from("edited-image-bytes");
    const requests: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === config.fal.endpoint) {
        return Response.json({ images: [{ url: "https://fal.example/out.jpg", content_type: "image/jpeg" }] });
      }
      return new Response(editedBytes, { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;

    const editor = new FalImageEditor("fal-secret", fakeFetch);
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
      .jpeg()
      .toBuffer();
    const result = await editor.edit({ image: input, prompt: "Brighten" });

    expect(requests[0].url).toBe(config.fal.endpoint);
    expect(new Headers(requests[0].init?.headers).get("Authorization")).toBe("Key fal-secret");
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.prompt).toBe("Brighten");
    expect(body.image_url).toBe(`data:image/jpeg;base64,${input.toString("base64")}`);
    expect(requests[1].url).toBe("https://fal.example/out.jpg");
    expect(result.image.equals(editedBytes)).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.costUsd).toBe(config.fal.costPerImageUsd);
  });

  it("throws a clear error on a non-2xx response", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    const editor = new FalImageEditor("fal-secret", fakeFetch);
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    await expect(editor.edit({ image: input, prompt: "x" })).rejects.toThrow(/fal\.ai edit failed: HTTP 429/);
  });

  it("throws a clear error on an invalid response body", async () => {
    const fakeFetch = (async () => Response.json({ images: [] })) as typeof fetch;
    const editor = new FalImageEditor("fal-secret", fakeFetch);
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    await expect(editor.edit({ image: input, prompt: "x" })).rejects.toThrow(/invalid response/);
  });
});

describe("mock providers", () => {
  it("mock vision returns valid canned JSON per agent at zero cost", async () => {
    const vision = new MockVisionProvider();
    const router = await vision.complete({ agent: "router", system: "", images: [], text: "" });
    const qa = await vision.complete({ agent: "qa", system: "", images: [], text: "" });
    expect(JSON.parse(router.text).route).toBe("enhance");
    const qaReply = JSON.parse(qa.text);
    expect(qaReply.pass).toBe(true);
    for (const key of config.qa.rubric) expect(qaReply.scores[key]).toBeGreaterThanOrEqual(8);
    expect(router.costUsd).toBe(0);
    expect(qa.costUsd).toBe(0);
  });

  it("mock editor returns a changed JPEG copy at zero cost", async () => {
    const input = await detailedImage(200, 100);
    const result = await new MockImageEditor().edit({ image: input, prompt: "x" });
    expect(result.costUsd).toBe(0);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.image.equals(input)).toBe(false);
    const [before, after] = await Promise.all([sharp(input).stats(), sharp(result.image).stats()]);
    expect(after.channels[0].mean).toBeGreaterThan(before.channels[0].mean);
  });
});

describe("createProviders", () => {
  it("returns mock providers when no keys are set", () => {
    const providers = createProviders({});
    expect(providers.mode).toEqual({ vision: "mock", editor: "mock" });
    expect(providers.vision).toBeInstanceOf(MockVisionProvider);
    expect(providers.editor).toBeInstanceOf(MockImageEditor);
  });

  it("treats empty keys as unset and picks each provider independently", () => {
    expect(createProviders({ ANTHROPIC_API_KEY: "", FAL_KEY: "y" }).mode).toEqual({ vision: "mock", editor: "fal" });
    expect(createProviders({ ANTHROPIC_API_KEY: "x" }).mode).toEqual({ vision: "anthropic", editor: "mock" });
  });

  it("returns real providers when both keys are set, without any network call", () => {
    const providers = createProviders({ ANTHROPIC_API_KEY: "x", FAL_KEY: "y" });
    expect(providers.mode).toEqual({ vision: "anthropic", editor: "fal" });
    expect(providers.vision).toBeInstanceOf(AnthropicVisionProvider);
    expect(providers.editor).toBeInstanceOf(FalImageEditor);
  });
});
