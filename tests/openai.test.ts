import { describe, expect, it, vi } from "vitest";
import { OpenAIImageClient, pixelSize, SIZE_TABLE, isOpenAIModel } from "../server/openai";

describe("OpenAI image client", () => {
  it("maps ratios and tiers to valid pixel sizes", () => {
    for (const ratio of Object.keys(SIZE_TABLE)) {
      for (const tier of ["1K", "2K", "4K"]) {
        const [w, h] = pixelSize(ratio, tier).split("x").map(Number);
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
        expect(w * h).toBeGreaterThanOrEqual(655_360);
        expect(w * h).toBeLessThanOrEqual(8_294_400);
      }
    }
    expect(pixelSize("2:3", "2K")).toBe("1360x2048");
    expect(isOpenAIModel("gpt-image-2.5-sunburst")).toBe(true);
    expect(isOpenAIModel("flux-2-pro")).toBe(false);
  });

  it("rejects keys that do not look like OpenAI keys", () => {
    expect(() => new OpenAIImageClient("not-a-key")).toThrow(/sk-/);
  });

  it("posts a multipart edit with references and decodes base64 output", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/images/edits");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer sk-test-key-123456",
      );
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
      expect(form.get("size")).toBe("1360x2048");
      expect(form.get("quality")).toBe("high");
      expect(form.get("input_fidelity")).toBe("high");
      expect(form.getAll("image[]")).toHaveLength(2);
      const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new OpenAIImageClient(
      "sk-test-key-123456",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const out = await client.edit({
      model: "gpt-image-2.5-sunburst",
      prompt: "p",
      images: [
        { bytes: new ArrayBuffer(4), mime: "image/jpeg" },
        { bytes: new ArrayBuffer(4), mime: "image/png" },
      ],
      aspectRatio: "2:3",
      size: "2K",
    });
    expect(out.mime).toBe("image/png");
    expect(new Uint8Array(out.bytes)[1]).toBe(0x50);
  });

  it("maps auth and billing failures to fatal errors", async () => {
    const client = new OpenAIImageClient(
      "sk-test-key-123456",
      undefined,
      (async () =>
        new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), {
          status: 401,
        })) as unknown as typeof fetch,
    );
    await expect(
      client.edit({
        model: "gpt-image-2",
        prompt: "p",
        images: [],
        aspectRatio: "1:1",
        size: "1K",
      }),
    ).rejects.toMatchObject({ fatal: true, message: expect.stringContaining("Incorrect API key") });
  });
});

describe("unsupported parameters", () => {
  it("drops a parameter the model rejects and retries once", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const form = init?.body as FormData;
      if (form.get("input_fidelity"))
        return new Response(
          JSON.stringify({
            error: {
              message:
                "The model 'gpt-image-2.5-sunburst' does not support the 'input_fidelity' parameter.",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      expect(form.get("quality")).toBe("high");
      const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new OpenAIImageClient(
      "sk-test-key-123456",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const out = await client.edit({
      model: "gpt-image-2.5-sunburst",
      prompt: "p",
      images: [{ bytes: new ArrayBuffer(4), mime: "image/jpeg" }],
      aspectRatio: "2:3",
      size: "2K",
    });
    expect(calls).toBe(2);
    expect(out.bytes.byteLength).toBe(4);
  });
});
