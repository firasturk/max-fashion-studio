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

export function errorMessage(e: unknown, fallback = "Request failed."): string {
  if (e instanceof StudioError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
