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
  it("builds the smart-direction skill from the examples and picks a library reference", async () => {
    const { zaidSkill, ZAID_SCENES, ZAID_EXAMPLES } = await import("../shared/zaid");
    const { libraryScenes, planRun } = await import("../server/editorial");
    const s = zaidSkill("Prefer Munich.");
    expect(s.instructions).toContain("Zaid creative direction Prompt Builder");
    expect(s.instructions).toContain("ADDITIONAL DIRECTION FROM THE TEAM");
    expect(s.instructions).toContain(ZAID_EXAMPLES[2].prompt.slice(0, 60));
    expect(libraryScenes(s.library)).toHaveLength(ZAID_SCENES.length);
    const plan = planRun({
      ...req,
      skill: "zaid",
      references: ["a", "b", "c"],
      usedReferences: ["a", "c"],
      random: () => 0.99,
    });
    expect(plan.mood).toBe("b");
    const text = builderInstruction({ ...req, skill: "zaid", scene: plan.scene, reference: "b" });
    expect(text).toContain("Reference image attached (image 2)");
    expect(text).toContain("Framing lock");
  });
});

describe("safe wording and framing", () => {
  it("every skill carries the framing lock and the safe-wording rule", () => {
    for (const s of SKILLS.filter((x) => x.id !== "editorial")) {
      expect(s.instructions).toContain("FULL_BODY");
      expect(s.instructions).toContain("SAFE WORDING");
      expect(s.instructions).toContain("Reference image (when image 2 is attached)");
    }
  });
  it("sanitises risky words before a prompt leaves the server", async () => {
    const { sanitizePrompt } = await import("../shared/safety");
    expect(sanitizePrompt("A sexy pose with parted lips and bare shoulders in a skin-tight dress")).toBe(
      "A elegant pose with a calm expression and the shoulders in a fitted dress",
    );
    expect(sanitizePrompt("Child model, age 6, happy, natural child proportions")).toBe(
      "Child model, age 6, happy, natural child proportions",
    );
  });
  it("the kids skill is built from the reference world and bans copied accessories", () => {
    const kids = SKILLS.find((s) => s.id === "kids")!;
    expect(kids.library).toContain("cactus");
    expect(kids.library).toContain("iron handrail");
    expect(kids.library).toMatch(/Hats, caps, bags, sunglasses or props copied/);
  });
});
