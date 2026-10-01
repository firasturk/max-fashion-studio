/**
 * Writes a skill's direction and library from its reference photos: the vision model studies
 * every photo for setting, pose and light (never clothing or accessories) and returns the two
 * texts the team would otherwise write by hand.
 */
import type { Env } from "./env";
import { StudioError, errorMessage } from "./errors";
import { resolveGoogleKey, resolveOpenAIKey } from "./settings";
import { askVisionGoogle, askVisionOpenAI } from "./editorial";
import type { ImageBytes } from "./openai";

const SCHEMA = {
  type: "object",
  properties: { goal: { type: "string" }, library: { type: "string" } },
  required: ["goal", "library"],
};

export function skillBuilderInstruction(title: string, count: number): string {
  return [
    `You are writing the creative brief for a fashion-photography prompt skill called "${title}" from ${count} attached reference photographs. Every generated image will later borrow its background, pose and lighting from one of these photos.`,
    "Look at each photo and extract ONLY: the kind of place and its surfaces, depth layers, weather and time of day; the model's pose and body language; the light (direction, quality, colour); the framing distance and lens feel; the colour grade and photographic treatment (film-like, clean, etc.). Ignore and never mention clothing, prints, colours of garments, faces, hair styling, hats, bags, sunglasses, jewellery, props or brands.",
    "Write two texts in English:",
    "1. goal: 4-8 sentences starting with 'Goal: write ONE prompt for ...'. Say what the skill is for, the overall world and mood shared by the photos, the pose energy, the light signature, the framing habit, and end with 'The garment stays exactly as supplied; the output keeps the upload's framing.' If children appear, add 'Child safety wording applies throughout.' Use catalogue-safe wording only (no words about bodies being attractive, sensual or similar).",
    "2. library: Markdown in exactly this shape: '# <title> library', then '## Scene families' with ONE numbered line per photo (1., 2., ...) describing that photo's setting with full density in one sentence (surfaces, depth, weather, light), then '## Poses' with one dash line per photo describing its pose in the same spirit, then '## Light' with 3-4 dash lines, '## Camera' with 2 dash lines (lens, height, framing), '## Colour grade' with 1-2 dash lines, and '## Avoid' with one dash line that starts with 'Hats, caps, bags, sunglasses or props copied from a reference;' and continues with what would break this world.",
    "Return ONLY a JSON object with keys goal and library.",
  ].join("\n\n");
}

export async function buildSkillFromReferences(
  env: Env,
  title: string,
  images: ImageBytes[],
): Promise<{ goal: string; library: string }> {
  if (!images.length) throw new StudioError("Add reference photos to this skill first.");
  const google = (await resolveGoogleKey(env)).key;
  const openai = (await resolveOpenAIKey(env)).key;
  if (!google && !openai)
    throw new StudioError("Building from references needs a Google or OpenAI key in Connection.", 428);
  const instruction = skillBuilderInstruction(title, images.length);
  let text: string;
  if (google) {
    try {
      text = await askVisionGoogle(google, instruction, images, SCHEMA);
    } catch (e) {
      if (openai && /location is not supported|\(4\d\d\)/.test(errorMessage(e)))
        text = await askVisionOpenAI(openai, instruction, images);
      else throw e;
    }
  } else text = await askVisionOpenAI(openai!, instruction, images);
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const d = JSON.parse(cleaned) as { goal?: string; library?: string };
  if (!d.goal || !d.library) throw new StudioError("The model returned an incomplete brief.", 502);
  return { goal: d.goal.trim(), library: d.library.trim() };
}
