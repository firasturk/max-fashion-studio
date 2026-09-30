import { describe, expect, it } from "vitest";
import { buildPrompt, RECENTER_SUFFIX } from "../shared/prompts";
import {
  DEFAULT_CONFIG,
  createsTasks,
  validateConfig,
  CARDS_PER_SOURCE,
  type Config,
} from "../shared/config";

const base: Config = { ...DEFAULT_CONFIG, mode: "1", input: "mannequin" };

describe("prompts", () => {
  it("includes the mode instruction, category, fidelity and centering", () => {
    const p = buildPrompt(base, 1);
    expect(p).toContain("Replace the mannequin or flat lay");
    expect(p).toContain("Category: Denim");
    expect(p).toContain("Product fidelity");
    expect(p).toContain("exactly ONE model");
  });
  it("skips centering for the fabric card and for batches without centering", () => {
    expect(buildPrompt(base, 6)).not.toContain("exactly ONE model");
    expect(buildPrompt(base, 6)).toContain("Fabric macro close-up");
    expect(buildPrompt({ ...base, center: false }, 1)).not.toContain("exactly ONE model");
  });
  it("describes attached images by role", () => {
    expect(buildPrompt(base, 2, "", { firstCard: true })).toContain(
      "Image 2 establishes model identity",
    );
    expect(buildPrompt({ ...base, mode: "3" }, 1, "", { identity: true })).toContain(
      "Image 2 is the real model identity reference",
    );
    const revision = buildPrompt(base, 1, "brighter background", { revision: true });
    expect(revision).toContain("Revision of the existing result: brighter background");
    expect(revision).toContain("The LAST image is the existing result to revise");
  });
  it("adds no image roles for a plain first generation", () => {
    expect(buildPrompt({ ...base, mode: "4" }, 1)).not.toContain("Image 1 is");
  });
  it("has a recenter suffix", () => {
    expect(RECENTER_SUFFIX).toMatch(/x=50%/);
  });
});

describe("config rules", () => {
  it("enforces mode 4 model input and mode 3 identity", () => {
    expect(validateConfig({ ...base, mode: "4", input: "mannequin" })).toMatch(/real model photo/);
    expect(validateConfig({ ...base, mode: "3" })).toMatch(/identity/);
    expect(validateConfig({ ...base, mode: "3", identity: "abc" })).toBeNull();
  });
  it("supporting photos never create tasks in modes 2 and 3", () => {
    expect(createsTasks({ ...base, mode: "2" }, "supporting")).toBe(false);
    expect(createsTasks({ ...base, mode: "3" }, "supporting")).toBe(false);
    expect(createsTasks({ ...base, mode: "1" }, "supporting")).toBe(true);
    expect(createsTasks({ ...base, mode: "2" }, "lead")).toBe(true);
  });
  it("creates six cards only for mode 1", () => {
    expect(CARDS_PER_SOURCE["1"]).toBe(6);
    expect(CARDS_PER_SOURCE["4"]).toBe(1);
  });
});
