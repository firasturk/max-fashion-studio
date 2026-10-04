/** Error carrying an HTTP status and a message that is safe to show to the user. */
export class StudioError extends Error {
  constructor(
    message: string,
    public status = 400,
    public fatal = false,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

/** True for failures that make further paid requests pointless (bad key, no credits, rate limit). */
export function isFatalEngineError(e: unknown): boolean {
  return e instanceof StudioError && e.fatal;
}

/**
 * True for failures worth one automatic retry: the engine's own 5xx, a dropped connection or a
 * timeout. Not a bad request, a moderation refusal or anything fatal.
 */
export function isTransientEngineError(e: unknown): boolean {
  if (isFatalEngineError(e)) return false;
  if (e instanceof StudioError) return e.status === 429 || /\((5\d\d|429)\)/.test(e.message);
  if (e instanceof Error)
    return (
      /TimeoutError|AbortError/.test(e.name) ||
      /fetch failed|network|socket|ECONNRESET/i.test(e.message)
    );
  return false;
}

export function errorMessage(e: unknown, fallback = "Request failed."): string {
  if (e instanceof StudioError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** True when a vendor said "slow down" (HTTP 429); the work is retried after `retryAfterMs(e)`. */
export function isRateLimit(e: unknown): boolean {
  return (
    (e instanceof StudioError && e.status === 429) || /\(429\)|rate limit/i.test(errorMessage(e))
  );
}

/** How long a vendor asked us to wait, from "try again in 1.2s" / "in 850ms" / Retry-After seconds; default 12 s. */
export function retryAfterMs(e: unknown): number {
  const m = /try again in\s*(\d+(?:\.\d+)?)\s*(ms|s)/i.exec(errorMessage(e));
  if (!m) return 12_000;
  const n = Number(m[1]) * (m[2] === "ms" ? 1 : 1000);
  return Math.min(60_000, Math.max(2_000, Math.ceil(n) + 1_000));
}
