import type { VisionAgent } from "../config";
import type { TokenUsage } from "../cost";
import type { PreparedImage } from "../images";

export interface VisionRequest {
  agent: VisionAgent;
  system: string;
  /** Outputs of `prepareForVision`; empty for text-only calls. */
  images: PreparedImage[];
  text: string;
}

export interface VisionResponse {
  text: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
}

export interface VisionProvider {
  complete(request: VisionRequest): Promise<VisionResponse>;
}

export interface EditRequest {
  image: Buffer;
  prompt: string;
}

export interface EditResponse {
  image: Buffer;
  mimeType: string;
  costUsd: number;
}

export interface ImageEditor {
  edit(request: EditRequest): Promise<EditResponse>;
}

export interface Providers {
  vision: VisionProvider;
  editor: ImageEditor;
}
