import sharp from "sharp";
import { z } from "zod";
import { config as defaultConfig, type PipelineConfig } from "../config";
import type { EditRequest, EditResponse, ImageEditor } from "./types";

const FalResponseSchema = z.object({
  images: z
    .array(z.object({ url: z.string().min(1), content_type: z.string().optional() }))
    .min(1),
});

/** fal.ai instruction-based image editor over plain `fetch`. */
export class FalImageEditor implements ImageEditor {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly cfg: PipelineConfig;

  constructor(apiKey: string, fetchFn: typeof fetch = fetch, cfg: PipelineConfig = defaultConfig) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
    this.cfg = cfg;
  }

  async edit({ image, prompt }: EditRequest): Promise<EditResponse> {
    const { format } = await sharp(image).metadata();
    const imageUrl = `data:image/${format};base64,${image.toString("base64")}`;

    const res = await this.fetchFn(this.cfg.fal.endpoint, {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, image_url: imageUrl }),
    });
    if (!res.ok) {
      throw new Error(`fal.ai edit failed: HTTP ${res.status} ${await res.text()}`.trim());
    }
    const parsed = FalResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`fal.ai edit returned an invalid response: ${parsed.error.message}`);
    }

    const output = parsed.data.images[0];
    const download = await this.fetchFn(output.url);
    if (!download.ok) {
      throw new Error(`fal.ai image download failed: HTTP ${download.status}`);
    }
    const mimeType = output.content_type ?? download.headers.get("content-type") ?? "";
    if (!mimeType.startsWith("image/")) {
      throw new Error(`fal.ai image download is not an image (content type "${mimeType}")`);
    }
    return {
      image: Buffer.from(await download.arrayBuffer()),
      mimeType,
      costUsd: this.cfg.fal.costPerImageUsd,
    };
  }
}
