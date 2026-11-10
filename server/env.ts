export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_MODEL: string;
  HIGGSFIELD_BASE_URL: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  FAL_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  INVITE_CODE?: string;
  SESSION_SECRET?: string;
  WEBHOOK_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
  MAX_CONCURRENT_GENERATIONS?: string;
  VERTEX_PARALLEL?: string;
  GOOGLE_PARALLEL?: string;
  /** "key": the AI Studio key is used even when a Vertex service account is saved. */
  GOOGLE_PREFER?: string;
  /** Image generations fanned out one per consumer invocation (synchronous engines). */
  IMAGES?: Queue<ImageJob>;
}

/** One queued generation: the task was claimed by the driver; the consumer runs it. */
export interface ImageJob {
  batch: string;
  task: string;
  lease: string;
}

export function concurrency(env: Env): number {
  // Workers hold at most six outgoing connections open at once; more would just queue inside the isolate.
  const n = Number(env.MAX_CONCURRENT_GENERATIONS ?? 6);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 6) : 6;
}

/**
 * Images in flight on Vertex at once when generations are fanned out over the queue: each one
 * runs in its own consumer invocation, so the six-connection rule no longer applies. The quota
 * Google grants per minute is the real ceiling; a rate limit halves this for a while.
 */
export function vertexWidth(env: Env): number {
  const n = Number(env.VERTEX_PARALLEL ?? 12);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 100) : 12;
}

/** Images in flight at once on the Gemini API (AI Studio key), whose limits are per project tier. */
export function googleWidth(env: Env): number {
  const n = Number(env.GOOGLE_PARALLEL ?? 40);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 200) : 40;
}
