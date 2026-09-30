import { z } from "zod";

export const MODES = ["1", "2", "3", "4", "5", "6"] as const;
export const MARKETS = ["auto", "arab", "european", "mixed"] as const;
export const INPUT_TYPES = ["model", "mannequin", "flatlay"] as const;
export const RATIOS = ["2:3", "3:4", "4:5", "1:1"] as const;
export const SIZES = ["1K", "2K", "4K"] as const;
export const MAX_COUNT = 6;

export const configSchema = z.object({
  mode: z.enum(MODES),
  category: z.string().min(1).max(80),
  input: z.enum(INPUT_TYPES),
  prompt: z.string().max(20000),
  ratio: z.enum(RATIOS),
  size: z.enum(SIZES),
  /** Engine model slug chosen for this batch; empty means the server default. */
  model: z.string().max(120).optional(),
  /** Images per original for modes 2-4. Mode 1 always produces six. */
  count: z.number().int().min(1).max(MAX_COUNT).default(1),
  /** Backdrop-colour mode: comma-separated colours, one image per colour. */
  colors: z.string().max(400).default("pure white, warm beige, light grey"),
  /** Editorial mode: look of a generated face when the reference face is not visible. */
  market: z.enum(MARKETS).default("auto"),
  /** Studio backdrop for mode 1 cards 2-5; identical across the set. */
  backdrop: z.string().max(1000).default("warm beige seamless paper backdrop"),
  identity: z.string().max(160).optional(),
  modelDescription: z.string().max(4000),
  center: z.boolean(),
});
export type Config = z.infer<typeof configSchema>;

export const FABRIC_CARD = 6;
export const MODE1_CARDS = 6;

/** Colours for the backdrop-colour workflow, in order, at most MAX_COUNT. */
export function backdropColors(c: Config): string[] {
  const list = (c.colors || "")
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return (list.length ? list : ["pure white"]).slice(0, MAX_COUNT);
}

/** How many generation tasks one lead upload creates. */
export function cardsPerSource(c: Config): number {
  if (c.mode === "1") return MODE1_CARDS;
  if (c.mode === "6") return backdropColors(c).length;
  return Math.min(MAX_COUNT, Math.max(1, c.count || 1));
}

/** Women's categories as named on maxfashion.com (UAE). Each carries lifestyle scenes and product-fidelity notes. */
export interface CategoryPreset {
  /** Base lifestyle/background direction; editable per batch. */
  prompt: string;
  /** Distinct background scenes, one per card, for "fresh background" and lifestyle variety. */
  scenes: string[];
  /** What must never change on the garment. */
  fidelity: string;
}

const URBAN = [
  "Sunlit city street with pale stone facades and soft morning light.",
  "Modern glass-and-concrete building entrance, bright overcast daylight.",
  "Minimal cafe terrace with warm wood and neutral walls.",
  "Quiet residential lane with white walls and green foliage.",
  "Rooftop with a hazy skyline and golden-hour light.",
  "Contemporary art-gallery interior with white walls and soft daylight.",
];
const INTERIOR = [
  "Bright minimalist living room with linen sofa and daylight from tall windows.",
  "Neutral bedroom with soft morning light and crisp bedding.",
  "Sunroom with sheer curtains and potted plants.",
  "Modern hallway with wooden floor and a large mirror.",
  "Scandinavian kitchen corner with light wood and white tiles.",
  "Hotel lobby lounge with warm stone and soft lamps.",
];
const OUTDOOR = [
  "Beach boardwalk with soft sand and hazy sea in the background.",
  "Park path lined with trees in soft overcast light.",
  "Desert dunes at golden hour with gentle shadows.",
  "Marina promenade with white yachts and bright sky.",
  "Garden courtyard with terracotta and greenery.",
  "Coastal road with low sun and pale sky.",
];
const STUDIO = [
  "Clean off-white studio backdrop with soft diffused light.",
  "Warm beige seamless backdrop with gentle shadow.",
  "Light grey studio wall with a single soft key light.",
  "Pale sage studio backdrop with even lighting.",
  "Soft cream backdrop with subtle floor gradient.",
  "Neutral taupe studio wall with window-style light.",
];
const EVENING = [
  "Elegant hotel corridor with marble floor and warm lights.",
  "Restaurant entrance with soft evening lighting.",
  "Modern atrium with tall columns and daylight.",
  "Luxury lounge with velvet seating and soft glow.",
  "Terrace at dusk with city lights in the distance.",
  "Grand staircase with neutral stone and warm light.",
];
const ACTIVE = [
  "Bright modern gym with soft daylight and clean floors.",
  "Outdoor running track at early morning.",
  "Yoga studio with wooden floor and large windows.",
  "Urban park stairs in soft overcast light.",
  "Rooftop training area with a hazy skyline.",
  "Coastal promenade at sunrise.",
];

export const CATEGORY_PRESETS: Record<string, CategoryPreset> = {
  "Tops & Tees": {
    prompt:
      "Contemporary everyday lifestyle location with natural light and uncluttered surroundings. Keep the top fully visible.",
    scenes: URBAN,
    fidelity: "neckline, sleeve length, print placement, fabric colour and fit",
  },
  Shirts: {
    prompt:
      "Bright modern setting with natural daylight. Keep the shirt's collar, buttons and placket clearly visible.",
    scenes: URBAN,
    fidelity: "collar shape, buttons, placket, cuffs, stripe or check pattern and colour",
  },
  "Dresses & Jumpsuits": {
    prompt:
      "Bright lifestyle setting with an understated architectural background. Preserve the exact length, print and silhouette.",
    scenes: EVENING,
    fidelity: "length, print, waistline, neckline, sleeves and silhouette",
  },
  "Jeans & Jeggings": {
    prompt:
      "Urban lifestyle setting, clean contemporary architecture and natural daylight. Preserve the exact denim wash, fading, seams and hardware.",
    scenes: URBAN,
    fidelity: "denim wash, fading, whiskers, seams, rivets, hem and leg shape",
  },
  "Pants & Leggings": {
    prompt: "Modern everyday setting with natural light. Keep the full leg length and hem visible.",
    scenes: URBAN,
    fidelity: "leg shape, length, waistband, pleats, fabric colour and drape",
  },
  Skirts: {
    prompt: "Soft daylight lifestyle setting. Keep the full skirt length and hem visible.",
    scenes: OUTDOOR,
    fidelity: "length, pleats, print, waistband and drape",
  },
  "Hoodies & Sweatshirts": {
    prompt:
      "Relaxed urban setting with soft overcast light. Preserve the fleece texture, drawstrings and graphics.",
    scenes: URBAN,
    fidelity: "graphics, hood, drawstrings, ribbing, fabric texture and colour",
  },
  "Sweaters & Cardigans": {
    prompt:
      "Soft daylight, contemporary relaxed interior. Preserve every knit stitch, rib and yarn texture.",
    scenes: INTERIOR,
    fidelity: "knit stitch, rib, buttons, yarn texture and colour",
  },
  "Coats & Jackets": {
    prompt:
      "Modern outdoor lifestyle setting with soft overcast light. Preserve layers, zips, quilting and original proportions.",
    scenes: OUTDOOR,
    fidelity: "zips, buttons, quilting, collar, lining, length and colour",
  },
  Activewear: {
    prompt:
      "Modern fitness lifestyle setting with soft natural daylight. Preserve fabric stretch, panel construction, fit and exact product colour.",
    scenes: ACTIVE,
    fidelity: "panels, seams, logos, stretch fabric texture and colour",
  },
  Basics: {
    prompt: "Clean minimal setting with soft daylight. Keep the garment plain and true to colour.",
    scenes: STUDIO,
    fidelity: "colour, neckline, fit and fabric texture",
  },
  Nightwear: {
    prompt: "Calm bright bedroom interior with soft morning light.",
    scenes: INTERIOR,
    fidelity: "print, trims, fabric drape and colour",
  },
  Lingerie: {
    prompt:
      "Soft, tasteful bright interior with diffused light. Keep styling modest and product-focused.",
    scenes: INTERIOR,
    fidelity: "lace, straps, trims, cup shape and colour",
  },
  Shapewear: {
    prompt: "Clean neutral studio setting with soft even light. Product-focused, modest styling.",
    scenes: STUDIO,
    fidelity: "seams, panels, waistband and colour",
  },
  Swimwear: {
    prompt:
      "Bright beach or pool setting with soft daylight. Keep styling tasteful and product-focused.",
    scenes: OUTDOOR,
    fidelity: "print, straps, cut and colour",
  },
  Maternity: {
    prompt: "Warm bright interior with natural light. Comfortable, relaxed styling.",
    scenes: INTERIOR,
    fidelity: "stretch panels, length, print and colour",
  },
  "Plus Size": {
    prompt:
      "Contemporary lifestyle setting with natural light. Preserve the garment's true fit and proportions.",
    scenes: URBAN,
    fidelity: "fit, length, print and colour",
  },
  "Abayas & Kaftans": {
    prompt:
      "Elegant modern architectural setting with refined neutral tones and soft light. Preserve the full length, embroidery and drape.",
    scenes: EVENING,
    fidelity: "length, embroidery, sleeve shape, fabric sheen and colour",
  },
  "Modest Wear": {
    prompt:
      "Bright modern setting with soft daylight. Preserve full coverage, length and fabric drape.",
    scenes: URBAN,
    fidelity: "coverage, length, prints, sleeves and colour",
  },
  Other: {
    prompt:
      "Premium lifestyle environment with natural lighting and uncluttered surroundings. Preserve the exact product.",
    scenes: URBAN,
    fidelity: "colour, print, seams, silhouette and fit",
  },
};

export const CATEGORIES = Object.keys(CATEGORY_PRESETS);

export const DEFAULT_CONFIG: Config = {
  mode: "4",
  category: "Jeans & Jeggings",
  input: "model",
  prompt: CATEGORY_PRESETS["Jeans & Jeggings"].prompt,
  ratio: "1:1",
  size: "2K",
  count: 3,
  backdrop: "warm beige seamless paper backdrop",
  market: "auto",
  colors: "pure white, warm beige, light grey",
  modelDescription: "Adult model, natural proportions, understated fashion styling.",
  center: true,
};

/** Validation that depends on more than one field. Returns an error message or null. */
export function validateConfig(c: Config): string | null {
  if (c.mode === "4" && c.input !== "model") return "Fresh backgrounds need a real model photo.";
  if (c.mode === "3" && c.input !== "model") return "New poses need a real model photo.";
  if (c.mode === "2" && c.input !== "model") return "New face lifestyle needs a real model photo.";
  if (c.mode === "5" && c.input !== "model") return "Editorial campaign needs a real model photo.";
  return null;
}

/** Whether an uploaded file with this role creates generation tasks under this config. */
export function createsTasks(_c: Config, role: "lead" | "supporting"): boolean {
  return role !== "supporting";
}

/** Modes that ship the untouched originals inside the export ZIP. */
export function exportsOriginals(c: Config): boolean {
  return c.mode !== "1";
}
