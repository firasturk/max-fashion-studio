/**
 * Runs the Fashion Editorial Prompt Builder skill with a vision model: the uploaded photo goes in,
 * a structured brief (analysis, long prompt, negative prompt) comes out. The skill is one of the
 * ready-made entries in shared/skills.ts. Google Gemini is
 * used when a Google key exists, otherwise OpenAI. The skill text itself lives in shared/editorial-skill.ts.
 */
import { skillById, type SkillDef } from "@shared/skills";
import { zaidSkill } from "@shared/zaid";
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
  /** Id of the reference-library photo attached to this run, if any. */
  mood?: string;
  /** FULL_BODY | UPPER_BODY | LOWER_BODY, read from the upload and locked for the output. */
  framing?: string;
  /** Task id of the already generated image of the same product set this one is matched to. */
  setOf?: string;
}

export type Framing = "FULL_BODY" | "UPPER_BODY" | "LOWER_BODY";

export interface EditorialRequest {
  /** Replace the person entirely with an AI-generated model; keep only what is worn. */
  newModel?: boolean;
  /** Verified: the upload shows a hand in a pocket. Only then may the output. */
  handsInPockets?: boolean;
  /** A saved prompt that leads this run: its scene, pose, light and style are reused as written. */
  look?: {
    name: string;
    prompt: string;
    negative: string;
    scene: string;
    pose: string;
    light: string;
  };
  image: ImageBytes;
  /** 1-based run number; used to rotate scene families so every card differs. */
  run: number;
  /** Skill id from shared/skills.ts; unknown ids fall back to the editorial skill. */
  skill?: string;
  /** The resolved skill (team edits applied); when absent the built-in list is used. */
  skillDef?: SkillDef;
  /** Mode 7: extra direction text added by the team. */
  direction?: string;
  /** Scene pre-drawn by planRun(); when absent builderInstruction draws one itself. */
  scene?: string | null;
  /** Reference-library photo ids available for this skill; planRun() picks one not used recently. */
  references?: string[];
  /** Reference ids already attached to sibling runs or recent batches. */
  usedReferences?: string[];
  /** The reference photo chosen for this run, attached after the garment photo. */
  reference?: string;
  /** Extra images attached after the garment photo (the chosen reference, then the set sibling). */
  extraImages?: ImageBytes[];
  /** Same-product set: the scene and light already used for the sibling image, to be matched exactly. */
  set?: { scene: string; light: string; pose: string; hasImage: boolean };
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
    framing: { type: "string", enum: ["FULL_BODY", "UPPER_BODY", "LOWER_BODY"] },
  },
  required: [
    "subject",
    "faceMode",
    "garments",
    "scene",
    "pose",
    "light",
    "prompt",
    "negative",
    "framing",
  ],
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
  const skill = skillFor(req);
  const scene = req.scene !== undefined ? req.scene : pickScene(req, libraryScenes(skill.library));
  const look = req.look
    ? `SAVED LOOK "${req.look.name}" (overrides the reference rules, the scene assignment, the library and the avoid-repeats list). The team approved the prompt below on an earlier image and wants the SAME look again. Reuse its location and background, pose and stance, lighting, camera angle and distance, colour grade and overall style exactly as written; do not pick a different scene family and do not vary them for novelty. Rewrite ONLY what must follow image 1: the subject line, the garment inventory (every garment, footwear and accessory exactly as worn in image 1), the framing/crop of image 1, and the face rules. Keep the prompt structure, length and wording otherwise as close to the saved prompt as the new outfit allows.\n--- SAVED PROMPT ---\n${req.look.prompt}\n--- END SAVED PROMPT ---${req.look.negative ? `\nSaved negative prompt to reuse: ${req.look.negative}` : ""}`
    : "";
  const mood = req.reference
    ? "REFERENCE FIRST. Image 2 is the primary creative source for this run: build the scene, the pose and stance (standing, sitting, walking, leaning), the lighting and the camera angle from it. Describe its kind of place, surfaces, depth, time of day and light with full density, and give the model a pose in the same spirit, then change the exact spot and details so the result is a sibling, not a copy. Ignore its clothing, face, hair, hats, bags, sunglasses, jewellery, props and accessories; the garment comes from image 1 alone and the framing follows image 1. The skill's written direction and library are secondary: use them for mood, colour and the avoid list, and only draw a scene from the library when it fits the reference."
    : "";
  const set = req.set
    ? `SAME PRODUCT SET (overrides everything about the scene): this upload is another photo of the SAME product as an image already generated. Use exactly the same location and background, the same light and time of day, the same colour grade and camera distance, so the two images sit side by side as one shoot. Scene to reuse: "${req.set.scene}". Light to reuse: "${req.set.light}".${req.set.hasImage ? " The generated sibling is attached as the last image: match its background, light and colour grade precisely." : ""} Only the pose and crop follow this upload (same framing as image 1); the pose may differ from the sibling's ("${req.set.pose}") so the two are not identical.`
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
    `Run number: ${req.run}. ${req.look ? "Repeat the saved look; the avoid list does not apply." : used}`,
    req.look ? "" : recent,
    look,
    mood,
    set,
    scene && !req.reference && !req.set && !req.look
      ? `Scene assigned to this run (use it as the location family; describe it with full density and you may refine details): "${scene}". Do not substitute another family.`
      : "",
    req.newModel
      ? `NEW MODEL RULE (overrides the FACE rule and anything else about the person): the person in image 1 is never reproduced. Treat the face as NO_FACE regardless of visibility. Invent an entirely new professional model (face, hair, skin tone, build, age within adult range) following the market preference "${market}", described with the realism block. Never describe or borrow the original person's features, hair, skin or body. Take from image 1 ONLY the garments, footwear, accessories and bags, kept exactly as worn, plus the framing. Write the opening line as: "Use the attached image as the single source of truth for the outfit only; the model is a different, newly generated person. Replace the plain background completely with the new setting described below."`
      : `Market preference for a generated face (only when the face is not visible): ${market}.`,
    req.preference
      ? `EXTRA REQUESTS FROM THE USER for this batch (apply them to the prompt; they override the skill's direction and library but never the fixed rules): ${req.preference}`
      : "No extra requests from the user.",
    "Fixed rules for every prompt (they override the skill's own direction, template and library): (1) a reference image contributes only setting, pose and stance, lighting and camera angle; (2) never copy hats, bags, sunglasses, jewellery or props from a reference; (3) HANDS: a hand goes into a pocket only when the upload shows a hand in a pocket; otherwise hands stay out of pockets, relaxed and visible; (4) COMPOSITION: the model is centred on the vertical axis of the frame, the midpoint of the full body at x=50% with equal space left and right, never pushed to one side; architecture, street or furniture may frame the model symmetrically but never offset them. Say this explicitly in the prompt's composition section.",
    `Aspect ratio: ${req.aspectRatio} vertical.`,
    handsDirective(req.handsInPockets),
    "Safe wording: catalogue language only; never describe bodies as attractive or sensual; children only as happy child models with an age band, no makeup, no adult poses.",
    "Intimates rule (underwear, lingerie, bras, briefs, sleepwear, swimwear): this is retail catalogue photography for a family department store. Describe the garments in plain product terms (bra, briefs, camisole), keep the pose calm and upright with relaxed arms and a neutral expression, choose a bright indoor or studio-like scene (bedroom with daylight, dressing room, hotel room, clean studio) rather than a street, and use no suggestive, sensual or body-focused language anywhere in the prompt. Phrase the opening as 'catalogue photograph of a model wearing the supplied two-piece set'.",
    "The attached image is the model/outfit photo. Do Step 1 (analysis), Step 2 (fresh combination) and Step 3 (write the full prompt, 600-1100 words, English, all template sections).",
    "Return JSON with keys: subject, faceMode, garments (the full garment inventory as prose), scene (one line), pose (one line), light (one line), prompt (the full prompt text), negative (one line negative prompt), framing (FULL_BODY, UPPER_BODY or LOWER_BODY).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Draws the scene and the reference photo for a run so the builder text and the attachments
 * agree. The reference is one of the skill's library photos not used for this outfit or recently.
 */
function skillFor(req: EditorialRequest): SkillDef {
  if (req.skill === "zaid") return zaidSkill(req.direction ?? "");
  return req.skillDef ?? skillById(req.skill);
}

export function planRun(req: EditorialRequest): { scene: string | null; mood?: string } {
  const skill = skillFor(req);
  const refs = req.references ?? [];
  // With reference photos the photo leads and rotates; the text library's scenes only step in without photos.
  if (!refs.length) return { scene: pickScene(req, libraryScenes(skill.library)) };
  const scene = null;
  const taken = new Set(req.usedReferences ?? []);
  const fresh = refs.filter((r) => !taken.has(r));
  const pool = fresh.length ? fresh : refs;
  const random = req.random ?? Math.random;
  return { scene, mood: pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] };
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
    framing: d.framing,
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

/** One vision call to Google returning the model's JSON text (schema-constrained). */
export async function askVisionGoogle(
  key: string,
  instruction: string,
  images: ImageBytes[],
  schema: unknown,
  fetchImpl: typeof fetch = fetch,
  model?: string,
): Promise<string> {
  const candidates = model ? [model] : GOOGLE_TEXT_MODELS;
  let lastError: StudioError | null = null;
  for (const m of candidates) {
    const r = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: m,
        store: false,
        input: [
          { type: "text", text: instruction },
          ...images.map((img) => ({
            type: "image",
            mime_type: img.mime,
            data: toBase64(img.bytes),
          })),
        ],
        response_format: { type: "text", mime_type: "application/json", schema },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (r.status === 404) {
      lastError = new StudioError(`Prompt builder (Google) failed (404): ${m}`, 502);
      continue;
    }
    if (!r.ok)
      throw new StudioError(
        `Prompt builder (Google) failed (${r.status}): ${(await r.text()).slice(0, 200)}`,
        502,
      );
    const d = (await r.json()) as {
      steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
      output_text?: string;
    };
    return (
      d.output_text ??
      (d.steps ?? [])
        .filter((s) => s.type === "model_output")
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
    );
  }
  throw lastError ?? new StudioError("No Google text model available.", 502);
}

/** One vision call to OpenAI returning the model's JSON text. */
/** The verified pocket fact from the upload, binding for the builder. */
export function handsDirective(handsInPockets = false): string {
  return handsInPockets
    ? "VERIFIED HANDS: the upload shows a hand in a pocket, so a hand in a pocket is allowed in the output."
    : "VERIFIED HANDS: the upload shows no hand in a pocket, so NO hand goes into a pocket in the output; hands stay out of pockets, relaxed and visible.";
}

/** JSON schema for the framing check (Google structured output). */
export const FRAMING_SCHEMA = {
  type: "object",
  properties: {
    framing: { type: "string", enum: ["FULL_BODY", "UPPER_BODY", "LOWER_BODY"] },
    faceVisible: { type: "boolean" },
    handsInPockets: { type: "boolean" },
    garments: { type: "string" },
  },
  required: ["framing", "faceVisible", "handsInPockets", "garments"],
};

export const FRAMING_CHECK_INSTRUCTION =
  "Look at the attached product photo and answer with JSON only. framing: FULL_BODY if the person is shown from the head (or at least the shoulders) down to the feet; UPPER_BODY if the photo is cropped around the waist or hips and shows no legs below the hips; LOWER_BODY if the photo starts at or near the waist and shows legs and/or footwear with no face or chest, even if a sliver of a top is visible at the top edge. Decide from what is actually inside the picture, never from what the garment would need. faceVisible: true only if a face is clearly visible. handsInPockets: true only if at least one hand is inside a pocket in the photo. garments: a short comma-separated list of the clothing, footwear and accessories actually visible. Keys: framing, faceVisible, handsInPockets, garments.";

/** Parse the framing check's answer; unknown answers are treated as full body. */
export interface FramingCheck {
  framing: Framing;
  faceVisible: boolean;
  handsInPockets: boolean;
  garments: string;
}

export function parseFramingCheck(text: string): FramingCheck {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const d = JSON.parse(cleaned) as {
      framing?: string;
      faceVisible?: boolean;
      handsInPockets?: boolean;
      garments?: string;
    };
    const framing: Framing =
      d.framing === "UPPER_BODY" || d.framing === "LOWER_BODY" ? d.framing : "FULL_BODY";
    return {
      framing,
      faceVisible: !!d.faceVisible,
      handsInPockets: !!d.handsInPockets,
      garments: (d.garments ?? "").slice(0, 300),
    };
  } catch {
    return { framing: "FULL_BODY", faceVisible: false, handsInPockets: false, garments: "" };
  }
}

export async function askVisionOpenAI(
  key: string,
  instruction: string,
  images: ImageBytes[],
  fetchImpl: typeof fetch = fetch,
  model = "gpt-4.1",
): Promise<string> {
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
            { type: "text", text: instruction },
            // The garment photo needs full detail; the reference and sibling images only set the
            // scene, so low detail (a few dozen tokens each) keeps the call inside small rate limits.
            ...images.map((img, i) => ({
              type: "image_url",
              image_url: {
                url: `data:${img.mime};base64,${toBase64(img.bytes)}`,
                detail: i === 0 ? "high" : "low",
              },
            })),
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (r.status === 429) {
    const detail = (await r.text()).slice(0, 200);
    // Each model has its own token-per-minute pool; the mini model's is far larger, so one 429 on
    // the main model falls through to it rather than stalling the batch.
    if (model === "gpt-4.1")
      return askVisionOpenAI(key, instruction, images, fetchImpl, "gpt-4.1-mini");
    throw new StudioError(`Prompt builder (OpenAI) rate limited (429): ${detail}`, 429);
  }
  if (!r.ok)
    throw new StudioError(
      `Prompt builder (OpenAI) failed (${r.status}): ${(await r.text()).slice(0, 200)}`,
      502,
    );
  const d = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content ?? "";
}

async function buildBriefWithGoogleModel(
  key: string,
  req: EditorialRequest,
  fetchImpl: typeof fetch,
  model: string,
): Promise<EditorialBrief> {
  return parseBrief(
    await askVisionGoogle(key, builderInstruction(req), imageParts(req), SCHEMA, fetchImpl, model),
  );
}

/** OpenAI chat completion with an image and JSON output. */
export async function buildBriefWithOpenAI(
  key: string,
  req: EditorialRequest,
  fetchImpl: typeof fetch = fetch,
  model = "gpt-4.1",
): Promise<EditorialBrief> {
  return parseBrief(
    await askVisionOpenAI(key, builderInstruction(req), imageParts(req), fetchImpl, model),
  );
}
