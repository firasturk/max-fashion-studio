import type { Config } from "./config";
import { CATEGORY_PRESETS, FABRIC_CARD } from "./config";

export const MODE_PROMPTS: Record<Config["mode"], string> = {
  "1": "Fashion catalogue production from a mannequin or flat-lay reference. Replace the mannequin with a fully clothed photorealistic adult model wearing exactly this garment. Do not invent unseen product construction.",
  "2": "Create a lifestyle image from the supplied real model photograph. Keep the exact garment, styling and body proportions, but present a DIFFERENT photorealistic adult model face and hair suited to the category. Never reuse the original person's face.",
  "3": "Create a new pose from the supplied real model photograph. Keep the same person's body, styling and the exact garment, but give her a DIFFERENT photorealistic face so she is not identifiable. Only the pose and framing change.",
  "5": "Premium fashion editorial (Zara / Splash style) built by the Fashion Editorial Prompt Builder from the attached photo. The outfit is the hero product and is never changed.",
  "4": "Replace ONLY the background of the existing real model photograph. Preserve the model's face, body, pose, hair, hands, framing and every visible garment detail pixel for pixel. Do not redesign, recolour, retouch or move the model or garment. Match lighting and perspective of the new background to the subject.",
};

const STUDIO_LIGHT =
  "Professional studio: soft, even key light from the front-left with gentle fill, no harsh shadows, floor the same colour as the backdrop, no props, no windows.";

/** Card text for mode 1. Cards 2-5 share one backdrop and lighting; the studio set is built from the same model as card 1. */
function mode1Shot(card: number, backdrop: string): string {
  switch (card) {
    case 1:
      return "Card 1: lifestyle location image, full-length front view, relaxed standing pose.";
    case 2:
      return `Card 2: studio shot. ${backdrop}. ${STUDIO_LIGHT} Full-length front view, standing, weight on one leg.`;
    case 3:
      return `Card 3: studio shot. Exactly the same ${backdrop} and identical lighting as card 2. Three-quarter view showing the garment side, standing.`;
    case 4:
      return `Card 4: studio shot. Exactly the same ${backdrop} and identical lighting as card 2. The model is SEATED on a low plain cube in the same colour as the backdrop, legs together, garment fully visible and unwrinkled.`;
    case 5:
      return `Card 5: studio shot. Exactly the same ${backdrop} and identical lighting as card 2. Back view, standing, garment fully visible.`;
    default:
      return "Card 6: FABRIC ONLY. Extreme macro close-up of the garment's textile filling the whole frame: weave, lace or knit structure, stitching and texture in sharp focus. ABSOLUTELY NO person, mannequin, body, face, limbs, hanger or background. Crop straight into the fabric of the reference garment.";
  }
}

const POSES = [
  "Full-length front view, relaxed standing pose.",
  "Three-quarter view, casual walking pose.",
  "Side profile, full garment visible.",
  "Seated lifestyle pose, garment unobstructed.",
  "Leaning casually against a wall, garment unobstructed.",
  "Candid mid-step pose, looking away from camera.",
];

const CENTERING =
  "Composition: exactly ONE model. Centre the midpoint of the full model bounding box at x=50% of frame width, equal margins left and right. Keep head, hands, garment and feet fully inside the frame.";

export interface PromptImages {
  /** true when a real model identity reference is attached as image 2 */
  identity?: boolean;
  /** true when card 1's result is attached as the consistency reference (mode 1, cards 2-5) */
  firstCard?: boolean;
  /** true when card 2's studio result is attached as the backdrop/lighting reference (mode 1, cards 3-5) */
  studio?: boolean;
  /** true when the latest result is attached as the last image for a revision */
  revision?: boolean;
}

function preset(c: Config) {
  return CATEGORY_PRESETS[c.category] ?? CATEGORY_PRESETS.Other;
}

/** Scene for a given card, cycling through the category's scene list. */
export function sceneFor(c: Config, card: number): string {
  const scenes = preset(c).scenes;
  return scenes[(card - 1) % scenes.length];
}

/** Build the full generation prompt for one card. Deterministic so it can be stored and audited. */
export function buildPrompt(c: Config, card: number, edit = "", images: PromptImages = {}): string {
  const p = preset(c);
  const fidelity = `Product fidelity: preserve ${p.fidelity}. Preserve colour, seams, logo, buttons, silhouette, hem and fit exactly. No added text or watermarks. The original photo is the source of truth.`;
  const parts: string[] = [
    MODE_PROMPTS[c.mode],
    `Category: ${c.category}. Source type: ${c.input}.`,
  ];

  if (c.mode === "1") {
    if (card !== FABRIC_CARD) parts.push(`Model direction: ${c.modelDescription}.`);
    parts.push(mode1Shot(card, c.backdrop || "warm beige seamless paper backdrop"));
    if (card === 1) parts.push(`Location: ${c.prompt} ${sceneFor(c, 1)}`);
    if (card > 1 && card < FABRIC_CARD)
      parts.push(
        "Use the exact same model face, hair, body and garment as card 1. Studio setting only.",
      );
  } else if (c.mode === "2") {
    parts.push(`Model direction: ${c.modelDescription}.`);
    parts.push(`Lifestyle scene: ${c.prompt} ${sceneFor(c, card)}`);
    parts.push(POSES[(card - 1) % POSES.length]);
  } else if (c.mode === "3") {
    parts.push(`New pose: ${POSES[(card - 1) % POSES.length]}`);
    parts.push(`Setting: ${c.prompt} ${sceneFor(c, card)}`);
  } else if (c.mode === "5") {
    parts.push("Editorial prompt is written per image by the prompt builder before generation.");
    if (c.prompt) parts.push(`City / mood preference: ${c.prompt}`);
  } else {
    parts.push(`New background for this image: ${sceneFor(c, card)} ${c.prompt}`);
    parts.push("Keep the model, pose, framing and garment exactly as in the source photo.");
  }

  parts.push(fidelity);
  if (c.mode === "1" && card === FABRIC_CARD)
    parts.push(
      "Output must be a flat textile macro photograph only. If a person would appear, the result is wrong.",
    );
  if (c.center && card !== FABRIC_CARD && c.mode !== "4") parts.push(CENTERING);
  if (edit)
    parts.push(
      `Revision of the existing result: ${edit}. Change only what is requested; keep all other details.`,
    );

  const roles: string[] = ["Image 1 is the exact garment source."];
  if (images.identity) roles.push("Image 2 is the real model identity reference.");
  if (images.firstCard)
    roles.push(
      "Image 2 is card 1: it establishes the model's face, hair and body. Keep this exact same model across the studio cards.",
    );
  if (images.studio)
    roles.push(
      "Image 3 is card 2: copy its backdrop colour, floor, lighting direction and softness exactly so the studio set looks like one shoot.",
    );
  if (images.revision) roles.push("The LAST image is the existing result to revise.");
  if (roles.length > 1) parts.push(roles.join(" "));
  return parts.filter(Boolean).join("\n\n");
}

/** Final prompt for an editorial card: the builder's prompt plus roles, revision and the negative block. */
export function buildEditorialPrompt(
  briefPrompt: string,
  negative: string,
  edit = "",
  images: PromptImages = {},
): string {
  const parts = [briefPrompt.trim()];
  if (edit)
    parts.push(
      `Revision of the existing result: ${edit}. Change only what is requested; keep all other details.`,
    );
  const roles: string[] = [
    "The attached first image is the reference photo of the outfit and model.",
  ];
  if (images.revision) roles.push("The LAST image is the existing result to revise.");
  if (roles.length > 1) parts.push(roles.join(" "));
  if (negative) parts.push(`AVOID: ${negative}`);
  return parts.join("\n\n");
}

export const RECENTER_SUFFIX =
  "Correct composition: full person bounding box exactly at x=50%. Preserve garment and entire body.";
