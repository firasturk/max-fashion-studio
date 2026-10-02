export const MODES = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const MARKETS = ["auto", "arab", "european", "mixed"] as const;
export const INPUT_TYPES = ["model", "mannequin", "flatlay"] as const;
export const RATIOS = ["2:3", "3:4", "4:5", "1:1"] as const;
export const SIZES = ["1K", "2K", "4K"] as const;
export const OUTPUT_FORMATS = ["png", "jpg", "webp"] as const;
export const MAX_COUNT = 6;
export type Mode = (typeof MODES)[number];
export type Market = (typeof MARKETS)[number];
export type InputType = (typeof INPUT_TYPES)[number];
export type Ratio = (typeof RATIOS)[number];
export type Size = (typeof SIZES)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Batch configuration. Validated on the server by configSchema in config-schema.ts; kept zod-free here so the client bundle stays small. */
export interface Config {
  mode: Mode;
  /** Kept optional so batches saved before the category picker was removed still load. */
  category?: string;
  input: InputType;
  prompt: string;
  ratio: Ratio;
  size: Size;
  /** Engine model slug chosen for this batch; empty means the server default. */
  model?: string;
  /** Images per original for modes 2-4. Mode 1 always produces six. */
  count: number;
  /** Export format for the ZIP; PNG keeps the engine bytes, JPG/WebP are converted in the browser at export. */
  output: OutputFormat;
  outputQuality: number;
  /** Economy mode: Google Flex tier at half price with slower, queued delivery. Google models only. */
  economy: boolean;
  /** Backdrop-colour mode: comma-separated colours, one image per colour. */
  colors: string;
  /** Skill workflow: which ready-made prompt-builder skill writes the per-image prompt. */
  skill: string;
  /** Skill workflow: look of a generated face when the reference face is not visible. */
  market: Market;
  /** Studio backdrop for mode 1 cards 2-5; identical across the set. */
  backdrop: string;
  identity?: string;
  modelDescription: string;
  center: boolean;
}

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

/** Default lifestyle/background direction; editable per batch. */
export const DEFAULT_PROMPT =
  "Premium lifestyle environment with natural lighting and uncluttered surroundings. Preserve the exact product.";

/** Distinct background scenes, one per card, for "fresh background" and lifestyle variety. */
export const SCENES = [
  "Sunlit city street with pale stone facades and soft morning light.",
  "Modern glass-and-concrete building entrance, bright overcast daylight.",
  "Minimal cafe terrace with warm wood and neutral walls.",
  "Quiet residential lane with white walls and green foliage.",
  "Rooftop with a hazy skyline and golden-hour light.",
  "Contemporary art-gallery interior with white walls and soft daylight.",
];

/** What must never change on the garment. */
export const FIDELITY = "colour, print, seams, silhouette and fit";

export const DEFAULT_CONFIG: Config = {
  mode: "5",
  input: "model",
  /** The skill workflow writes its own scene text, so the default prompt is empty there. */
  prompt: "",
  ratio: "1:1",
  size: "2K",
  count: 1,
  backdrop: "warm beige seamless paper backdrop",
  market: "auto",
  skill: "editorial",
  economy: false,
  output: "png",
  outputQuality: 90,
  colors: "pure white, warm beige, light grey",
  modelDescription: "Adult model, natural proportions, understated fashion styling.",
  center: true,
};

/** Validation that depends on more than one field. Returns an error message or null. */
export function validateConfig(c: Config): string | null {
  if (c.mode === "4" && c.input !== "model") return "Fresh backgrounds need a real model photo.";
  if (c.mode === "3" && c.input !== "model") return "New poses need a real model photo.";
  if (c.mode === "2" && c.input !== "model") return "New face lifestyle needs a real model photo.";
  if (c.mode === "5" && c.input !== "model") return "Skill campaign needs a real model photo.";
  if (c.mode === "7" && c.input !== "model")
    return "Zaid creative direction needs a real model photo.";
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
