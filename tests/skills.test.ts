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
  it("builds the smart-direction skill from the mood board and examples", async () => {
    const { zaidSkill, ZAID_SCENES, zaidMoodForScene, ZAID_EXAMPLES } = await import(
      "../shared/zaid"
    );
    const { libraryScenes, planRun } = await import("../server/editorial");
    const s = zaidSkill("Prefer Munich.");
    expect(s.instructions).toContain("Zaid creative direction Prompt Builder");
    expect(s.instructions).toContain("ADDITIONAL DIRECTION FROM THE TEAM");
    expect(s.instructions).toContain("Prefer Munich.");
    expect(s.instructions).toContain(ZAID_EXAMPLES[2].prompt.slice(0, 60));
    expect(libraryScenes(s.library)).toHaveLength(ZAID_SCENES.length);
    expect(zaidMoodForScene(ZAID_SCENES[4].scene)).toBe("stone-wall");
    const plan = planRun({ ...req, skill: "zaid", random: () => 0.99 });
    expect(plan.scene).toBe(ZAID_SCENES[ZAID_SCENES.length - 1].scene);
    expect(plan.mood).toBe("german-street");
    const text = builderInstruction({ ...req, skill: "zaid", scene: plan.scene });
    expect(text).toContain('Mood-board image attached (image 2): "German sidewalk"');
    expect(text).toContain("Scene assigned to this run");
  });
});
