import { describe, expect, it } from "vitest";
import { DEFAULT_SKILL, SKILLS, skillById } from "../shared/skills";
import { builderInstruction, wordCount } from "../server/editorial";

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
    const merged = zaidSkill("", skillById("kids"));
    expect(merged.id).toBe("kids");
    expect(merged.instructions).toContain("Creative direction Prompt Builder");
    expect(merged.instructions).toContain("Example 1");
    expect(merged.instructions).not.toContain("The creative-direction world, distilled");
    expect(merged.library).toBe(skillById("kids").library);
    expect(merged.template).toBe(s.template);
    expect(s.instructions).toContain("Creative direction Prompt Builder");
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
    // Everything used: the photo whose last use is the oldest comes back first.
    expect(
      planRun({
        ...req,
        skill: "zaid",
        references: ["a", "b", "c"],
        usedReferences: ["c", "a", "b", "a"],
        random: () => 0.5,
      }).mood,
    ).toBe("b");
    const text = builderInstruction({ ...req, skill: "zaid", scene: plan.scene, reference: "b" });
    expect(text).toContain("REFERENCE FIRST");
    expect(text).toContain("Framing lock");
    expect(text).toContain("LIGHT: real sun");
    expect(text).toContain("BACKGROUND DETAIL");
    expect(text).toContain("INTEGRATION");
    expect(text).toContain("CAMERA ANGLE");
    expect(text).toContain("IDENTITY: when the model is kept");
    expect(text).toContain("TATTOOS: any tattoo");
    expect(text).toContain("Catalogue-safe wording only");
    const custom = builderInstruction({
      ...req,
      skill: "zaid",
      rules: [{ key: "custom-1", title: "", text: "Always a red wall.", enabled: true }],
    });
    expect(custom).toContain("(1) Always a red wall.");
    expect(custom).not.toContain("LIGHT: real sun");
    expect(text).toContain("golden-hour sun");
    expect(text).toContain("800-1000 words");
    expect(text).not.toContain("600-1100 words");
    expect(s.template).toContain("800-1,000 words");
    expect(
      builderInstruction({ ...req, skill: "zaid", expand: "YOUR PREVIOUS DRAFT WAS REJECTED" }),
    ).toContain("YOUR PREVIOUS DRAFT WAS REJECTED");
    expect(wordCount("one two  three\nfour")).toBe(4);
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
    const { sanitizePrompt, sanitizeChildPrompt, isChildSubject, isContentPolicyError } =
      await import("../shared/safety");
    expect(isChildSubject("child model, boy, about 6 years old")).toBe(true);
    expect(isChildSubject("adult woman", "kids")).toBe(true);
    expect(isChildSubject("adult woman")).toBe(false);
    expect(
      sanitizeChildPrompt(
        "The upper-body child model stands by the wall. The skin is photorealistic with fine texture. Arms show soft muscle definition of a young child. The t-shirt has a Sonic print.",
      ),
    ).toBe("The upper-body child model stands by the wall. The t-shirt has a Sonic print.");
    expect(isContentPolicyError('{"type":"content_policy_violation"}')).toBe(true);
    expect(isContentPolicyError("fal.ai timed out (504)")).toBe(false);
    expect(
      sanitizePrompt("A sexy pose with parted lips and bare shoulders in a skin-tight dress"),
    ).toBe("A elegant pose with a calm expression and the shoulders in a fitted dress");
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

describe("team-managed skills", () => {
  it("derives a custom skill with the shared rules and keeps its editable goal", async () => {
    const { deriveSkill } = await import("../shared/skills");
    const s = deriveSkill({
      id: "ramadan-evening",
      title: "Ramadan evening",
      caption: "Lanterns",
      description: "d",
      goal: "Goal: festive courtyards at dusk.",
      library: "# Library\n\n## Scene families\n1. Courtyard with lanterns.\n2. Majlis.",
    });
    expect(s.goal).toBe("Goal: festive courtyards at dusk.");
    expect(s.instructions).toContain("# Ramadan evening Prompt Builder");
    expect(s.instructions).toContain("SAFE WORDING");
    const { libraryScenes } = await import("../server/editorial");
    expect(libraryScenes(s.library)).toEqual(["Courtyard with lanterns.", "Majlis."]);
    const text = builderInstruction({ ...req, skill: "ramadan-evening", skillDef: s });
    expect(text).toContain("# Ramadan evening Prompt Builder");
  });
});

describe("references lead", () => {
  it("with reference photos the photo is primary and no library scene is assigned", async () => {
    const { planRun } = await import("../server/editorial");
    const plan = planRun({ ...req, skill: "kids", references: ["r1", "r2"], random: () => 0 });
    expect(plan.scene).toBeNull();
    expect(plan.mood).toBe("r1");
    const text = builderInstruction({ ...req, skill: "kids", scene: null, reference: "r1" });
    expect(text).toContain("REFERENCE FIRST");
    expect(text).not.toContain("Scene assigned to this run");
    const noRefs = planRun({ ...req, skill: "kids", references: [], random: () => 0 });
    expect(noRefs.scene).toBeTruthy();
  });
  it("the skill-builder instruction extracts setting, pose and light only", async () => {
    const { skillBuilderInstruction } = await import("../server/skillbuilder");
    const t = skillBuilderInstruction("Kids lifestyle", 5);
    expect(t).toContain("5 attached reference photographs");
    expect(t).toContain("never mention clothing");
    expect(t).toContain("## Scene families");
  });
});
