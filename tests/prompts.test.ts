import { describe, expect, it } from "vitest";
import { buildPrompt, RECENTER_SUFFIX } from "../shared/prompts";
import {
  DEFAULT_CONFIG,
  createsTasks,
  validateConfig,
  cardsPerSource,
  CATEGORIES,
  type Config,
} from "../shared/config";

const base: Config = {
  ...DEFAULT_CONFIG,
  mode: "1",
  input: "mannequin",
  category: "Jeans & Jeggings",
};

describe("prompts", () => {
  it("mode 1: lifestyle first, studio cards 2-5 tied to card 1, fabric last", () => {
    const p1 = buildPrompt(base, 1);
    expect(p1).toContain("Replace the mannequin");
    expect(p1).toContain("Category: Jeans & Jeggings");
    expect(p1).toContain("lifestyle location image");
    expect(p1).toContain("denim wash, fading");
    expect(p1).toContain("exactly ONE model");
    const p3 = buildPrompt(base, 3, "", { firstCard: true, studio: true });
    expect(p3).toContain("warm beige seamless paper backdrop");
    expect(p3).toContain("identical lighting as card 2");
    expect(p3).toContain("same model face, hair, body");
    expect(p3).toContain("Image 2 is card 1");
    expect(p3).toContain("Image 3 is card 2");
    expect(buildPrompt(base, 4)).toContain("SEATED");
    expect(buildPrompt({ ...base, backdrop: "light grey backdrop" }, 2)).toContain(
      "light grey backdrop",
    );
    const p6 = buildPrompt(base, 6);
    expect(p6).toContain("FABRIC ONLY");
    expect(p6).toContain("NO person, mannequin");
    expect(p6).not.toContain("Model direction");
    expect(p6).not.toContain("exactly ONE model");
  });
  it("mode 2 changes the face, mode 3 changes the pose, mode 4 only the background", () => {
    expect(buildPrompt({ ...base, mode: "2", input: "model" }, 1)).toContain(
      "DIFFERENT photorealistic adult model face",
    );
    expect(buildPrompt({ ...base, mode: "3", input: "model" }, 2)).toContain(
      "New pose: Three-quarter view",
    );
    const p4 = buildPrompt({ ...base, mode: "4", input: "model", count: 3 }, 2);
    expect(p4).toContain("Replace ONLY the background");
    expect(p4).toContain("New background for this image: Modern glass-and-concrete");
    expect(p4).not.toContain("exactly ONE model");
  });
  it("cycles category scenes per card so every image gets a fresh background", () => {
    const c: Config = { ...base, mode: "4", input: "model", count: 3 };
    expect(buildPrompt(c, 1)).not.toEqual(buildPrompt(c, 2));
    expect(buildPrompt(c, 1)).toEqual(buildPrompt(c, 7)); // six scenes, then it wraps
  });
  it("describes revisions and keeps a recenter suffix", () => {
    const revision = buildPrompt(base, 1, "brighter background", { revision: true });
    expect(revision).toContain("Revision of the existing result: brighter background");
    expect(revision).toContain("The LAST image is the existing result to revise");
    expect(RECENTER_SUFFIX).toMatch(/x=50%/);
  });
  it("builds a prompt for every category", () => {
    for (const category of CATEGORIES)
      expect(buildPrompt({ ...base, category }, 1)).toContain(category);
  });
});

describe("config rules", () => {
  it("modes 2-4 require a real model photo", () => {
    expect(validateConfig({ ...base, mode: "4", input: "mannequin" })).toMatch(/real model photo/);
    expect(validateConfig({ ...base, mode: "3", input: "flatlay" })).toMatch(/real model photo/);
    expect(validateConfig({ ...base, mode: "2", input: "model" })).toBeNull();
    expect(validateConfig(base)).toBeNull();
  });
  it("supporting photos never create tasks", () => {
    expect(createsTasks({ ...base, mode: "2" }, "supporting")).toBe(false);
    expect(createsTasks({ ...base, mode: "1" }, "supporting")).toBe(false);
    expect(createsTasks({ ...base, mode: "2" }, "lead")).toBe(true);
  });
  it("creates six cards for mode 1 and the chosen count otherwise", () => {
    expect(cardsPerSource(base)).toBe(6);
    expect(cardsPerSource({ ...base, mode: "4", count: 3 })).toBe(3);
    expect(cardsPerSource({ ...base, mode: "2", count: 99 })).toBe(6);
  });
});
