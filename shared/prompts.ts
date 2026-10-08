import type { Config } from "./config";
import { FABRIC_CARD, FIDELITY, SCENES, backdropColors } from "./config";

export const MODE_PROMPTS: Record<Config["mode"], string> = {
  "1": "Fashion catalogue production from a mannequin or flat-lay reference. Replace the mannequin with a fully clothed photorealistic adult model wearing exactly this garment. Do not invent unseen product construction.",
  "2": "Create a lifestyle image from the supplied real model photograph. Keep the exact garment, styling and body proportions, but present a DIFFERENT photorealistic adult model face and hair suited to the garment. Never reuse the original person's face.",
  "3": "Create a new pose from the supplied real model photograph. Keep the same person's body, styling and the exact garment, but give her a DIFFERENT photorealistic face so she is not identifiable. Only the pose and framing change.",
  "5": "Premium fashion editorial (Zara / Splash style) built by the Fashion Editorial Prompt Builder from the attached photo. The outfit is the hero product and is never changed.",
  "7": "Fashion imagery written per image by the prompt builder following Zaid's creative direction. The outfit is the hero and is never changed.",
  "8": "Premium fashion editorial built by the prompt builder from the attached photo, worn by a new AI-generated model. Only the outfit, footwear, accessories and bags come from the photo; the person is replaced entirely.",
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

export const CENTERING =
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
 * Modes 4 and 6 keep the source framing; every other approach, the skill campaigns included,
 * composes its own frame and centres the model.
 */
export function centeringApplies(c: Config, card: number): boolean {
  return c.center && card !== FABRIC_CARD && c.mode !== "4" && c.mode !== "6";
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
  } else if (c.mode === "5" || c.mode === "8") {
    parts.push("Editorial prompt is written per image by the prompt builder before generation.");
    if (c.mode === "8") parts.push(NEW_MODEL_RULE);
    if (c.prompt) parts.push(`City / mood preference: ${c.prompt}`);
  } else if (c.mode === "7") {
    parts.push("Prompt is written per image by the prompt builder from Zaid's creative direction.");
    if (c.prompt) parts.push(`Creative direction: ${c.prompt}`);
  } else {
    parts.push(`New background for this image: ${sceneFor(c, card)} ${c.prompt}`);
    parts.push("Keep the model, pose, framing and garment exactly as in the source photo.");
  }

  parts.push(fidelity);
  // Every approach that shows a person keeps the upload's crop and tidy hair; the fabric macro and
  // the packshot recolour have no model to frame.
  if (c.mode !== "6" && !(c.mode === "1" && card === FABRIC_CARD)) {
    parts.push(framingRule());
    parts.push(HAIR_RULE);
    // Approaches 2 and 3 change the model on purpose; the others keep the person exactly.
    if (c.mode !== "2" && c.mode !== "3") parts.push(IDENTITY_RULE);
    parts.push(TATTOO_RULE);
  }
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
/** Engine-facing rule for the new-model skill campaign: the person is replaced, what is worn is kept. */
export const NEW_MODEL_RULE =
  "NEW MODEL: the person in the reference photo is NOT reproduced. Generate an entirely different, AI-created professional model: a new face, hair, skin tone, build and identity that do not resemble the original person in any way. Take from the reference photo ONLY what is worn: every garment, the footwear, and any accessories or bags, all kept identical in colour, print, construction, length and fit. Keep the same framing and crop as the reference.";

/** Engine-facing hair rule: tidy hair, no wind-blown or stray strands. */
export const HAIR_RULE =
  "HAIR: neat and settled, exactly as styled in the reference photo when the model is kept; no wind-blown, flying, floating or stray strands, no hair across the face or eyes.";

/** Engine-facing identity rule: the person in the reference photo is the model in the output. */
export const IDENTITY_RULE =
  "IDENTITY (highest priority): the model is the same person as in the reference photo (image 1), reproduced exactly: identical face and facial structure (face shape, jawline, nose, lips, eyes, eyebrows, cheekbones), identical skin tone, age and body; no identity change, no beautifying, no averaging, no different person. HAIRSTYLE: the same hairstyle as the reference photo, same length, colour, parting, texture and styling; do not restyle, cut, lengthen or recolour the hair. When the face is not visible in the reference photo, it is not visible in the output either.";

/** Engine-facing rule for every approach: tattoos on the model never appear in the output. */
export const TATTOO_RULE =
  "TATTOOS: if the person in the reference photo has any tattoo, it is removed in the output; the skin there is clean and natural, with no tattoo, ink, marking or trace of it anywhere on the body.";

/** Engine-facing light rule for Zaid creative direction. */
export const LIGHT_RULE =
  "LIGHT: real sun, golden-hour sun (low, warm, long soft shadows) or midday sun (high, clean, short shadows) as the prompt names it; never overcast, dusk, night or artificial light. Bright but balanced: open shadows and no blown-out highlights; no dim, murky, heavy-shadow or harsh high-contrast lighting. The model is evenly lit and the garment colours read true.";

/** Engine-facing integration rule for Zaid creative direction: the model belongs to the scene. */
export const BLEND_RULE =
  "INTEGRATION: the model is physically part of the scene, never a cutout or a pasted-on figure. The same sun direction, colour temperature and contrast on the model as on the background; feet planted on the ground with a true contact shadow and a cast shadow matching the scene's other shadows; matching perspective and camera height; identical grain, sharpness and colour grade on model and background; reflected light and ambient colour from the surroundings on skin and garment; natural edges with no halo or outline.";

/** Engine-facing background detail rule for Zaid creative direction. */
export const DETAIL_RULE =
  "BACKGROUND DETAIL: render the whole background in full, crisp, high-resolution detail: architecture, facades, materials, textures, signage, foliage, street furniture, floor surfaces and distant layers all sharply defined and rich. Only a gentle, natural depth of field that keeps the entire setting readable; never an empty, plain, smeared, washed-out or heavily blurred background.";

/** Engine-facing back-view rule: a model photographed from behind stays photographed from behind. */
export const BACK_VIEW_RULE =
  "BACK VIEW: the reference photo shows the model from behind. Keep exactly this back view: the model faces away from the camera, no face is shown, the back of the hairstyle and the back of every garment are what is seen; never turn the model around, never add a face or a profile.";

/** Engine-facing framing lock: the output crop is the upload's crop, nothing outside it is drawn. */
export function framingRule(framing?: string, handsInPockets = false): string {
  const hands = handsInPockets
    ? " Hands: a hand may rest in a pocket, as in the reference photo."
    : " Hands: no hand in a pocket; hands stay out of pockets, relaxed and visible.";
  if (framing === "UPPER_BODY")
    return (
      "FRAMING LOCK: upper body only, cropped at the same line as the reference photo (around the waist or hips). Do not show or invent legs, trousers, skirts, footwear or anything below that line; nothing outside the reference crop exists in this image." +
      hands
    );
  if (framing === "LOWER_BODY")
    return (
      "FRAMING LOCK: lower body only, from the waist down exactly as the reference photo is cropped. Do not show or invent the face, the top garments or anything above that line; nothing outside the reference crop exists in this image. The hands are visible inside the frame, relaxed and natural, in a position that fits the scene and the body's movement; never cropped out or raised above the crop line." +
      hands
    );
  if (framing === "THREE_QUARTER")
    return (
      "FRAMING LOCK: three-quarter body, from above the head down to the same line as the reference photo (between mid-thigh and just below the knees). Do not show or invent feet or footwear; nothing outside the reference crop exists in this image." +
      hands
    );
  if (framing === "FULL_BODY")
    return (
      "FRAMING LOCK: full body, head to footwear completely inside the frame, as in the reference photo. Nothing is worn in this image that is not visible in the reference photo: no added shoes, bags, hats, jewellery or layers." +
      hands
    );
  return (
    "FRAMING LOCK: keep exactly the reference photo's crop. A full-body photo stays full body with footwear inside the frame; an upper-body photo stays upper body and ends at the same line, with no legs, trousers or footwear drawn; a lower-body photo stays lower body and starts at the same line, with no face or top drawn. Nothing is worn in this image that is not visible in the reference photo: no added shoes, bags, hats, jewellery or layers." +
    hands
  );
}

export function buildEditorialPrompt(
  briefPrompt: string,
  negative: string,
  edit = "",
  images: PromptImages = {},
  newModel = false,
  center = true,
  framing?: string,
  handsInPockets = false,
  relaxed = false,
  backView = false,
): string {
  const parts = [briefPrompt.trim()];
  if (newModel) parts.push(NEW_MODEL_RULE);
  else parts.push(IDENTITY_RULE);
  parts.push(TATTOO_RULE);
  parts.push(framingRule(framing, handsInPockets));
  if (backView) parts.push(BACK_VIEW_RULE);
  // Zaid creative direction: hair follows the direction; the light is bright but balanced.
  if (relaxed) parts.push(LIGHT_RULE, DETAIL_RULE, BLEND_RULE);
  else parts.push(HAIR_RULE);
  if (center) parts.push(CENTERING);
  if (edit)
    parts.push(
      `Revision of the existing result: ${edit}. Change only what is requested; keep all other details.`,
    );
  const roles: string[] = [
    newModel
      ? "The attached first image is the reference photo of the outfit only: keep every garment, the footwear and any accessory or bag worn in it identical, nothing added or removed. Do not reproduce the person, face, hair or body from it; the model is newly generated."
      : "The attached first image is the reference photo of the outfit and model: keep every garment, the footwear and any accessory worn in it identical, nothing added or removed.",
  ];
  let idx = 2;
  if (images.mood)
    roles.push(
      `Image ${idx++} is a visual reference: use it only for the background/setting, the pose and stance, the lighting and the camera angle; never copy its clothing, face, hats, bags, accessories or exact spot. Keep the framing of image 1 (full body stays full body, three-quarter stays three-quarter, an upper-body crop stays upper-body, a lower-body crop stays lower-body, a back view stays a back view).${
        relaxed && framing === "FULL_BODY"
          ? " For this full-body image reproduce the reference's camera angle, camera height, tilt and distance exactly as the prompt describes them."
          : ""
      }`,
    );
  if (images.set)
    roles.push(
      `Image ${idx++} is an already generated image of the same product: reproduce its background, lighting, colour grade and camera distance exactly so both images read as one shoot; only the pose and the crop follow image 1.`,
    );
  if (images.revision) roles.push("The LAST image is the existing result to revise.");
  // The image-1 rule stands alone when the person is being replaced; otherwise only with extra images.
  if (roles.length > 1 || newModel) parts.push(roles.join(" "));
  const avoid = [
    negative,
    relaxed
      ? "dim scene, murky light, overcast sky, blown-out highlights, harsh shadows, empty background, smeared background, heavy background blur, low-detail background, cutout look, pasted-on model, floating feet, missing contact shadow, mismatched lighting, halo edges"
      : "wind-blown hair, flying hair strands, messy hair",
    handsInPockets ? "" : "hands in pockets",
    "tattoos, tattoo, body ink",
    newModel
      ? ""
      : "different face, altered facial features, changed hairstyle, different hair length or colour",
  ]
    .filter(Boolean)
    .join(", ");
  parts.push(`AVOID: ${avoid}`);
  return parts.join("\n\n");
}

export const RECENTER_SUFFIX =
  "Correct composition: full person bounding box exactly at x=50%. Preserve garment and entire body.";

/**
 * A short, plain prompt used for the one retry after a content checker refused the full prompt:
 * the scene, pose and light in one line each, the outfit lock and the fixed rules, nothing else.
 */
export function buildCompactPrompt(
  brief: { scene: string; pose: string; light: string; garments: string; negative: string },
  newModel: boolean,
  center: boolean,
  framing?: string,
  handsInPockets = false,
): string {
  const parts = [
    `Catalogue lifestyle photograph of the model from the reference photo wearing exactly the supplied outfit (${brief.garments}). Setting: ${brief.scene}. Pose: ${brief.pose}. Light: ${brief.light}. Photorealistic, natural colour, clean editorial look.`,
    newModel ? NEW_MODEL_RULE : IDENTITY_RULE,
    framingRule(framing, handsInPockets),
  ];
  if (center) parts.push(CENTERING);
  parts.push(
    `AVOID: ${[brief.negative, handsInPockets ? "" : "hands in pockets"].filter(Boolean).join(", ")}`,
  );
  return parts.join("\n\n");
}
