/** Video clips made from finished images. Shared by the Worker and the app. */

export const VIDEO_MODEL = "kling3_0_turbo";
export const VIDEO_MODEL_NAME = "Kling 3.0 Turbo";
/** Credits per second at 720p, from Higgsfield's own estimate (5 s = 7.5 credits). */
export const VIDEO_CREDITS_PER_SECOND = 1.5;
export const VIDEO_SECONDS = [5, 10] as const;
export const VIDEO_RATIOS = ["9:16", "1:1", "16:9"] as const;

export type ClipStatus = "queued" | "rendering" | "ready" | "approved" | "failed";

export interface Clip {
  id: string;
  batch: string;
  task: string;
  name: string;
  skill: string | null;
  status: ClipStatus;
  seconds: number;
  ratio: string;
  motion: string;
  credits: number;
  error: string | null;
  created: number;
  updated: number;
}

/** How the model and the camera move. The first one is the safe default for product shots. */
export const MOTIONS = [
  "The model shifts her weight and turns slightly toward the camera, relaxed and natural. Slow push-in.",
  "Slow walk toward the camera, fabric moving with each step. Camera steady.",
  "Quarter turn to show the garment from the side, then back. Camera steady.",
  "The model stays still, a light breeze moves hair and fabric. Slow orbit to the right.",
] as const;

/** What every clip prompt ends with: the product must not change. */
export const MOTION_GUARD =
  "Keep the clothes, colours, print, face and background exactly as in the first frame. No new objects, no text.";

export function clipCredits(seconds: number): number {
  return Math.round(seconds * VIDEO_CREDITS_PER_SECOND * 100) / 100;
}

export function clipPrompt(motion: string): string {
  const m = motion.trim().replace(/\s+/g, " ").slice(0, 400) || MOTIONS[0];
  return `${m} ${MOTION_GUARD}`;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The id Higgsfield gave an imported image. */
export function mediaIdOf(data: unknown): string | null {
  const d = data as { media_id?: unknown } | null;
  return typeof d?.media_id === "string" && UUID.test(d.media_id) ? d.media_id : null;
}

/** The job id of a submitted clip. */
export function jobIdOf(data: unknown): string | null {
  const d = data as { results?: { id?: unknown; job_id?: unknown }[]; id?: unknown; job_id?: unknown } | null;
  const first = d?.results?.[0];
  for (const v of [first?.id, first?.job_id, d?.job_id, d?.id])
    if (typeof v === "string" && UUID.test(v)) return v;
  return null;
}

export type JobState =
  | { state: "pending" }
  | { state: "done"; url: string }
  | { state: "failed"; message: string };

/** Finds the first .mp4 (or any video-looking) URL anywhere in a job record. */
function videoUrl(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string")
    return /^https:\/\/\S+\.(mp4|mov|webm)(\?\S*)?$/i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const u = videoUrl(v, depth + 1);
      if (u) return u;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const u = videoUrl(v, depth + 1);
      if (u) return u;
    }
  }
  return null;
}

/** Reads one job out of a jobs_wait answer. */
export function jobStateOf(data: unknown, jobId: string): JobState {
  const jobs = (data as { jobs?: Record<string, unknown>[] } | null)?.jobs ?? [];
  const job = jobs.find((j) => j.job_id === jobId) ?? jobs[0];
  if (!job) return { state: "pending" };
  const status = String(job.status ?? "").toLowerCase();
  const url = videoUrl(job);
  if (url && !["failed", "nsfw", "ip_detected", "canceled", "cancelled"].includes(status))
    return { state: "done", url };
  if (["failed", "nsfw", "ip_detected", "canceled", "cancelled", "lookup_failed"].includes(status)) {
    const reason =
      status === "nsfw"
        ? "The video engine refused this image as sensitive."
        : status === "ip_detected"
          ? "The video engine refused this image for a brand or likeness reason."
          : typeof job.error === "string"
            ? job.error.slice(0, 200)
            : "The video engine could not render this clip.";
    return { state: "failed", message: reason };
  }
  return { state: "pending" };
}
