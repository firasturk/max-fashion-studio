import { Camera, Layers, Sparkles, UserRound, type LucideIcon } from "lucide-react";

export interface ModeInfo {
  id: "1" | "2" | "3" | "4";
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
      "From your real model photo: lifestyle images with a different face chosen for the category. The garment, styling and body stay the same. Choose how many images per original.",
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
      "Keep the real model, garment and pose exactly as shot and swap in a fresh background per image, chosen from the category's scenes. Choose how many backgrounds per original.",
  },
];

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
