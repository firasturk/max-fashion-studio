import { describe, expect, it } from "vitest";
import { StudioError, isRateLimit, isTransientEngineError, retryAfterMs } from "../server/errors";

describe("rate limits", () => {
  const e = new StudioError(
    'Prompt builder (OpenAI) rate limited (429): {"error":{"message":"Rate limit reached ... Please try again in 1.2s."}}',
    429,
  );
  it("are transient, never fatal, and carry the vendor's wait", () => {
    expect(isRateLimit(e)).toBe(true);
    expect(isTransientEngineError(e)).toBe(true);
    expect(retryAfterMs(e)).toBe(2200);
    expect(retryAfterMs(new StudioError("try again in 850ms", 429))).toBe(2000);
    expect(retryAfterMs(new StudioError("Rate limit", 429))).toBe(12000);
  });
  it("a plain 5xx is transient too but not a rate limit", () => {
    const s = new StudioError("OpenAI request failed (502): bad gateway", 502);
    expect(isTransientEngineError(s)).toBe(true);
    expect(isRateLimit(s)).toBe(false);
  });
});
