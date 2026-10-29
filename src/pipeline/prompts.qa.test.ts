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

  it.each([
    ["synthesizer", SYNTHESIZER_SYSTEM],
    ["refiner", REFINER_SYSTEM],
    ["qa", QA_SYSTEM],
  ])("%s allows natural colour enhancement but keeps the real colours", (_agent, prompt) => {
    expect(prompt).toContain("vibrance");
    expect(prompt).toContain("contrast");
    expect(prompt).toContain("real colours");
  });

  it.each([
    ["synthesizer", SYNTHESIZER_SYSTEM],
    ["qa", QA_SYSTEM],
  ])("%s warns against over-saturation", (_agent, prompt) => {
    expect(prompt).toMatch(/over-saturat/i);
  });

  it("router enhances dull or flat colour", () => {
    expect(ROUTER_SYSTEM).toMatch(/"enhance":[^\n]*dull, flat or washed-out colour/);
  });

  it.each([
    ["synthesizer", SYNTHESIZER_SYSTEM],
    ["refiner", REFINER_SYSTEM],
    ["qa", QA_SYSTEM],
  ])("%s faithfulness rule forbids a hue change and the over-processed look", (_agent, prompt) => {
    expect(prompt).toMatch(/never change hue or turn into a different colour/);
    for (const surface of ["walls", "floors", "furniture", "fabrics", "sky", "greenery"]) {
      expect(prompt).toContain(surface);
    }
    expect(prompt).toMatch(/must never look over-saturated, HDR or artificial/);
  });

  it("router only skips photos that already have natural, lively colour", () => {
    expect(ROUTER_SYSTEM).toMatch(/"skip":[^\n]*natural, lively colour/);
    expect(ROUTER_SYSTEM).toContain('Output shape: {"route": "skip" | "enhance" | "reject", "reason": string}');
  });

  it("synthesizer asks for natural colour pop and still keeps everything in place", () => {
    expect(SYNTHESIZER_SYSTEM).toMatch(/vibrance and contrast[^\n]*colours pop naturally/);
    expect(SYNTHESIZER_SYSTEM).toMatch(/real, natural photograph with no over-saturation/);
    expect(SYNTHESIZER_SYSTEM).toMatch(/keep every object, wall, window and view exactly as they are/);
    expect(SYNTHESIZER_SYSTEM).toMatch(/1-4 sentences/);
    expect(SYNTHESIZER_SYSTEM).toContain('Output shape: {"prompt": string}');
  });

  it("refiner tones colour down after an over-saturated or unrealistic failure", () => {
    expect(REFINER_SYSTEM).toMatch(/realism was low or the edit looked over-saturated or artificial, tone the colour boost down/);
    expect(REFINER_SYSTEM).toMatch(/colours stayed dull and realism was fine[^\n]*stronger but still natural/);
    expect(REFINER_SYSTEM).toMatch(/If the edit misrepresented the property, make the instruction more conservative/);
    expect(REFINER_SYSTEM).toContain('Output shape: {"prompt": string}');
  });

  it("qa realism penalises over-saturation and HDR, lighting judges natural improved colour, faithfulness counts colour changes", () => {
    const line = (key: string) => QA_SYSTEM.split("\n").find((l) => l.startsWith(`- ${key}:`)) ?? "";
    expect(line("realism")).toMatch(/over-saturation/);
    expect(line("realism")).toMatch(/neon or cartoonish colour/);
    expect(line("realism")).toMatch(/HDR or over-processed look/);
    expect(line("lighting")).toMatch(/colour are natural and improved over the original/);
    expect(line("lighting")).toMatch(/vivid yet natural/);
    expect(line("faithfulness")).toMatch(/changed its real colour/);
    const criteria = QA_SYSTEM.split("\n").filter((l) => /^- [a-z]+:/.test(l)).map((l) => l.slice(2, l.indexOf(":")));
    expect(criteria).toEqual([...config.qa.rubric]);
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
