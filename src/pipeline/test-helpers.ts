import sharp from "sharp";
import type { VisionAgent } from "./config";
import type {
  EditRequest,
  EditResponse,
  ImageEditor,
  VisionProvider,
  VisionRequest,
  VisionResponse,
} from "./providers/types";

/** A checkerboard JPEG: detailed enough to pass the prefilter at the default size. */
export async function detailedImage(width = 1600, height = 1000, cell = 16): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const i = (y * width + x) * 3;
      pixels[i] = on ? 200 : 60;
      pixels[i + 1] = on ? 190 : 70;
      pixels[i + 2] = on ? 180 : 80;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

export async function uniformImage(width = 1600, height = 1000, grey = 128): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: grey, g: grey, b: grey } } })
    .jpeg()
    .toBuffer();
}

type Scripted = { reply: unknown; costUsd?: number } | { error: Error };

/** Vision fake: replies from a per-agent queue and records every request. */
export class ScriptedVision implements VisionProvider {
  readonly requests: VisionRequest[] = [];
  private readonly queues: Partial<Record<VisionAgent, Scripted[]>> = {};

  on(agent: VisionAgent, ...items: Scripted[]): this {
    (this.queues[agent] ??= []).push(...items);
    return this;
  }

  calls(agent: VisionAgent): VisionRequest[] {
    return this.requests.filter((request) => request.agent === agent);
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    this.requests.push(request);
    const next = this.queues[request.agent]?.shift();
    if (!next) throw new Error(`No scripted reply for ${request.agent}`);
    if ("error" in next) throw next.error;
    return {
      text: typeof next.reply === "string" ? next.reply : JSON.stringify(next.reply),
      model: `fake-${request.agent}`,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUsd: next.costUsd ?? 0,
    };
  }
}

/** Editor fake: returns a brightened JPEG copy at a fixed cost, or throws when told to. */
export class FakeEditor implements ImageEditor {
  readonly requests: EditRequest[] = [];

  constructor(
    private readonly costUsd = 0.04,
    private readonly failWith: Error | null = null,
  ) {}

  async edit(request: EditRequest): Promise<EditResponse> {
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    const image = await sharp(request.image).modulate({ brightness: 1.1 }).jpeg().toBuffer();
    return { image, mimeType: "image/jpeg", costUsd: this.costUsd };
  }
}
