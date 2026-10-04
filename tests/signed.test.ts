import { describe, expect, it } from "vitest";
import { signObjectUrl, verifyObjectToken } from "../server/signed";
import type { Env } from "../server/env";

const env = {
  SESSION_SECRET: "a-long-enough-test-secret-value",
  PUBLIC_BASE_URL: "https://studio.example.com",
} as unknown as Env;

describe("signed object links", () => {
  it("round-trips a key with slashes and rejects tampering or expiry", async () => {
    const url = new URL(await signObjectUrl(env, "sources/abc/def.jpg"));
    expect(url.origin).toBe("https://studio.example.com");
    expect(url.pathname).toBe("/api/public/object");
    const k = url.searchParams.get("k")!;
    const e = url.searchParams.get("e")!;
    const s = url.searchParams.get("s")!;
    expect(k).toBe("sources/abc/def.jpg");
    expect(await verifyObjectToken(env, k, e, s)).toBe(true);
    expect(await verifyObjectToken(env, "sources/abc/other.jpg", e, s)).toBe(false);
    expect(await verifyObjectToken(env, k, "1", s)).toBe(false);
    expect(await verifyObjectToken(env, k, e, s.replace(/^./, "0"))).toBe(false);
  });
});
