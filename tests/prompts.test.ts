import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildEditorialPrompt as buildEditorial,
  LIGHT_RULE,
  DETAIL_RULE,
  BLEND_RULE,
  NEW_MODEL_RULE,
  RECENTER_SUFFIX,
} from "../shared/prompts";
import {
  DEFAULT_CONFIG,
  createsTasks,
  validateConfig,
  cardsPerSource,
  type Config,
} from "../shared/config";

const base: Config = {
  ...DEFAULT_CONFIG,
  mode: "1",
  input: "mannequin",
};

describe("prompts", () => {
  it("mode 1: lifestyle first, studio cards 2-5 tied to card 1, fabric last", () => {
    const p1 = buildPrompt(base, 1);
    expect(p1).toContain("Replace the mannequin");
    expect(p1).toContain("Source type: mannequin");
    expect(p1).toContain("lifestyle location image");
    expect(p1).toContain("Product fidelity: preserve colour, print, seams");
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
  it("cycles scenes per card so every image gets a fresh background", () => {
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
  it("backdrop-colour mode makes one card per colour and only recolours the background", () => {
    const c: Config = {
      ...base,
      mode: "6",
      input: "flatlay",
      colors: "pure white, #F2E8DA; light grey",
    };
    expect(cardsPerSource(c)).toBe(3);
    const p2 = buildPrompt(c, 2);
    expect(p2).toContain("change ONLY the background colour");
    expect(p2).toContain("solid #F2E8DA backdrop");
    expect(p2).not.toContain("exactly ONE model");
    expect(cardsPerSource({ ...c, colors: "" })).toBe(1);
  });
  it("creates six cards for mode 1 and the chosen count otherwise", () => {
    expect(cardsPerSource(base)).toBe(6);
    expect(cardsPerSource({ ...base, mode: "4", count: 3 })).toBe(3);
    expect(cardsPerSource({ ...base, mode: "2", count: 99 })).toBe(6);
  });
});

describe("centering", () => {
  it("applies everywhere except the framing-preserving approaches", async () => {
    const { centeringApplies, CENTERING } = await import("../shared/prompts");
    expect(centeringApplies({ ...base, mode: "1" }, 1)).toBe(true);
    expect(centeringApplies({ ...base, mode: "1" }, 6)).toBe(false);
    expect(centeringApplies({ ...base, mode: "5", input: "model" }, 1)).toBe(true);
    expect(centeringApplies({ ...base, mode: "8", input: "model" }, 1)).toBe(true);
    expect(centeringApplies({ ...base, mode: "7", input: "model" }, 1)).toBe(true);
    expect(centeringApplies({ ...base, mode: "4", input: "model" }, 1)).toBe(false);
    expect(centeringApplies({ ...base, mode: "6" }, 1)).toBe(false);
    expect(buildEditorial("Prompt body.", "blur")).toContain(CENTERING);
    expect(buildEditorial("Prompt body.", "blur", "", {}, false, false)).not.toContain(CENTERING);
    expect(centeringApplies({ ...base, mode: "2", input: "model", center: false }, 1)).toBe(false);
  });
});

describe("framing lock", () => {
  it("applies to the non-builder approaches too, but not to the packshot recolour or fabric card", async () => {
    const { buildPrompt: bp, HAIR_RULE } = await import("../shared/prompts");
    const base = { ...DEFAULT_CONFIG, input: "model" as const };
    for (const mode of ["2", "3", "4"] as const) {
      const p = bp({ ...base, mode }, 1);
      expect(p).toContain("FRAMING LOCK");
      expect(p).toContain(HAIR_RULE);
    }
    expect(bp({ ...base, mode: "6" }, 1)).not.toContain("FRAMING LOCK");
    expect(bp({ ...base, mode: "1" }, 6)).not.toContain("FRAMING LOCK");
  });
  it("tells the engine to keep the upload's crop and invent nothing outside it", () => {
    expect(buildEditorial("P.", "", "", {}, false, true, "UPPER_BODY")).toContain(
      "upper body only",
    );
    const lower = buildEditorial("P.", "", "", {}, false, true, "LOWER_BODY");
    expect(lower).toContain("lower body only");
    expect(lower).toContain("hands are visible inside the frame");
    expect(lower).toContain("no hand in a pocket");
    expect(lower).toContain(
      "AVOID: wind-blown hair, flying hair strands, messy hair, hands in pockets",
    );
    expect(buildEditorial("P.", "", "", {}, false, true, "FULL_BODY", true)).toContain(
      "may rest in a pocket",
    );
    expect(buildEditorial("P.", "", "", {}, false, true, "FULL_BODY")).toContain("no added shoes");
    expect(buildEditorial("P.", "")).toContain("FRAMING LOCK");
  });
});

describe("Zaid creative direction", () => {
  it("locks framing and outfit, asks for bright balanced light, and leaves hair to the direction", () => {
    const p = buildEditorial("P.", "blur", "", {}, false, true, "LOWER_BODY", false, true);
    expect(p).toContain("FRAMING LOCK: lower body only");
    expect(p).toContain(LIGHT_RULE);
    expect(p).toContain(DETAIL_RULE);
    expect(p).toContain(BLEND_RULE);
    expect(p).toContain("golden-hour sun");
    expect(p).not.toContain("HAIR:");
    expect(p).toContain("no hand in a pocket");
    expect(p).toContain(
      "AVOID: blur, dim scene, murky light, overcast sky, blown-out highlights, harsh shadows, empty background, smeared background, heavy background blur, low-detail background, cutout look, pasted-on model, floating feet, missing contact shadow, mismatched lighting, halo edges, hands in pockets",
    );
    expect(buildEditorial("P.", "blur", "", {}, false, true, "LOWER_BODY", true, true)).toContain(
      "may rest in a pocket",
    );
  });
});

describe("new-model skill campaign", () => {
  it("tells the engine to replace the person and keep only what is worn", () => {
    const p = buildEditorial("Prompt body.", "blur", "", {}, true);
    expect(p).toContain(NEW_MODEL_RULE);
    expect(p).toContain("Do not reproduce the person");
    expect(buildEditorial("Prompt body.", "blur")).not.toContain("NEW MODEL");
  });
});
