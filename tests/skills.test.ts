import { describe, expect, it } from "vitest";
import { DEFAULT_SKILL, SKILLS, skillById } from "../shared/skills";
import { builderInstruction } from "../server/editorial";

const req = {
  image: { bytes: new ArrayBuffer(4), mime: "image/jpeg" },
  run: 1,
  market: "auto",
  preference: "",
  aspectRatio: "1:1",
  used: [],
};

describe("ready-made skills", () => {
  it("every skill is complete and unique", () => {
    const ids = new Set(SKILLS.map((s) => s.id));
    expect(ids.size).toBe(SKILLS.length);
    for (const s of SKILLS) {
      expect(s.title.length).toBeGreaterThan(2);
      expect(s.caption.length).toBeGreaterThan(2);
      expect(s.description.length).toBeGreaterThan(20);
      expect(s.instructions).toContain("Step 1");
      expect(s.instructions).toContain("OUTFIT");
      expect(s.library).toMatch(/pose/i);
      expect(s.template).toContain("OUTFIT — CRITICAL");
    }
  });
  it("falls back to the editorial skill for unknown ids", () => {
    expect(skillById("nope").id).toBe(DEFAULT_SKILL);
    expect(skillById(undefined).id).toBe("editorial");
    expect(skillById("ramadan-eid").title).toBe("Ramadan & Eid");
  });
  it("hands the chosen skill's text to the prompt builder", () => {
    const text = builderInstruction({ ...req, skill: "resort" });
    expect(text).toContain("Resort & summer Prompt Builder");
    expect(text).toContain("Marina promenade");
    expect(text).not.toContain("Scenes (pick one family");
    expect(builderInstruction(req)).toContain("Fashion Editorial Prompt Builder");
  });
});

describe("zaid creative direction", () => {
  it("builds a skill from free text and exposes numbered scenes for rotation", async () => {
    const { zaidSkill, ZAID_DEFAULT_DIRECTION } = await import("../shared/skills");
    const { libraryScenes } = await import("../server/editorial");
    const s = zaidSkill("Mood: warm.\n1. Souk alley at dusk.\n2) Marina at noon.");
    expect(s.instructions).toContain("Souk alley at dusk");
    expect(s.instructions).toContain("Step 1");
    expect(libraryScenes(s.library)).toEqual(["Souk alley at dusk.", "Marina at noon."]);
    expect(zaidSkill("").instructions).toContain(ZAID_DEFAULT_DIRECTION.slice(0, 40));
    const text = builderInstruction({ ...req, skill: "zaid", direction: "Only rooftops.\n1. Rooftop A." });
    expect(text).toContain("Zaid creative direction Prompt Builder");
    expect(text).toContain("Only rooftops");
    expect(text).toContain("Scene assigned to this run");
  });
});
