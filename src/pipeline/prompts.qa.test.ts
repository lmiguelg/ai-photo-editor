import { describe, expect, it } from "vitest";
import { config } from "./config";
import {
  QA_SYSTEM,
  qaUserText,
  REFINER_SYSTEM,
  refinerUserText,
  ROUTER_SYSTEM,
  routerUserText,
  SYNTHESIZER_SYSTEM,
  synthesizerUserText,
} from "./prompts";

const ALL = { router: ROUTER_SYSTEM, synthesizer: SYNTHESIZER_SYSTEM, refiner: REFINER_SYSTEM, qa: QA_SYSTEM };

describe("system prompts", () => {
  it.each(Object.entries(ALL))("%s asks for JSON only and states its output shape", (_agent, prompt) => {
    expect(prompt).toMatch(/JSON only/);
    expect(prompt).toMatch(/Output shape: \{/);
  });

  it("router states the three routes", () => {
    for (const route of ["skip", "enhance", "reject"]) expect(ROUTER_SYSTEM).toContain(`"${route}"`);
  });

  it.each([
    ["synthesizer", SYNTHESIZER_SYSTEM],
    ["refiner", REFINER_SYSTEM],
    ["qa", QA_SYSTEM],
  ])("%s states the faithfulness rule and the allowed changes", (_agent, prompt) => {
    expect(prompt).toMatch(/never add, remove, move or reshape/);
    for (const thing of ["furniture", "fixtures", "walls", "windows", "views"]) expect(prompt).toContain(thing);
    for (const allowed of ["lighting", "exposure", "white balance", "straightening", "declutter"]) {
      expect(prompt).toContain(allowed);
    }
    expect(prompt).toMatch(/only if the room stays truthful/);
  });

  it("qa scores exactly the four rubric items on 0-10 and fails misrepresentation", () => {
    for (const key of config.qa.rubric) expect(QA_SYSTEM).toContain(`"${key}": number`);
    expect(QA_SYSTEM).toMatch(/0 to 10/);
    expect(QA_SYSTEM).toMatch(/"pass" to false for any edit that misrepresents the property/);
  });
});

describe("user text builders", () => {
  it("include the inputs each agent needs", () => {
    const metrics = { width: 1600, height: 1000, sharpness: 4.567, brightness: 80.4 };
    expect(routerUserText("kitchen", metrics)).toContain("kitchen");
    expect(routerUserText("kitchen", metrics)).toContain("1600x1000");
    expect(synthesizerUserText("bedroom", "Too dark")).toContain("Too dark");
    const refined = refinerUserText("Old prompt", {
      pass: false,
      scores: { faithfulness: 3 },
      reason: "Added a lamp",
    });
    expect(refined).toContain("Old prompt");
    expect(refined).toContain("Added a lamp");
    expect(refined).toContain('"faithfulness":3');
    expect(qaUserText("exterior")).toContain("exterior");
  });
});
