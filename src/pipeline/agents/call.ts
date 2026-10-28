import type { z } from "zod";
import type { VisionAgent } from "../config";
import type { VisionProvider, VisionRequest } from "../providers/types";

/** One paid call in a photo run's cost log. */
export interface CallRecord {
  agent: VisionAgent | "editor";
  model: string;
  costUsd: number;
}

export interface AgentResult<T> {
  value: T;
  call: CallRecord;
}

/** A paid call whose reply was not valid output; carries the call so its cost is still logged. */
export class AgentOutputError extends Error {
  readonly call: CallRecord;

  constructor(message: string, call: CallRecord) {
    super(message);
    this.name = "AgentOutputError";
    this.call = call;
  }
}

/** Strips one surrounding markdown code fence, if any. */
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/);
  return match ? match[1] : text;
}

/** Calls the vision provider and validates its JSON reply with `schema`. */
export async function callAgent<T extends z.ZodType>(
  vision: VisionProvider,
  request: VisionRequest,
  schema: T,
): Promise<AgentResult<z.infer<T>>> {
  const response = await vision.complete(request);
  const call: CallRecord = { agent: request.agent, model: response.model, costUsd: response.costUsd };
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(response.text));
  } catch {
    throw new AgentOutputError(`${request.agent} returned invalid JSON: ${response.text.slice(0, 200)}`, call);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AgentOutputError(`${request.agent} returned invalid output: ${parsed.error.message}`, call);
  }
  return { value: parsed.data, call };
}
