import { describe, expect, it, vi } from "vitest";
import {
  framingDirective,
  parseFramingCheck,
  parseSceneNotes,
  parsePoseNotes,
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
      expect(body.model).toBe("gemini-3.8-flash");
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

  it("falls through to the next Google model when one is retired (404)", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.model);
      if (body.model === "gemini-3.8-flash")
        return new Response(JSON.stringify({ error: { message: "no longer available" } }), {
          status: 404,
        });
      return new Response(JSON.stringify({ output_text: JSON.stringify(brief) }), { status: 200 });
    });
    const out = await buildBriefWithGoogle(
      "AIzaTestKey",
      req,
      fetchMock as unknown as typeof fetch,
    );
    expect(seen).toEqual(["gemini-3.8-flash", "gemini-3.5-flash"]);
    expect(out.scene).toBe("Dubai courtyard");
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
    expect(p).toContain("AVOID: extra buttons, plain studio background, wind-blown hair");
  });
});

describe("scene rotation", () => {
  it("assigns a library scene that avoids used and recent ones", async () => {
    const { libraryScenes, pickScene } = await import("../server/editorial");
    const { skillById } = await import("../shared/skills");
    const scenes = libraryScenes(skillById("editorial").library);
    expect(scenes.length).toBeGreaterThan(20);
    expect(scenes[0]).toMatch(/Haussmann/);
    const picked = pickScene(
      { ...req, used: [{ scene: scenes[0], pose: "x" }], recent: [scenes[1]], random: () => 0 },
      scenes,
    );
    expect(picked).toBe(scenes[2]);
    const text = builderInstruction({ ...req, recent: ["Dubai courtyard"], random: () => 0.5 });
    expect(text).toContain("Scene assigned to this run");
    expect(text).toContain('recent batches (avoid these families too): "Dubai courtyard"');
  });
  it("derived skills expose their scene families too", async () => {
    const { libraryScenes } = await import("../server/editorial");
    const { skillById } = await import("../shared/skills");
    expect(libraryScenes(skillById("resort").library)).toHaveLength(8);
    expect(libraryScenes(skillById("ecommerce-studio").library)).toHaveLength(6); // its backdrops rotate instead
  });
});

describe("product sets", () => {
  it("tells the builder to reuse the sibling's scene and light", () => {
    const text = builderInstruction({
      ...req,
      skill: "kids",
      scene: "Overcast meadow with a timber fence.",
      reference: "r1",
      set: {
        scene: "Overcast meadow with a timber fence.",
        light: "soft overcast",
        pose: "sitting on the fence",
        hasImage: true,
      },
    });
    expect(text).toContain("SAME PRODUCT SET");
    expect(text).toContain('Scene to reuse: "Overcast meadow with a timber fence."');
    expect(text).toContain("generated sibling is attached as the last image");
    expect(text).not.toContain("Scene assigned to this run");
  });
});

describe("verified framing", () => {
  it("parses the check and treats unknown answers as full body", () => {
    expect(
      parseFramingCheck(
        '{"framing":"LOWER_BODY","faceVisible":false,"garments":"black trousers, sneakers"}',
      ),
    ).toEqual({
      framing: "LOWER_BODY",
      faceVisible: false,
      handsInPockets: false,
      backView: false,
      garments: "black trousers, sneakers",
    });
    const tq = parseFramingCheck(
      '{"framing":"UPPER_BODY","headVisible":true,"kneesVisible":true,"feetVisible":false,"backView":true,"faceVisible":false,"handsInPockets":false,"garments":"knit dress"}',
    );
    expect(tq.framing).toBe("THREE_QUARTER");
    expect(tq.backView).toBe(true);
    expect(framingDirective("THREE_QUARTER", "knit dress", false, true)).toContain("BACK VIEW");
    expect(framingDirective("THREE_QUARTER", "knit dress")).toContain("THREE-QUARTER image");
    expect(parseFramingCheck("nonsense").framing).toBe("FULL_BODY");
    // What is inside the picture overrides the label: no head but feet is lower body.
    expect(
      parseFramingCheck(
        '{"framing":"UPPER_BODY","headVisible":false,"feetVisible":true,"faceVisible":false,"handsInPockets":true,"garments":"black top, blue jeans, sneakers"}',
      ).framing,
    ).toBe("LOWER_BODY");
    expect(
      parseFramingCheck(
        '{"framing":"FULL_BODY","headVisible":true,"feetVisible":false,"faceVisible":true,"handsInPockets":false,"garments":"denim top"}',
      ).framing,
    ).toBe("UPPER_BODY");
    expect(
      parseFramingCheck(
        '{"framing":"FULL_BODY","faceVisible":true,"handsInPockets":true,"garments":"coat"}',
      ).handsInPockets,
    ).toBe(true);
  });
  it("turns a lower-body crop into a binding instruction that excludes the face and top", () => {
    const d = framingDirective("LOWER_BODY", "black trousers, sneakers");
    expect(d).toContain("LOWER-BODY image");
    expect(d).toContain("overrides the skill");
    expect(d).toContain("black trousers, sneakers");
    expect(d).toContain("HANDS IN FRAME");
    expect(d).toContain("no hand in a pocket");
    expect(framingDirective("FULL_BODY", "coat", true)).toContain("pocket");
  });
});

describe("no prompt reference reads", () => {
  it("turns the background read into sentences for the engine", () => {
    const notes = parseSceneNotes(
      JSON.stringify({
        location: "narrow old-town street",
        timeOfDay: "golden hour",
        lightSource: "direct sun",
        lightDirection: "back-left",
        lightHeight: "low",
        hardness: "hard with crisp shadow edges",
        colourTemperature: "warm golden",
        shadowDirection: "toward the camera and to the right",
        shadowLength: "long",
        groundSurface: "cobblestone",
        standingSpot: "in the middle of the lane in front of the blue door",
        cameraHeight: "eye level",
        lens: "normal",
        depth: "cobbles in front, facades mid, archway behind",
      }),
    );
    expect(notes).toContain("Location: narrow old-town street");
    expect(notes).toContain("coming from the back-left of the camera");
    expect(notes).toContain("Shadows on the ground fall toward the camera and to the right; and are long");
    expect(notes).toContain("The model stands in the middle of the lane in front of the blue door");
    expect(notes).toContain("Camera: eye level; normal lens");
    expect(notes.endsWith(".")).toBe(true);
  });

  it("turns the pose read into sentences and gives nothing for an unreadable answer", () => {
    const notes = parsePoseNotes(
      "```json\n" +
        JSON.stringify({
          stance: "walking, one foot forward",
          weight: "on the back leg",
          torso: "turned three-quarter left, upright",
          arms: "swinging naturally",
          hands: "relaxed, open",
          head: "turned slightly left",
          gaze: "into the camera lens",
          expression: "soft smile",
        }) +
        "\n```",
    );
    expect(notes).toBe(
      "Stance: walking, one foot forward; weight: on the back leg; torso: turned three-quarter left, upright; arms: swinging naturally; hands: relaxed, open; head: turned slightly left; gaze: into the camera lens; expression: soft smile.",
    );
    expect(parsePoseNotes("not json")).toBe("");
    expect(parseSceneNotes("{}")).toBe("");
  });
});
