import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../server/auth";

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});
