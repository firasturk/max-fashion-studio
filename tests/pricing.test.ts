import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd, referencesFor } from "../shared/pricing";
import { DEFAULT_CONFIG, type Config } from "../shared/config";

const base: Config = { ...DEFAULT_CONFIG, mode: "4", input: "model", count: 3, size: "2K" };

describe("cost estimates", () => {
  it("prices Google per image, halved in economy mode", () => {
    const g = estimateCost({ ...base, model: "gemini-3-pro-image" }, 10);
    expect(g.total).toBeCloseTo(1.34, 2);
    const e = estimateCost({ ...base, model: "gemini-3-pro-image", economy: true }, 10);
    expect(e.total).toBeCloseTo(0.67, 2);
  });
  it("adds reference images for OpenAI and more references for studio cards", () => {
    const one = estimateCost({ ...base, model: "gpt-image-2.5-flare" }, 1);
    expect(one.total).toBeCloseTo(0.0527 + 0.008, 4);
    expect(referencesFor({ ...base, mode: "1" }, 3)).toBe(3);
    expect(referencesFor({ ...base, mode: "1" }, 6)).toBe(1);
  });
  it("adds the prompt-builder cost in editorial mode and reports unknown models", () => {
    const ed = estimateCost({ ...base, mode: "5", model: "gemini-3-pro-image" }, 2);
    expect(ed.total).toBeCloseTo(2 * (0.134 + 0.01), 3);
    expect(estimateCost({ ...base, model: "mystery-model" }, 5).known).toBe(false);
  });
  it("formats dollars sensibly", () => {
    expect(formatUsd(0.134)).toBe("$0.13");
    expect(formatUsd(12.34)).toBe("$12.3");
    expect(formatUsd(290.4)).toBe("$290");
  });
});
