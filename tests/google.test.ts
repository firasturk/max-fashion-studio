import { describe, expect, it, vi } from "vitest";
import { GoogleImageClient, extractImage, isGoogleModel } from "../server/google";

const KEY = "AIzaSyTestKey_0123456789abcdefghijk";

describe("Google image client", () => {
  it("detects Nano Banana slugs", () => {
    expect(isGoogleModel("gemini-3-pro-image")).toBe(true);
    expect(isGoogleModel("gemini-nano-banana-2.1")).toBe(true);
    expect(isGoogleModel("nano-banana-pro")).toBe(false);
  });

  it("finds the image in any of the response shapes", () => {
    expect(extractImage({ output_image: "AAAA" })).toEqual({ data: "AAAA", mime: "image/jpeg" });
    expect(extractImage({ output_image: { data: "BBBB", mime_type: "image/jpeg" } })).toEqual({
      data: "BBBB",
      mime: "image/jpeg",
    });
    expect(
      extractImage({
        steps: [
          { type: "thought", content: [{ type: "image", data: "T" }] },
          { type: "model_output", content: [{ type: "image", data: "CCCC" }] },
        ],
      }),
    ).toEqual({ data: "CCCC", mime: "image/jpeg" });
    expect(extractImage({})).toBeNull();
  });

  it("posts an interaction with inline images and the requested size", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gemini-3-pro-image");
      expect(body.store).toBe(false);
      expect(body.input[0]).toEqual({ type: "text", text: "p" });
      expect(body.input[1].type).toBe("image");
      expect(body.input[1].mime_type).toBe("image/jpeg");
      expect(body.response_format).toEqual({
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: "2:3",
        image_size: "2K",
      });
      return new Response(JSON.stringify({ status: "completed", output_image: btoa("png") }), {
        status: 200,
      });
    });
    const client = new GoogleImageClient(KEY, fetchMock as unknown as typeof fetch);
    const out = await client.edit({
      model: "gemini-3-pro-image",
      prompt: "p",
      images: [{ bytes: new ArrayBuffer(3), mime: "image/jpeg" }],
      aspectRatio: "2:3",
      size: "2K",
    });
    expect(out.mime).toBe("image/jpeg");
    expect(out.bytes.byteLength).toBe(3);
  });

  it("economy mode submits a background Flex interaction and polls it", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.service_tier).toBe("flex");
        expect(body.background).toBe(true);
        expect(body.store).toBe(true);
        return new Response(JSON.stringify({ id: "int_123", status: "queued" }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response("", { status: 200 });
      if (calls.filter((c) => c.startsWith("GET")).length === 1)
        return new Response(JSON.stringify({ status: "in_progress" }), { status: 200 });
      return new Response(JSON.stringify({ status: "completed", output_image: btoa("jpg") }), {
        status: 200,
      });
    });
    const client = new GoogleImageClient(KEY, fetchMock as unknown as typeof fetch);
    const id = await client.submitFlex({
      model: "gemini-3-pro-image",
      prompt: "p",
      images: [],
      aspectRatio: "1:1",
      size: "2K",
    });
    expect(id).toBe("int_123");
    expect(await client.status(id)).toEqual({ state: "pending", raw: "in_progress" });
    const done = await client.status(id);
    expect(done.state).toBe("done");
    expect(calls[1]).toContain("/interactions/int_123");
  });

  it("maps an invalid key to a fatal error", async () => {
    const client = new GoogleImageClient(
      KEY,
      (async () =>
        new Response(JSON.stringify([{ error: { code: 400, message: "API key not valid." } }]), {
          status: 400,
        })) as unknown as typeof fetch,
    );
    await expect(
      client.edit({
        model: "gemini-3-pro-image",
        prompt: "p",
        images: [],
        aspectRatio: "1:1",
        size: "1K",
      }),
    ).rejects.toMatchObject({
      fatal: true,
      message: expect.stringContaining("API key not valid"),
    });
  });
});

describe("standard-tier background submit", () => {
  it("omits the flex service tier when economy is off", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.service_tier).toBeUndefined();
      expect(body.background).toBe(true);
      return new Response(JSON.stringify({ id: "int_std" }), { status: 200 });
    });
    const client = new GoogleImageClient("a".repeat(40), fetchMock as unknown as typeof fetch);
    const id = await client.submitBackground(
      {
        model: "gemini-3-pro-image",
        prompt: "p",
        images: [{ bytes: new ArrayBuffer(4), mime: "image/jpeg" }],
        aspectRatio: "1:1",
        size: "2K",
      },
      false,
    );
    expect(id).toBe("int_std");
  });
});
