import type { Config } from "./config";
import { FABRIC_CARD, FIDELITY, SCENES, backdropColors } from "./config";

export const MODE_PROMPTS: Record<Config["mode"], string> = {
  "1": "Fashion catalogue production from a mannequin or flat-lay reference. Replace the mannequin with a fully clothed photorealistic adult model wearing exactly this garment. Do not invent unseen product construction.",
  "2": "Create a lifestyle image from the supplied real model photograph. Keep the exact garment, styling and body proportions, but present a DIFFERENT photorealistic adult model face and hair suited to the garment. Never reuse the original person's face.",
  "3": "Create a new pose from the supplied real model photograph. Keep the same person's body, styling and the exact garment, but give her a DIFFERENT photorealistic face so she is not identifiable. Only the pose and framing change.",
  "5": "Premium fashion editorial (Zara / Splash style) built by the Fashion Editorial Prompt Builder from the attached photo. The outfit is the hero product and is never changed.",
  "7": "Fashion imagery written per image by the prompt builder following Zaid's creative direction. The outfit is the hero and is never changed.",
  "6": "Product packshot recolour: change ONLY the background colour of the attached product photo. The product (garment, mannequin or model, and everything on it) must stay pixel-identical: same position, scale, crop, pose, colours, print, texture, folds and edges. Do not retouch, restyle, move, crop or re-light the product.",
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
  /** true when a reference-library photo is attached after the garment photo */
  mood?: boolean;
  /** true when an already generated image of the same product set is attached after the reference */
  set?: boolean;
}

/** Scene for a given card, cycling through the scene list. */
export function sceneFor(_c: Config, card: number): string {
  return SCENES[(card - 1) % SCENES.length];
}

/**
 * Whether the prompt asks for a centred model and the reviewer may queue a centring retry.
 * Modes 4 and 6 keep the source framing; the skill workflow (5) composes its own frame.
 */
export function centeringApplies(c: Config, card: number): boolean {
  return (
    c.center &&
    card !== FABRIC_CARD &&
    c.mode !== "4" &&
    c.mode !== "5" &&
    c.mode !== "6" &&
    c.mode !== "7"
  );
}

/** Build the full generation prompt for one card. Deterministic so it can be stored and audited. */
export function buildPrompt(c: Config, card: number, edit = "", images: PromptImages = {}): string {
  const fidelity = `Product fidelity: preserve ${FIDELITY}. Preserve colour, seams, logo, buttons, silhouette, hem and fit exactly. No added text or watermarks. The original photo is the source of truth.`;
  const parts: string[] = [MODE_PROMPTS[c.mode], `Source type: ${c.input}.`];

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
  } else if (c.mode === "6") {
    const colour = backdropColors(c)[(card - 1) % backdropColors(c).length];
    parts.push(
      `New background: a flat, perfectly even, seamless solid ${colour} backdrop filling the whole frame behind the product. Keep a soft, natural contact shadow under the product consistent with the original lighting; no gradients, textures, props or vignette unless the original had them. Edges of the product must stay clean with no halo or colour fringing.`,
    );
    if (c.prompt) parts.push(c.prompt);
  } else if (c.mode === "5") {
    parts.push("Editorial prompt is written per image by the prompt builder before generation.");
    if (c.prompt) parts.push(`City / mood preference: ${c.prompt}`);
  } else if (c.mode === "7") {
    parts.push("Prompt is written per image by the prompt builder from Zaid's creative direction.");
    if (c.prompt) parts.push(`Creative direction: ${c.prompt}`);
  } else {
    parts.push(`New background for this image: ${sceneFor(c, card)} ${c.prompt}`);
    parts.push("Keep the model, pose, framing and garment exactly as in the source photo.");
  }

  parts.push(fidelity);
  if (c.mode === "1" && card === FABRIC_CARD)
    parts.push(
      "Output must be a flat textile macro photograph only. If a person would appear, the result is wrong.",
    );
  if (centeringApplies(c, card)) parts.push(CENTERING);
  if (edit)
    parts.push(
      `Revision of the existing result: ${edit}. Change only what is requested; keep all other details.`,
    );

  const roles: string[] = [
    "Image 1 is the exact source for the outfit, footwear and any accessories worn: keep them identical.",
  ];
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
    "The attached first image is the reference photo of the outfit and model: keep every garment, the footwear and any accessory worn in it identical, nothing added or removed.",
  ];
  let idx = 2;
  if (images.mood)
    roles.push(
      `Image ${idx++} is a visual reference: use it only for the background/setting, the pose and stance, the lighting and the camera angle; never copy its clothing, face, hats, bags, accessories or exact spot. Keep the framing of image 1 (full body stays full body, an upper-body crop stays upper-body, a lower-body crop stays lower-body).`,
    );
  if (images.set)
    roles.push(
      `Image ${idx++} is an already generated image of the same product: reproduce its background, lighting, colour grade and camera distance exactly so both images read as one shoot; only the pose and the crop follow image 1.`,
    );
  if (images.revision) roles.push("The LAST image is the existing result to revise.");
  if (roles.length > 1) parts.push(roles.join(" "));
  if (negative) parts.push(`AVOID: ${negative}`);
  return parts.join("\n\n");
}

export const RECENTER_SUFFIX =
  "Correct composition: full person bounding box exactly at x=50%. Preserve garment and entire body.";
