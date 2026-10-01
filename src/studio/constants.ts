import {
  Camera,
  Layers,
  PaintBucket,
  Sparkles,
  UserRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export interface ModeInfo {
  id: "1" | "2" | "3" | "4" | "5" | "6";
  title: string;
  caption: string;
  icon: LucideIcon;
  detail: string;
}

export const MODES: ModeInfo[] = [
  {
    id: "1",
    title: "Mannequin to model",
    caption: "1 lifestyle + 4 studio + 1 fabric",
    icon: Sparkles,
    detail:
      "From a mannequin or flat lay: one lifestyle image, four studio-backdrop shots with the same model face and studio light, and a fabric close-up. Texture, colour and fit require review.",
  },
  {
    id: "2",
    title: "New face lifestyle",
    caption: "Real shoot, different face",
    icon: Layers,
    detail:
      "From your real model photo: lifestyle images with a different face. The garment, styling and body stay the same. Choose how many images per original.",
  },
  {
    id: "3",
    title: "New poses",
    caption: "Same model, face changed",
    icon: UserRound,
    detail:
      "From your real model photo: new poses with the same model and garment, but the face is changed so the person is not identifiable. Choose how many poses per original.",
  },
  {
    id: "4",
    title: "Fresh backgrounds",
    caption: "Model, clothes and pose untouched",
    icon: Camera,
    detail:
      "Keep the real model, garment and pose exactly as shot and swap in a fresh background per image, chosen from the built-in scenes. Choose how many backgrounds per original.",
  },
];

export const EDITORIAL_MODE: ModeInfo = {
  id: "5",
  title: "Skill campaign",
  caption: "Pick a skill · fresh scene each image",
  icon: Wand2,
  detail:
    "From your real model photo: a vision model runs the chosen skill (editorial, street style, resort, Ramadan & Eid, modest, kids and more) on each image, writes a detailed prompt (exact outfit, preserved face when visible, new scene, real pose) and generates it. Every image gets a different scene and pose.",
};
MODES.push(EDITORIAL_MODE);

export const BACKDROP_MODE: ModeInfo = {
  id: "6",
  title: "Backdrop colour",
  caption: "Product untouched · one image per colour",
  icon: PaintBucket,
  detail:
    "Packshot recolour: keep the product exactly as shot and swap only the background for a flat solid colour. List the colours you need and get one image per colour.",
};
MODES.push(BACKDROP_MODE);

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Generating",
  ready: "Ready",
  review: "Review needed",
  approved: "Approved",
  failed: "Retry needed",
};

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
