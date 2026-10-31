import { describe, expect, it } from "vitest";
import { digestEvents, learnInstruction, parseLearn } from "../server/memory";
import type { EventRow } from "../server/events";

const ev = (kind: string, data: Record<string, unknown>, skill = "evening"): EventRow => ({
  id: crypto.randomUUID(),
  at: Date.now(),
  user: "u1",
  actor: kind.startsWith("engine") ? "engine" : "user",
  kind,
  batch: "b1",
  task: null,
  source: null,
  skill,
  mode: "7",
  data: JSON.stringify(data),
});

describe("brand memory", () => {
  it("digests events per skill with the words the team used", () => {
    const d = digestEvents([
      ev("revise", { edit: "Blend with scene and remove the halo on the hair" }),
      ev("revise", { edit: "Blend with scene and remove the halo on the hair" }),
      ev("preset", { label: "Fix hands" }),
      ev("engine.failed", {
        error: "Google Cloud (Vertex) refused the generated image (IMAGE_SAFETY)",
      }),
      ev("click", { label: "Retry this image" }),
      ev("rule", { summary: 'switched off "grain"' }),
    ]);
    expect(d).toContain("## evening (approach 7)");
    expect(d).toContain("2× Blend with scene and remove the halo on the hair");
    expect(d).toContain("Fix hands");
    expect(d).toContain("IMAGE_SAFETY");
    expect(d).toContain('switched off "grain"');
    expect(learnInstruction(d, ["evening", "kids"])).toContain("skill:<id>");
  });
  it("parses the learner's answer and drops malformed items", () => {
    const items = parseLearn(
      '```json\n{"insights":[{"scope":"skill:evening","kind":"avoid","title":"No halo","text":"Never add a glow on the hair.","evidence":4,"examples":["remove the halo"]},{"scope":"nonsense","kind":"weird","title":"x","text":"Keep it plain.","evidence":"2","examples":"no"},{"title":"empty"}]}\n```',
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ scope: "skill:evening", kind: "avoid", evidence: 4 });
    expect(items[1]).toMatchObject({ scope: "global", kind: "insight", evidence: 2, examples: [] });
    expect(parseLearn("not json")).toEqual([]);
  });
});
