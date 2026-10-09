import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIRECTION_RULES,
  composeFixedRules,
  parseDirectionRules,
  ruleOn,
} from "../shared/direction-rules";
import { buildEditorialPrompt, LIGHT_RULE, DETAIL_RULE, BLEND_RULE } from "../shared/prompts";

describe("creative direction fixed rules", () => {
  it("numbers the enabled rules in the team's order", () => {
    const text = composeFixedRules(DEFAULT_DIRECTION_RULES);
    expect(text.startsWith("Fixed rules for every prompt")).toBe(true);
    expect(text).toContain("(1) OUTFIT:");
    expect(text).toContain("(13) COMPOSITION:");
    expect(text).toContain("Catalogue-safe wording only");
    const fewer = composeFixedRules([
      { key: "a", title: "", text: "Rule A.", enabled: true },
      { key: "b", title: "", text: "Rule B;", enabled: false },
      { key: "c", title: "", text: "Rule C", enabled: true },
    ]);
    expect(fewer).toBe(
      "Fixed rules for every prompt (they override the skill's own direction, template and library, including any default framing such as full body): (1) Rule A; (2) Rule C.",
    );
    expect(composeFixedRules([])).toBe("");
  });

  it("reads a stored list and falls back to the defaults", () => {
    expect(parseDirectionRules(null)).toBe(DEFAULT_DIRECTION_RULES);
    expect(parseDirectionRules("nonsense")).toBe(DEFAULT_DIRECTION_RULES);
    const list = parseDirectionRules(
      JSON.stringify([{ key: "light", text: "Sun.", enabled: false }, { text: "Mine." }]),
    );
    expect(list).toEqual([
      { key: "light", title: "", text: "Sun.", enabled: false },
      { key: "custom-2", title: "", text: "Mine.", enabled: true },
    ]);
    expect(ruleOn(list, "light")).toBe(false);
    expect(ruleOn(list, "detail")).toBe(false);
    expect(ruleOn(undefined, "detail")).toBe(true);
  });

  it("switches the engine-side rules with the list", () => {
    const full = buildEditorialPrompt("Body.", "", "", {}, false, true, "FULL_BODY", false, true);
    expect(full).toContain(LIGHT_RULE);
    expect(full).toContain(DETAIL_RULE);
    expect(full).toContain(BLEND_RULE);
    expect(full).toContain("hands in pockets");
    const off = buildEditorialPrompt(
      "Body.",
      "",
      "",
      {},
      false,
      true,
      "FULL_BODY",
      false,
      true,
      false,
      {
        light: false,
        detail: false,
        hands: false,
        tattoos: false,
      },
    );
    expect(off).not.toContain(LIGHT_RULE);
    expect(off).not.toContain(DETAIL_RULE);
    expect(off).toContain(BLEND_RULE);
    expect(off).not.toContain("overcast sky");
    expect(off).not.toContain("hands in pockets");
    expect(off).not.toContain("TATTOOS:");
    // The skill campaign ignores the flags entirely.
    const campaign = buildEditorialPrompt(
      "Body.",
      "",
      "",
      {},
      false,
      true,
      "FULL_BODY",
      false,
      false,
      false,
      {
        tattoos: false,
      },
    );
    expect(campaign).toContain("TATTOOS:");
  });
});
