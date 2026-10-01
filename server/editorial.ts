/**
 * Runs the Fashion Editorial Prompt Builder skill with a vision model: the uploaded photo goes in,
 * a structured brief (analysis, long prompt, negative prompt) comes out. The skill is one of the
 * ready-made entries in shared/skills.ts. Google Gemini is
 * used when a Google key exists, otherwise OpenAI. The skill text itself lives in shared/editorial-skill.ts.
 */
import { skillById } from "@shared/skills";
import { zaidMoodById, zaidMoodForScene, zaidSkill } from "@shared/zaid";
import { StudioError } from "./errors";
import type { ImageBytes } from "./openai";

export interface EditorialBrief {
  subject: string;
  faceMode: "FACE_VISIBLE" | "FACE_PARTIAL" | "NO_FACE";
  garments: string;
  scene: string;
  pose: string;
  light: string;
  prompt: string;
  negative: string;
  /** Mode 7: the mood-board photo attached to this run. */
  mood?: string;
}

export interface EditorialRequest {
  image: ImageBytes;
  /** 1-based run number; used to rotate scene families so every card differs. */
  run: number;
  /** Skill id from shared/skills.ts; unknown ids fall back to the editorial skill. */
  skill?: string;
  /** Mode 7: extra direction text added by the team. */
  direction?: string;
  /** Scene pre-drawn by planRun(); when absent builderInstruction draws one itself. */
  scene?: string | null;
  /** Mode 7: mood-board photo attached after the garment photo. */
  extraImages?: ImageBytes[];
  /** "auto" | "arab" | "european" | "mixed" */
  market: string;
  /** Free-text city / mood preference from the batch. */
  preference: string;
  aspectRatio: string;
  /** Scenes and poses already used for this source, to avoid repeats. */
  used: { scene: string; pose: string }[];
  /** Scenes used recently in the user's other batches, so sets do not all open on the same street. */
  recent?: string[];
  /** Random source for the scene draw; injectable for tests. */
  random?: () => number;
}

/** Numbered scene lines of a skill library, in order. */
export function libraryScenes(library: string): string[] {
  const section = library.split(/\n## /).find((s) => /^Scene/i.test(s)) ?? library;
  return [...section.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim());
}

/**
 * Draws the scene for this run: a random library scene that was not used for this outfit or in
 * the user's recent batches. Left to its own devices the model opens on its favourite street
 * every time, so the draw happens here and the skill is told to use it.
 */
export function pickScene(req: EditorialRequest, scenes: string[]): string | null {
  if (!scenes.length) return null;
  const taken = [...req.used.map((u) => u.scene), ...(req.recent ?? [])]
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  const similar = (scene: string) => {
    const head = scene.toLowerCase().slice(0, 28);
    return taken.some((t) => t.includes(head) || head.includes(t.slice(0, 28)));
  };
  const fresh = scenes.filter((s) => !similar(s));
  const pool = fresh.length ? fresh : scenes;
  const random = req.random ?? Math.random;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    faceMode: { type: "string", enum: ["FACE_VISIBLE", "FACE_PARTIAL", "NO_FACE"] },
    garments: { type: "string" },
    scene: { type: "string" },
    pose: { type: "string" },
    light: { type: "string" },
    prompt: { type: "string" },
    negative: { type: "string" },
  },
  required: ["subject", "faceMode", "garments", "scene", "pose", "light", "prompt", "negative"],
};

export function builderInstruction(req: EditorialRequest): string {
  const market =
    req.market === "arab"
      ? "Arab / Middle-Eastern / Gulf / Levantine features"
      : req.market === "european"
        ? "European (Mediterranean, Northern or Eastern European) features"
        : req.market === "mixed"
          ? "alternate between Arab and European features across runs"
          : "your choice, alternating between Arab and European features across runs";
  const used = req.used.length
    ? `Already used for this outfit (do NOT reuse these scene families or poses): ${req.used
        .map((u, i) => `run ${i + 1}: scene "${u.scene}", pose "${u.pose}"`)
        .join("; ")}.`
    : "This is the first run for this outfit.";
  const skill = req.skill === "zaid" ? zaidSkill(req.direction ?? "") : skillById(req.skill);
  const scene = req.scene !== undefined ? req.scene : pickScene(req, libraryScenes(skill.library));
  const mood =
    req.skill === "zaid"
      ? `Mood-board image attached (image 2): "${zaidMoodById(zaidMoodForScene(scene)).title}". Match its world, light, framing distance and film treatment; change the spot, pose and details.`
      : "";
  const recent = req.recent?.length
    ? `Scenes used in the user's recent batches (avoid these families too): ${req.recent
        .slice(0, 12)
        .map((s) => `"${s}"`)
        .join("; ")}.`
    : "";
  return [
    "You are running the following skill. Follow it exactly and return ONLY the JSON object described at the end.",
    "=== SKILL ===",
    skill.instructions,
    "=== TEMPLATE ===",
    skill.template,
    "=== LIBRARY ===",
    skill.library,
    "=== RUN CONTEXT ===",
    `Run number: ${req.run}. ${used}`,
    recent,
    mood,
    scene
      ? `Scene assigned to this run (use it as the location family; describe it with full density and you may refine details): "${scene}". Do not substitute another family.`
      : "",
    `Market preference for a generated face (only when the face is not visible): ${market}.`,
    req.preference
      ? `User city / mood preference: ${req.preference}`
      : "No city or mood preference given.",
    `Aspect ratio: ${req.aspectRatio} vertical.`,
    "Intimates rule (underwear, lingerie, bras, briefs, sleepwear, swimwear): this is retail catalogue photography for a family department store. Describe the garments in plain product terms (bra, briefs, camisole), keep the pose calm and upright with relaxed arms and a neutral expression, choose a bright indoor or studio-like scene (bedroom with daylight, dressing room, hotel room, clean studio) rather than a street, and use no suggestive, sensual or body-focused language anywhere in the prompt. Phrase the opening as 'catalogue photograph of a model wearing the supplied two-piece set'.",
    "The attached image is the model/outfit photo. Do Step 1 (analysis), Step 2 (fresh combination) and Step 3 (write the full prompt, 600-1100 words, English, all template sections).",
    "Return JSON with keys: subject, faceMode, garments (the full garment inventory as prose), scene (one line), pose (one line), light (one line), prompt (the full prompt text), negative (one line negative prompt).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Draws the scene (and, for Zaid, the mood photo) for a run so the builder text and the attachments agree. */
export function planRun(req: EditorialRequest): { scene: string | null; mood?: string } {
  const skill = req.skill === "zaid" ? zaidSkill(req.direction ?? "") : skillById(req.skill);
  const scene = pickScene(req, libraryScenes(skill.library));
  return req.skill === "zaid" ? { scene, mood: zaidMoodForScene(scene) } : { scene };
}

function imageParts(req: EditorialRequest): ImageBytes[] {
  return [req.image, ...(req.extraImages ?? [])];
}

function toBase64(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

function parseBrief(text: string): EditorialBrief {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const d = JSON.parse(cleaned) as Partial<EditorialBrief>;
  if (!d.prompt || d.prompt.length < 200)
    throw new StudioError("Prompt builder returned an empty prompt.", 502);
  return {
    subject: d.subject ?? "",
    faceMode: (d.faceMode as EditorialBrief["faceMode"]) ?? "NO_FACE",
    garments: d.garments ?? "",
    scene: d.scene ?? "",
    pose: d.pose ?? "",
    light: d.light ?? "",
    prompt: d.prompt,
    negative: d.negative ?? "",
  };
}

/** Google Gemini through the Interactions API with a JSON schema response. */
/** Text/vision models to try in order; Google retires names quickly, so a 404 falls through to the next. */
export const GOOGLE_TEXT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
];

export async function buildBriefWithGoogle(
  key: string,
  req: EditorialRequest,
  fetchImpl: typeof fetch = fetch,
  model?: string,
): Promise<EditorialBrief> {
  const candidates = model ? [model] : GOOGLE_TEXT_MODELS;
  let lastError: StudioError | null = null;
  for (const m of candidates) {
    try {
      return await buildBriefWithGoogleModel(key, req, fetchImpl, m);
    } catch (e) {
      if (e instanceof StudioError && /\(404\)/.test(e.message)) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new StudioError("No Google text model available.", 502);
}

async function buildBriefWithGoogleModel(
  key: string,
  req: EditorialRequest,
  fetchImpl: typeof fetch,
  model: string,
): Promise<EditorialBrief> {
  const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { type: "text", text: builderInstruction(req) },
        ...imageParts(req).map((img) => ({
          type: "image",
          mime_type: img.mime,
          data: toBase64(img.bytes),
        })),
      ],
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok)
    throw new StudioError(
      `Prompt builder (Google) failed (${r.status}): ${(await r.text()).slice(0, 200)}`,
      502,
    );
  const d = (await r.json()) as {
    steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
    output_text?: string;
  };
  const text =
    d.output_text ??
    (d.steps ?? [])
      .filter((s) => s.type === "model_output")
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  return parseBrief(text);
}

/** OpenAI chat completion with an image and JSON output. */
export async function buildBriefWithOpenAI(
  key: string,
  req: EditorialRequest,
  fetchImpl: typeof fetch = fetch,
  model = "gpt-4.1",
): Promise<EditorialBrief> {
  const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: builderInstruction(req) },
            ...imageParts(req).map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mime};base64,${toBase64(img.bytes)}` },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok)
    throw new StudioError(
      `Prompt builder (OpenAI) failed (${r.status}): ${(await r.text()).slice(0, 200)}`,
      502,
    );
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return parseBrief(d.choices?.[0]?.message?.content ?? "");
}
