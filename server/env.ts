export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_MODEL: string;
  HIGGSFIELD_BASE_URL: string;
  GEMINI_API_KEY?: string;
  INVITE_CODE?: string;
  SESSION_SECRET?: string;
  WEBHOOK_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
  MAX_CONCURRENT_GENERATIONS?: string;
}

export function concurrency(env: Env): number {
  const n = Number(env.MAX_CONCURRENT_GENERATIONS ?? 2);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 8) : 2;
}
