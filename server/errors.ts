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
  if (e instanceof StudioError) return /\(5\d\d\)/.test(e.message);
  if (e instanceof Error)
    return /TimeoutError|AbortError/.test(e.name) || /fetch failed|network|socket|ECONNRESET/i.test(e.message);
  return false;
}

export function errorMessage(e: unknown, fallback = "Request failed."): string {
  if (e instanceof StudioError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
