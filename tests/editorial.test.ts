import { describe, expect, it, vi } from "vitest";
import {
  buildBriefWithGoogle,
  buildBriefWithOpenAI,
  builderInstruction,
} from "../server/editorial";
import { buildEditorialPrompt } from "../shared/prompts";

const req = {
  image: { bytes: new ArrayBuffer(4), mime: "image/jpeg" },
  run: 2,
  market: "arab",
  preference: "Dubai, golden hour",
  aspectRatio: "2:3",
  used: [{ scene: "Haussmann corner", pose: "mid-stride walk" }],
};

const longPrompt = "Use the attached image as the single source of truth for the outfit. ".repeat(
  8,
);
const brief = {
  subject: "adult woman",
  faceMode: "NO_FACE",
  garments: "white lace shift dress with black bow belt",
  scene: "Dubai courtyard",
  pose: "leaning on column",
  light: "golden hour",
  prompt: longPrompt,
  negative: "extra buttons, plain studio background",
};

describe("editorial prompt builder", () => {
  it("hands the skill, template, library and run context to the model", () => {
    const text = builderInstruction(req);
    expect(text).toContain("Fashion Editorial Prompt Builder");
    expect(text).toContain("OUTFIT — CRITICAL");
    expect(text).toContain("Scenes (pick one family");
    expect(text).toContain("Run number: 2");
    expect(text).toContain('scene "Haussmann corner"');
    expect(text).toContain("Arab / Middle-Eastern");
    expect(text).toContain("Dubai, golden hour");
  });

  it("parses the Google interaction output", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-2.5-flash");
      expect(body.input[1].type).toBe("image");
      expect(body.response_format.mime_type).toBe("application/json");
      return new Response(
        JSON.stringify({
          steps: [
            { type: "model_output", content: [{ type: "text", text: JSON.stringify(brief) }] },
          ],
        }),
        { status: 200 },
      );
    });
    const out = await buildBriefWithGoogle(
      "AIzaTestKey",
      req,
      fetchMock as unknown as typeof fetch,
    );
    expect(out.scene).toBe("Dubai courtyard");
    expect(out.prompt.length).toBeGreaterThan(200);
  });

  it("parses the OpenAI chat output, including fenced JSON", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "```json\n" + JSON.stringify(brief) + "\n```" } }],
          }),
          {
            status: 200,
          },
        ),
    );
    const out = await buildBriefWithOpenAI("sk-test", req, fetchMock as unknown as typeof fetch);
    expect(out.pose).toBe("leaning on column");
  });

  it("rejects an empty prompt", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ output_text: JSON.stringify({ ...brief, prompt: "short" }) }),
          { status: 200 },
        ),
    );
    await expect(
      buildBriefWithGoogle("AIzaTestKey", req, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/empty prompt/);
  });

  it("assembles the final editorial prompt with revision and negative block", () => {
    const p = buildEditorialPrompt(brief.prompt, brief.negative, "brighter sky", {
      revision: true,
    });
    expect(p.startsWith("Use the attached image")).toBe(true);
    expect(p).toContain("Revision of the existing result: brighter sky");
    expect(p).toContain("The LAST image is the existing result to revise");
    expect(p.trim().endsWith("AVOID: extra buttons, plain studio background")).toBe(true);
  });
});
