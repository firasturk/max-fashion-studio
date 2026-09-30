import { describe, expect, it, vi } from "vitest";
import { HiggsfieldClient } from "../server/higgsfield";

const cfg = { apiKey: "id:secret", baseUrl: "https://api.example", model: "nano-banana-pro" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HiggsfieldClient", () => {
  it("rejects malformed credentials before any request", () => {
    expect(() => new HiggsfieldClient({ ...cfg, apiKey: "just-a-key" })).toThrow(
      /KEY_ID:KEY_SECRET/,
    );
  });

  it("submits with the Key header, model slug and documented fields", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.example/nano-banana-pro?hf_webhook=https%3A%2F%2Fapp%2Fhook",
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe("Key id:secret");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        prompt: "p",
        aspect_ratio: "2:3",
        resolution: "2k",
        image_urls: ["https://cdn/a.jpg"],
      });
      return json({ request_id: "req-1", status: "queued" });
    });
    const client = new HiggsfieldClient(cfg, fetchMock as unknown as typeof fetch);
    const id = await client.submit({
      prompt: "p",
      imageUrls: ["https://cdn/a.jpg"],
      aspectRatio: "2:3",
      size: "2K",
      webhookUrl: "https://app/hook",
    });
    expect(id).toBe("req-1");
  });

  it("maps auth and credit failures to fatal errors with the API detail", async () => {
    const client = new HiggsfieldClient(cfg, (async () =>
      json({ detail: "Invalid key" }, 401)) as unknown as typeof fetch);
    await expect(
      client.submit({ prompt: "p", imageUrls: [], aspectRatio: "1:1", size: "1K" }),
    ).rejects.toMatchObject({
      fatal: true,
      message: expect.stringContaining("Invalid key"),
    });
  });

  it("parses status responses", async () => {
    const responses = [
      json({ status: "in_progress" }),
      json({ status: "completed", images: [{ url: "https://cdn/out.png" }] }),
      json({ status: "nsfw" }),
      json({ status: "failed", error: "boom" }),
      new Response("", { status: 404 }),
    ];
    const client = new HiggsfieldClient(cfg, (async () =>
      responses.shift()!) as unknown as typeof fetch);
    expect(await client.status("r")).toEqual({ state: "pending", raw: "in_progress" });
    expect(await client.status("r")).toEqual({ state: "done", url: "https://cdn/out.png" });
    expect(await client.status("r")).toMatchObject({ state: "failed", retryable: false });
    expect(await client.status("r")).toMatchObject({
      state: "failed",
      retryable: true,
      message: expect.stringContaining("boom"),
    });
    expect(await client.status("r")).toMatchObject({ state: "failed", retryable: true });
  });

  it("uploads through a presigned URL and returns the public URL", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/files/generate-upload-url")) {
        return json({ upload_url: "https://storage/put", public_url: "https://cdn/file.jpg" });
      }
      expect(init?.body).toBeInstanceOf(ArrayBuffer);
      return new Response("", { status: 200 });
    });
    const client = new HiggsfieldClient(cfg, fetchMock as unknown as typeof fetch);
    expect(await client.upload(new ArrayBuffer(4), "image/jpeg")).toBe("https://cdn/file.jpg");
    expect(calls).toEqual([
      "POST https://api.example/files/generate-upload-url",
      "PUT https://storage/put",
    ]);
  });

  it("verifies credentials cheaply", async () => {
    const ok = new HiggsfieldClient(
      cfg,
      (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    );
    expect((await ok.verify()).ok).toBe(true);
    const bad = new HiggsfieldClient(
      cfg,
      (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
    );
    expect((await bad.verify()).ok).toBe(false);
  });
});
