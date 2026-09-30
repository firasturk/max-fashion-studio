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
    title: "Fully AI-generated",
    caption: "5 lifestyle + 1 fabric detail",
    icon: Sparkles,
    detail:
      "Turn a garment or mannequin into six product cards. Texture, colour and fit require review.",
  },
  {
    id: "2",
    title: "AI first card",
    caption: "New model + your real shoot",
    icon: Layers,
    detail:
      "Generate the lifestyle first card. Supporting photographs stay original; model identity may differ.",
  },
  {
    id: "3",
    title: "Your model, AI setting",
    caption: "Real face + lifestyle first card",
    icon: UserRound,
    detail:
      "Use an identity reference for the first card. Check facial features and garment fidelity before approval.",
  },
  {
    id: "4",
    title: "Background enhancement",
    caption: "Your model. Your product.",
    icon: Camera,
    detail:
      "Keep the real model photograph and improve the surroundings. Review for unintended subject changes.",
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
