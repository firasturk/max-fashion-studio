import { z } from "zod";

export const MODES = ["1", "2", "3", "4"] as const;
export const INPUT_TYPES = ["model", "mannequin", "flatlay"] as const;
export const RATIOS = ["2:3", "3:4", "4:5", "1:1"] as const;
export const SIZES = ["1K", "2K", "4K"] as const;

export const configSchema = z.object({
  mode: z.enum(MODES),
  category: z.string().min(1).max(80),
  input: z.enum(INPUT_TYPES),
  prompt: z.string().max(6000),
  ratio: z.enum(RATIOS),
  size: z.enum(SIZES),
  identity: z.string().max(160).optional(),
  modelDescription: z.string().max(1000),
  center: z.boolean(),
});
export type Config = z.infer<typeof configSchema>;

export const CARDS_PER_SOURCE: Record<Config["mode"], number> = { "1": 6, "2": 1, "3": 1, "4": 1 };
export const FABRIC_CARD = 6;

export const CATEGORY_PRESETS: Record<string, string> = {
  Denim:
    "Urban lifestyle setting, clean contemporary architecture and natural daylight. Preserve the exact denim wash, fading, seams and hardware.",
  "Active wear":
    "Modern fitness lifestyle setting with soft natural daylight. Preserve fabric stretch, panel construction, fit and exact product colour.",
  Casual:
    "Contemporary everyday lifestyle location, natural light and uncluttered surroundings. Keep the garment clearly visible.",
  Formal:
    "Elegant modern architectural setting, refined neutral background and soft lighting. Preserve tailoring and fabric drape.",
  Dresses:
    "Bright lifestyle setting with an understated architectural background. Preserve the exact length, print and silhouette.",
  Knitwear:
    "Soft daylight, contemporary relaxed interior. Preserve every knit stitch, rib and yarn texture.",
  Outerwear:
    "Modern outdoor lifestyle setting with soft overcast light. Preserve layers, zips, quilting and original proportions.",
  Other:
    "Premium lifestyle environment with natural lighting and uncluttered surroundings. Preserve the exact product.",
};

export const DEFAULT_CONFIG: Config = {
  mode: "4",
  category: "Denim",
  input: "model",
  prompt: CATEGORY_PRESETS.Denim,
  ratio: "2:3",
  size: "2K",
  modelDescription: "Adult model, natural proportions, understated fashion styling.",
  center: true,
};

/** Validation that depends on more than one field. Returns an error message or null. */
export function validateConfig(c: Config): string | null {
  if (c.mode === "4" && c.input !== "model") return "Background-only requires a real model photo.";
  if (c.mode === "3" && !c.identity) return "Upload an identity reference first.";
  return null;
}

/** Whether an uploaded file with this role creates generation tasks under this config. */
export function createsTasks(c: Config, role: "lead" | "supporting"): boolean {
  return !(role === "supporting" && (c.mode === "2" || c.mode === "3"));
}
