import type { PreparedImage } from "../images";
import type { LocalMetrics } from "../metrics";
import { ROUTER_SYSTEM, routerUserText } from "../prompts";
import type { VisionProvider } from "../providers/types";
import { RouteDecisionSchema, type RoomType } from "../schemas";
import { callAgent } from "./call";

export function runRouter(
  vision: VisionProvider,
  input: { original: PreparedImage; roomType: RoomType; metrics: LocalMetrics },
) {
  return callAgent(
    vision,
    {
      agent: "router",
      system: ROUTER_SYSTEM,
      images: [input.original],
      text: routerUserText(input.roomType, input.metrics),
    },
    RouteDecisionSchema,
  );
}
