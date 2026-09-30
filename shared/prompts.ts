import type { Config } from "./config";
import { FABRIC_CARD } from "./config";

export const MODE_PROMPTS: Record<Config["mode"], string> = {
  "1": "Create a fashion catalogue image using the garment reference as the source of truth. Replace the mannequin or flat lay with a fully clothed photorealistic adult model. Build a consistent lifestyle story. Do not invent unseen product construction.",
  "2": "Create ONLY a lifestyle first card from the supplied product photo. Use a new photorealistic adult model. The remaining real photographs are preserved separately. Reproduce the garment accurately.",
  "3": "Create ONLY a lifestyle first card using the supplied real model identity reference. Preserve that adult person's face, proportions and body shape. Keep the exact referenced garment.",
  "4": "Improve ONLY the background of the existing real model photograph. Preserve the model's face, body, pose, hair, hands and every visible garment detail. Do not redesign, recolour, retouch or replace the model or garment. Match background lighting to the original subject.",
};

const SHOTS = [
  "Full-length front view, relaxed standing pose.",
  "Three-quarter view, casual walking pose.",
  "Side profile, full garment visible.",
  "Seated lifestyle pose, garment unobstructed.",
  "A distinct candid lifestyle pose, garment unobstructed.",
  "Fabric macro close-up of the actual material. Show the source weave, stitching and texture; no person.",
];

const FIDELITY =
  "Product fidelity: preserve colour, weave, wash, print, seams, logo, buttons, silhouette, hem, and fit. No added text or watermarks. Original photo is the source of truth.";

const CENTERING =
  "Composition: exactly ONE model. Centre the midpoint of the full model bounding box at x=50% of frame width, equal margins left and right. Keep head, hands, garment and feet fully inside the frame.";

export interface PromptImages {
  /** true when a real model identity reference is attached as image 2 (mode 3) */
  identity?: boolean;
  /** true when card 1's result is attached as the consistency reference (mode 1, cards 2-5) */
  firstCard?: boolean;
  /** true when the latest result is attached as the last image for a revision */
  revision?: boolean;
}

/** Build the full generation prompt for one card. Deterministic so it can be stored and audited. */
export function buildPrompt(c: Config, card: number, edit = "", images: PromptImages = {}): string {
  const parts = [
    MODE_PROMPTS[c.mode],
    `Category: ${c.category}. Source type: ${c.input}. Model direction: ${c.modelDescription}.`,
    c.mode === "1"
      ? SHOTS[card - 1]
      : "Full garment visible, premium fashion lifestyle composition.",
    FIDELITY,
    c.center && card !== FABRIC_CARD ? CENTERING : "",
    c.prompt,
    edit
      ? `Revision of the existing result: ${edit}. Change only what is requested; keep all other details.`
      : "",
  ];
  const roles: string[] = ["Image 1 is the exact garment source."];
  if (images.identity) roles.push("Image 2 is the real model identity reference.");
  if (images.firstCard)
    roles.push(
      "Image 2 establishes model identity, location and lighting. Keep this exact same model and setting across the lifestyle cards.",
    );
  if (images.revision) roles.push("The LAST image is the existing result to revise.");
  if (roles.length > 1 || images.revision) parts.push(roles.join(" "));
  return parts.filter(Boolean).join("\n\n");
}

export const RECENTER_SUFFIX =
  "Correct composition: full person bounding box exactly at x=50%. Preserve garment and entire body.";
